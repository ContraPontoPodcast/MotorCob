"""Rodada do importador de gravações do discador na VM de voz (timer motorcx-voz-importador, SQL 64).

  1. importacao_voz_pendente(parte): fontes desta VM com "Ler agora", leitura automática vencida (leitura_automatica,
     intervalo_horas) ou envio pelo site pendente; e os lotes já importados que faltam apagar do Storage.
  2. Por fonte (e por lote do envio): iniciar_importacao_voz → pacotes (manifestos) da fonte → para cada manifesto:
       validação estrita (voz/importador/manifesto.py; arquivo recusado ou linhas para a quarentena);
       preparar_importacao_voz: par com a chamada do MotorCX (id da transferência ou janela de tempo) e se a
         gravação já existe (reimportar não duplica: chave_importacao);
       áudio novo: conferido pelo conteúdo, sobe para o bucket da empresa (discador/<AAAA>/<MM>/<DD>/<chave>.<ext>,
         ifGenerationMatch=0: já existir conta como feito) → registrar_importacao_voz (voz_gravacoes origem
         'discador', operador_ref) → com a transcrição ligada, fica em <saida>/empresa_<id>/<gravacao>.<ext> para o
         Whisper (voz/transcricao/worker.py, que redige CPF e cartão e devolve a situação e os minutos);
       registrar_arquivo_importacao_voz: o registro por arquivo (linhas, importadas, casadas, duplicadas, rejeitadas
         e os motivos) e as linhas recusadas na quarentena.
     concluir_importacao_voz fecha a execução (com o erro da fonte, se houver).
SFTP: manifesto já lido (mesmo nome, tamanho e data no servidor) não é lido de novo, salvo "Ler de novo".
Desligado por padrão: só roda com MOTORCX_IMPORTADOR_GRAVACOES=1 (o motorcx-voz-rodar só passa com o metadado
motorcx-importador-gravacoes=1 da VM) e, por fonte, leitura_automatica. Os dois acessos da VM (voz/acesso.py).

    python3 -m voz.importador.rotina --parte 1/2 --saida /var/motorcx/importadas
"""
from __future__ import annotations

import argparse
import json
import logging
import os
import re
import sys
import urllib.parse
from collections import Counter
from datetime import datetime
from pathlib import Path

from voz.importador import fontes as F
from voz.importador import manifesto as M

log = logging.getLogger("motorcx.voz.importador")
LOTE_DB = 500
MAX_QUARENTENA = 1000


# ------------------------------------------------------------------ bucket da empresa (GCS)
class BucketGCS:
    """Upload simples pela API JSON do GCS com o token da conta de serviço da VM; ifGenerationMatch=0 (não
    sobrescreve). Devolve True se gravou, False se o objeto já existia (reimportação)."""

    def __init__(self, token=None, abrir=None):
        import urllib.request
        from voz import gcp
        self._gcp = gcp
        self._abrir = abrir or urllib.request.urlopen
        self._token = token or gcp.Token(self._abrir)

    def enviar(self, bucket: str, objeto: str, dados: bytes, tipo: str) -> bool:
        url = (f"https://storage.googleapis.com/upload/storage/v1/b/{urllib.parse.quote(bucket)}/o"
               f"?uploadType=media&name={urllib.parse.quote(objeto, safe='')}&ifGenerationMatch=0")
        try:
            self._gcp.requisitar("POST", url, self._token, dados, tipo, abrir=self._abrir, timeout=120)
        except self._gcp.ErroGCP as ex:
            if ex.status == 412:
                return False
            raise
        return True


class BucketLocal:
    """Testes e simulação: grava numa pasta (<pasta>/<bucket>/<objeto>)."""

    def __init__(self, pasta):
        self.pasta = Path(pasta)

    def enviar(self, bucket, objeto, dados, tipo):
        destino = self.pasta / bucket / objeto
        if destino.exists():
            return False
        destino.parent.mkdir(parents=True, exist_ok=True)
        destino.write_bytes(dados)
        return True


# ------------------------------------------------------------------ fila do Whisper (pasta local da VM)
def deixar_para_transcrever(saida: Path, empresa_id: int, gravacao_id: int, ext: str, dados: bytes,
                            duracao_s: int, bucket: str | None = None, objeto: str | None = None) -> Path:
    """<saida>/empresa_<id>/<gravacao>.<ext> (0600) com <gravacao>.json {duracao_s, bucket, objeto} ao lado (o worker
    sobe a transcrição redigida ao lado do áudio no bucket); o áudio entra por último e de uma vez (rename), para o
    worker nunca pegar arquivo pela metade."""
    pasta = Path(saida) / f"empresa_{int(empresa_id)}"
    pasta.mkdir(parents=True, exist_ok=True)
    meta = pasta / f"{int(gravacao_id)}.json"
    m = {"duracao_s": duracao_s}
    if bucket and objeto:
        m.update(bucket=bucket, objeto=objeto)
    meta.write_text(json.dumps(m), encoding="utf-8")
    tmp = pasta / f".{int(gravacao_id)}.{ext}.parcial"
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "wb") as f:
        f.write(dados)
    final = pasta / f"{int(gravacao_id)}.{ext}"
    os.replace(tmp, final)
    return final


# ------------------------------------------------------------------ um manifesto
def _nome_seguro(nome: str) -> str:
    n = (nome or "").strip()[:120] or "[sem nome]"
    return "[nome descartado]" if M.tem_dado_pessoal(n) else n


def _erro_seguro(texto: str) -> str:
    t = (texto or "")[:300]
    return "erro na leitura (detalhe com dado pessoal descartado)" if M.tem_dado_pessoal(t) else t


class Importador:
    def __init__(self, sb, bucket, saida: Path | str, agora: datetime | None = None):
        self.sb, self.bucket, self.saida, self.agora = sb, bucket, Path(saida), agora

    # ---------------------------------------------------------- rodada
    def rodar(self, parte: str = "1/1", abrir_fonte=None) -> dict:
        abrir_fonte = abrir_fonte or abrir_fonte_padrao
        tot: Counter = Counter()
        pend = self.sb.rpc("importacao_voz_pendente", {"parte": parte}) or {}
        for a in pend.get("apagar") or []:
            try:
                self.sb.apagar_arquivos(F.BUCKET_ENVIO, list(a.get("caminhos") or []))
                self.sb.rpc("marcar_envio_gravacoes_apagado", {"lote": a["lote"]})
                tot["lotes_apagados"] += 1
            except Exception as ex:   # noqa: BLE001 — tenta de novo na próxima rodada
                log.warning("importador: apagar o lote %s falhou (%s)", a.get("lote"), ex.__class__.__name__)
                tot["erros"] += 1
        for f in pend.get("fontes") or []:
            if f.get("forma") == "arquivo":
                for lote in f.get("lotes") or []:
                    tot.update(self.executar(f, "envio", lote=lote, abrir_fonte=abrir_fonte))
            else:
                tot.update(self.executar(f, f.get("motivo") or "agendada", abrir_fonte=abrir_fonte))
        return dict(tot)

    def executar(self, f: dict, origem: str, lote: dict | None = None, abrir_fonte=None) -> Counter:
        cont: Counter = Counter()
        try:
            eid = self.sb.rpc("iniciar_importacao_voz", {"fonte": f["fonte_id"], "origem": origem,
                                                          "lote": lote["id"] if lote else None})
        except Exception as ex:   # noqa: BLE001 — lote já pego por outra rodada, fonte pausada no meio
            log.warning("importador: fonte %s não iniciou (%s)", f.get("fonte_id"), ex.__class__.__name__)
            cont["erros"] += 1
            return cont
        cont["execucoes"] += 1
        erro = None
        fonte = None
        try:
            if not f.get("bucket"):
                raise F.ErroFonte("a empresa ainda não tem bucket de gravações (voz_config.bucket_gravacoes)", False)
            fonte = (abrir_fonte or abrir_fonte_padrao)(self.sb, f, lote)
            pacotes = fonte.pacotes()
            if f.get("forma") == "sftp" and pacotes and not f.get("reprocessar"):
                lidos = set(self.sb.rpc("arquivos_lidos_importacao_voz",
                                        {"fonte": f["fonte_id"], "assinaturas": [p.assinatura for p in pacotes]}) or [])
                cont["ja_lidos"] += sum(1 for p in pacotes if p.assinatura in lidos)
                pacotes = [p for p in pacotes if p.assinatura not in lidos]
            for p in pacotes:
                cont.update(self.pacote(eid, f, p))
        except F.ErroFonte as ex:
            erro = str(ex)
        except Exception as ex:   # noqa: BLE001 — erro inesperado fecha a execução com o tipo, sem detalhe
            log.warning("importador: fonte %s falhou (%s)", f.get("fonte_id"), ex.__class__.__name__)
            erro = f"falha inesperada ({ex.__class__.__name__})"
        finally:
            if fonte is not None and hasattr(fonte, "fechar"):
                fonte.fechar()
        if erro:
            cont["erros"] += 1
        self.sb.rpc("concluir_importacao_voz", {"execucao": eid, "erro": _erro_seguro(erro) if erro else None})
        return cont

    def pacote(self, eid: int, f: dict, p: F.Pacote) -> Counter:
        """Um manifesto: valida, casa, sobe, grava e registra. Devolve as contagens (sem dado pessoal)."""
        c: Counter = Counter()
        rel = {"nome": _nome_seguro(p.nome), "assinatura": p.assinatura}
        try:
            leitura = M.ler(p.ler_manifesto(), p.nome, int(f["empresa_id"]), f.get("carteiras") or {}, f.get("forma"),
                            self.agora)
        except M.ErroManifesto as ex:
            rel.update(erro=_erro_seguro(str(ex)))
            self.sb.rpc("registrar_arquivo_importacao_voz", {"execucao": eid, "arquivo": rel})
            c["arquivos_recusados"] += 1
            return c
        except (F.ErroAudio, F.ErroFonte) as ex:     # manifesto que não deu para ler (passageiro)
            rel.update(erro=_erro_seguro(f"manifesto não lido: {getattr(ex, 'detalhe', '') or ex}"), repetir=True)
            self.sb.rpc("registrar_arquivo_importacao_voz", {"execucao": eid, "arquivo": rel})
            c["erros"] += 1
            return c
        rej = list(leitura.rejeicoes)
        n = Counter()
        for i in range(0, len(leitura.linhas), LOTE_DB):
            bloco = leitura.linhas[i:i + LOTE_DB]
            prep = self.sb.rpc("preparar_importacao_voz", {"execucao": eid, "linhas": [{
                "chave": ln.chave, "id_chamada_motorcx": ln.id_chamada_motorcx, "inicio": ln.inicio.isoformat(),
                "duracao_s": ln.duracao_s, "id_cliente": ln.id_cliente, "id_acao": ln.id_acao,
                "credor_id": ln.credor_id} for ln in bloco]}) or []
            por_chave = {r["chave"]: r for r in prep}
            novas: list[tuple[M.Linha, dict, str, bytes]] = []
            ligar: list[dict] = []
            for ln in bloco:
                r = por_chave.get(ln.chave) or {"situacao": "quarentena", "motivo": "outro"}
                if r.get("existe"):
                    n["duplicadas"] += 1
                    # a avulsa que agora tem par: só liga a chamada (sem subir de novo)
                    if r.get("situacao") == "casada" and r.get("chamada_id") and not r.get("chamada_atual"):
                        ligar.append(self._registro(ln, r, r["caminho"], f))
                        n["casadas"] += 1
                    continue
                if r.get("situacao") not in ("casada", "avulsa"):
                    rej.append(M.Rejeicao(ln.n, ln.ref, r.get("motivo") or "sem_par", _detalhe_par(r.get("motivo"))))
                    continue
                try:
                    dados = p.ler_audio(ln)
                except F.ErroAudio as ex:
                    rej.append(M.Rejeicao(ln.n, ln.ref, ex.motivo, ex.detalhe[:120]))
                    continue
                if not M.audio_confere(ln.extensao, dados):
                    rej.append(M.Rejeicao(ln.n, ln.ref, "audio_invalido", f"conteúdo não é {ln.extensao} ou está corrompido"))
                    continue
                objeto = f"discador/{ln.inicio:%Y/%m/%d}/{ln.chave}.{ln.extensao}"
                self.bucket.enviar(f["bucket"], objeto, dados, M.TIPOS[ln.extensao])
                novas.append((ln, r, objeto, dados))
            linhas_db = ligar + [self._registro(ln, r, objeto, f) for ln, r, objeto, _ in novas]
            feitos = {}
            if linhas_db:
                feitos = {x["chave"]: x for x in self.sb.rpc("registrar_importacao_voz",
                                                             {"execucao": eid, "gravacoes": linhas_db}) or []}
            for ln, r, objeto, dados in novas:
                x = feitos.get(ln.chave)
                if not x:
                    rej.append(M.Rejeicao(ln.n, ln.ref, "outro", "não gravou no banco"))
                    continue
                if not x.get("nova"):
                    n["duplicadas"] += 1
                    continue
                n["importadas"] += 1
                n["casadas"] += r.get("situacao") == "casada"
                n["sem_operador"] += not ln.operador_ref
                n["segundos"] += ln.duracao_s
                if f.get("transcrever"):
                    deixar_para_transcrever(self.saida, int(f["empresa_id"]), int(x["gravacao_id"]), ln.extensao,
                                            dados, ln.duracao_s, f["bucket"], objeto)
                    n["para_transcrever"] += 1
        motivos = Counter(r.motivo for r in rej)
        rel.update(linhas=leitura.total, importadas=n["importadas"], casadas=n["casadas"], duplicadas=n["duplicadas"],
                   rejeitadas=len(rej), sem_operador=n["sem_operador"], minutos=round(n["segundos"] / 60, 1),
                   motivos=dict(motivos),
                   quarentena=[r.para_banco() for r in sorted(rej, key=lambda r: r.linha)[:MAX_QUARENTENA]])
        self.sb.rpc("registrar_arquivo_importacao_voz", {"execucao": eid, "arquivo": rel})
        c.update(arquivos=1, linhas=leitura.total, importadas=n["importadas"], casadas=n["casadas"],
                 duplicadas=n["duplicadas"], rejeitadas=len(rej), para_transcrever=n["para_transcrever"])
        return c

    @staticmethod
    def _registro(ln: M.Linha, r: dict, objeto: str, f: dict) -> dict:
        return {"chave": ln.chave, "caminho": objeto, "chamada_id": r.get("chamada_id"),
                "credor_id": r.get("credor_id"), "id_cliente": r.get("id_cliente"), "id_acao": r.get("id_acao"),
                "operador_ref": ln.operador_ref, "duracao_s": ln.duracao_s, "gravada_em": ln.inicio.isoformat(),
                "transcrever": bool(f.get("transcrever"))}


DETALHE_PAR = {
    "sem_par": "sem transferência do agente de IA que case (id ou janela de tempo)",
    "par_ambiguo": "mais de uma transferência na janela: não casa no palpite",
    "par_conflitante": "o id_cliente não é o da chamada da transferência",
    "chamada_com_gravacao": "a chamada já tem outra gravação do discador",
    "sem_cliente": "sem par e sem id_cliente: não dá para guardar avulsa",
}


def _detalhe_par(motivo: str | None) -> str:
    return DETALHE_PAR.get(motivo or "", "")


# ------------------------------------------------------------------ fontes de verdade (VM)
def abrir_fonte_padrao(sb, f: dict, lote: dict | None, segredos=None):   # pragma: no cover - rede/cofre
    forma = f.get("forma")
    if forma == "arquivo":
        return F.FonteEnvio(sb, lote or {})
    if segredos is None:
        from voz.segredos import SecretManager
        segredos = SecretManager()
    cred = None
    if f.get("segredo_ref"):
        try:
            cred = segredos.valor(f["segredo_ref"])
        except Exception as ex:   # noqa: BLE001 — sem o segredo não há leitura (a equipe grava no cofre)
            raise F.ErroFonte(f"credencial indisponível no cofre ({ex.__class__.__name__})", repetir=False) from None
    if forma == "sftp":
        if not cred:
            raise F.ErroFonte("SFTP sem credencial no cofre", repetir=False)
        return F.FonteSFTP(f, F.conectar_sftp(f, cred))
    if forma == "url":
        return F.FonteHTTPS(f, token=cred)
    raise F.ErroFonte(f"forma {forma!r} sem importador (sob demanda)", repetir=False)


def ligado(ambiente=None) -> bool:
    amb = os.environ if ambiente is None else ambiente
    return (amb.get("MOTORCX_IMPORTADOR_GRAVACOES") or "").strip() == "1"


def main(argv=None, ambiente=None, sb=None, bucket=None) -> int:
    ap = argparse.ArgumentParser(description="Importador das gravações do discador do cliente (SQL 64)")
    ap.add_argument("--parte", default="1/1")
    ap.add_argument("--saida", default="/var/motorcx/importadas", help="fila local do Whisper")
    a = ap.parse_args(argv)
    if not re.match(r"^[1-9][0-9]?/[1-9][0-9]?$", a.parte):
        ap.error("--parte i/n")
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    if not ligado(ambiente):
        print(json.dumps({"desligado": True, "motivo": "MOTORCX_IMPORTADOR_GRAVACOES != 1"}))
        return 0
    if sb is None:   # pragma: no cover - VM
        from voz.configuracao import supabase_do_ambiente
        sb = supabase_do_ambiente()
    out = Importador(sb, bucket or BucketGCS(), a.saida).rodar(a.parte)
    print(json.dumps(out, ensure_ascii=False, sort_keys=True))
    return 0


if __name__ == "__main__":   # pragma: no cover
    sys.exit(main())
