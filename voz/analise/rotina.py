"""Rotinas do Speech Analytics na VM de voz (SQL 62), pelo agendador da VM (systemd, como a transcrição):

  analisar   a cada 15 min (motorcx-voz-speech.timer): as transcrições que o worker deixou em
             /var/motorcx/transcricoes/empresa_<id>/<ref>.json e ainda não foram analisadas → contexto do banco
             (speech_contexto_voz: gravação, versão do checklist do dia, intenções e temas) → avaliação + códigos
             numa chamada ao LLM (voz/analise/analisador.py) → gravar_analise_voz. Ao lado da transcrição fica
             <ref>.analise.json (só a situação, sem dado pessoal) para não analisar de novo. Alerta novo → sino
             (avisar_alertas_voz).
             Depois de cada análise que deu certo, as janelas da conversa (15 a 30 s por falante, mascaradas por
             redigir_trecho) vão para voz_trechos, com o embedding da Vertex (busca semântica e temas) quando o banco
             tem pgvector; o custo dos embeddings entra no componente embeddings (SQL 63). As transcrições da IA
             (ia_<id>.json, voz/transcricao/ia.py) entram aqui como as do Whisper. Transcrição com mais de 90 dias é
             apagada da pasta.
  noite      02:40 (motorcx-voz-speech-noite.timer): para cada empresa ligada desta VM (parte i/n), agregar_speech_dia
             de ontem e anteontem (idempotente: o banco apaga e recalcula), depois as regras de
             motor/retroalimentacao.py (recomendações com piso n >= 200 e 5 p.p.) e o impacto de 28 dias.
  temas      segunda 03:20 (motorcx-voz-speech-temas.timer): clusterização semanal dos trechos sem tema e sem
             intenção da semana passada (voz/analise/temas.py; SQL 63). Grupo com 30 conversas ou mais vira tema novo
             na Curadoria, com nome sugerido pela IA; a promoção é de uma pessoa.

Desligado por padrão: só roda com MOTORCX_SPEECH_ANALYTICS=1 (o motorcx-voz-rodar só passa isso com o metadado
motorcx-speech-analytics=1 da VM) e, no banco, só para empresas com voz_config.speech_analytics. Funciona nos dois
acessos da VM (voz/acesso.py): as mesmas RPCs pela chave do servidor ou pelas funções de voz_vm. O LLM é o da
Montagem (/etc/motorcx/provedores.json, chave no Secret Manager pela referência ref_llm).

    python3 -m voz.analise.rotina analisar --pasta /var/motorcx/transcricoes
    python3 -m voz.analise.rotina noite --parte 1/2
    python3 -m voz.analise.rotina temas --parte 1/2
"""
from __future__ import annotations

import argparse
import json
import logging
import os
import re
import sys
import time
from collections import Counter
from datetime import date, datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

from voz.analise import analisador as AN
from voz.analise import temas as TM
from voz.analise import trechos as TR
from voz.transcricao import ia as TIA

log = logging.getLogger("motorcx.voz.speech")
REF = re.compile(r"^[A-Za-z0-9_\-]{1,80}$")
EMPRESA = re.compile(r"^empresa_(\d{1,12})$")
MARCA = ".analise.json"
MAX_FALHAS = 3                 # tentativas com resposta inválida do LLM antes de desistir da gravação
LOTE = 200                     # refs por pedido de contexto (o banco aceita até 200)


class FonteLocal:
    """Transcrições redigidas do worker (DestinoPasta) e a marca de análise ao lado (<ref>.analise.json, 0600)."""

    def __init__(self, pasta: str | Path, dias: int = 7, relogio=time.time):
        self.pasta, self.dias, self.relogio = Path(pasta), dias, relogio

    def pendentes(self) -> dict[int, list[tuple[str, str, Path]]]:
        """{empresa: [(ref, caminho relativo, arquivo)]} dos últimos `dias`, sem marca, mais antigas primeiro."""
        limite = self.relogio() - self.dias * 86400
        out: dict[int, list] = {}
        if not self.pasta.is_dir():
            return out
        for d in sorted(self.pasta.iterdir()):
            m = EMPRESA.match(d.name)
            if not m or not d.is_dir():
                continue
            arqs = []
            for arq in d.glob("*.json"):
                if arq.name.endswith(MARCA) or not REF.match(arq.stem) or arq.with_name(arq.stem + MARCA).exists():
                    continue
                mt = arq.stat().st_mtime
                if mt >= limite:
                    arqs.append((mt, arq))
            if arqs:
                out[int(m.group(1))] = [(a.stem, f"{d.name}/{a.name}", a) for _, a in sorted(arqs)]
        return out

    @staticmethod
    def ler(arq: Path) -> dict:
        return json.loads(Path(arq).read_text(encoding="utf-8"))

    @staticmethod
    def marcar(arq: Path, situacao: str) -> None:
        marca = Path(arq).with_name(Path(arq).stem + MARCA)
        fd = os.open(marca, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump({"situacao": situacao, "em": int(time.time())}, f)


def _contexto(empresa: int, c: dict, geral: dict, modelo_nome: str) -> AN.Contexto:
    vid = c.get("versao_id")
    itens = (geral.get("checklists") or {}).get(str(vid)) if vid else None
    return AN.Contexto(
        empresa_id=int(empresa), gravacao_id=int(c["gravacao_id"]), chamada_id=int(c["chamada_id"]), origem=c["origem"],
        versao_id=int(vid) if vid else None, itens=AN.itens_aplicaveis(itens, c["origem"]),
        intencoes=tuple(geral.get("intencoes") or ()),
        temas={int(t["id"]): t.get("nome") or "" for t in geral.get("temas") or []},
        credor_id=c.get("credor_id"), operador_ref=c.get("operador_ref"), duracao_s=c.get("duracao_s"),
        transferida_s=c.get("transferida_s"), modelo=modelo_nome)


def segmentos_com_falante(segs: list[dict], falantes: str | None) -> list[dict]:
    """Segmentos mascarados com o locutor: o da transcrição (IA: agente/cliente) ou, sem ele, o que o LLM disse
    (A = empresa, C = cliente). Sem saber quem fala, o segmento não vira trecho."""
    out = []
    for i, s in enumerate(segs):
        loc = s.get("locutor")
        if not loc and falantes and i < len(falantes):
            loc = "agente" if falantes[i] == "A" else "cliente"
        if loc:
            out.append({**s, "locutor": loc})
    return out


def gravar_trechos(sb, ctx: AN.Contexto, segs: list[dict], embedder=None, com_vetor: bool = False) -> dict:
    """Janelas mascaradas em voz_trechos (com embedding quando o banco tem pgvector) e o uso dos embeddings."""
    lista = TR.janelas(segs, ctx.transferida_s)
    if not lista:
        return {"trechos": 0}
    emb = embedder if (embedder is not None and com_vetor) else None
    antes = int(getattr(emb, "tokens_entrada", 0) or 0) if emb else 0
    try:
        n = TR.gravar(sb, {"id": ctx.gravacao_id, "empresa_id": ctx.empresa_id, "credor_id": ctx.credor_id,
                           "origem": ctx.origem}, lista, emb, com_vetor)
    except Exception as ex:   # noqa: BLE001 — Vertex fora: grava sem embedding (a busca por termo funciona)
        if emb is None:
            raise
        log.warning("speech: embedding dos trechos falhou (%s); grava sem", ex.__class__.__name__)
        return {"trechos": TR.gravar(sb, {"id": ctx.gravacao_id, "empresa_id": ctx.empresa_id,
                                          "credor_id": ctx.credor_id, "origem": ctx.origem}, lista, None, False)}
    if emb is not None:
        tok = int(getattr(emb, "tokens_entrada", 0) or 0) - antes
        tok = tok or sum(len(j.texto) for j in lista) // 4 + len(lista)     # sem a contagem do provedor: estimativa
        hoje = datetime.now(ZoneInfo("America/Sao_Paulo")).date()
        TR.registrar_uso(sb, ctx.empresa_id, hoje, "embeddings", len(lista), 0, 0, tok, 0)
    return {"trechos": n}


def analisar_pendentes(sb, modelo, fonte: FonteLocal, limite: int = 200, modelo_nome: str = "", embedder=None,
                       com_vetor: bool | None = None) -> dict:
    """Uma rodada. Erro numa gravação não segura as outras. Devolve as contagens (sem dado pessoal)."""
    cont: Counter = Counter()
    vetor = {"v": com_vetor}

    def tem_vetor() -> bool:              # o banco tem pgvector? (pergunta uma vez, só se há embedder)
        if embedder is None:
            return False
        if vetor["v"] is None:
            try:
                vetor["v"] = bool(sb.rpc("speech_vetor_voz", {}))
            except Exception:   # noqa: BLE001 — banco sem o SQL 63: trechos sem embedding
                vetor["v"] = False
        return vetor["v"]
    feitos = alertas = 0
    for empresa, lista in fonte.pendentes().items():
        for i in range(0, len(lista), LOTE):
            if feitos >= limite:
                break
            lote = lista[i:i + LOTE]
            try:
                geral = sb.rpc("speech_contexto_voz", {"empresa": empresa,
                                                       "refs": [{"ref": r, "caminho": c} for r, c, _ in lote]}) or {}
            except Exception as ex:   # noqa: BLE001 — empresa sem voz, banco fora: tenta na próxima rodada
                log.warning("speech: contexto da empresa %s falhou (%s)", empresa, ex.__class__.__name__)
                cont["erro"] += len(lote)
                break
            if not geral.get("ligado"):
                cont["desligada"] += len(lote)
                break
            por_ref = {c["ref"]: c for c in geral.get("chamadas") or [] if isinstance(c, dict) and c.get("ref")}
            for ref, _caminho, arq in lote:
                if feitos >= limite:
                    break
                c = por_ref.get(ref)
                if not c:
                    cont["sem_gravacao"] += 1                # a gravação ainda não chegou ao banco
                    continue
                if c.get("ambigua"):
                    fonte.marcar(arq, "ambigua")
                    cont["ambigua"] += 1
                    continue
                if c.get("situacao") == "ok":
                    fonte.marcar(arq, "ok")
                    cont["ja_analisada"] += 1
                    continue
                if c.get("situacao") == "falhou" and int(c.get("tentativas") or 0) >= MAX_FALHAS:
                    fonte.marcar(arq, "falhou")
                    cont["desistiu"] += 1
                    continue
                saida: dict = {}
                try:
                    ctx = _contexto(empresa, c, geral, modelo_nome)
                    r = AN.processar(sb, modelo, ctx, fonte.ler(arq), saida)
                except Exception as ex:   # noqa: BLE001
                    log.warning("speech: gravação %s falhou (%s)", c.get("gravacao_id"), ex.__class__.__name__)
                    cont["erro"] += 1
                    continue
                feitos += 1
                sit = (r or {}).get("situacao")
                if sit == "ok" and saida.get("segmentos"):
                    try:          # trechos da busca e dos temas (SQL 60/63); falha aqui não desfaz a análise
                        cont["trechos"] += gravar_trechos(sb, ctx, segmentos_com_falante(saida["segmentos"],
                                                                                         saida.get("falantes")),
                                                          embedder, tem_vetor())["trechos"]
                    except Exception as ex:   # noqa: BLE001
                        log.warning("speech: trechos da gravação %s falharam (%s)", c.get("gravacao_id"),
                                    ex.__class__.__name__)
                        cont["erro_trechos"] += 1
                if sit in ("ok", "ja_analisada"):
                    fonte.marcar(arq, "ok")
                    alertas += int(r.get("alertas") or 0)
                elif sit == "sem_texto":
                    fonte.marcar(arq, "sem_texto")
                cont[sit or "sem_resposta"] += 1
    if alertas:
        try:
            sb.rpc("avisar_alertas_voz", {})
        except Exception as ex:   # noqa: BLE001 — o sino é a cada hora; o próximo pega
            log.warning("speech: sino dos alertas falhou (%s)", ex.__class__.__name__)
    cont["alertas"] = alertas
    return dict(cont)


# ------------------------------------------------------------------ noite: agregados e retroalimentação
def publicar_recomendacoes(sb, empresa: int, hoje: date) -> int:
    """As regras de motor/retroalimentacao.py sobre os agregados dos últimos 28 dias (pelas RPCs, nos dois acessos)."""
    from motor import retroalimentacao as R
    de, ate = hoje - timedelta(days=R.JANELA_DIAS), hoje - timedelta(days=1)
    d = sb.rpc("dados_retroalimentacao_voz", {"empresa": empresa, "de": de.isoformat(), "ate": ate.isoformat()}) or {}
    n = 0
    for r in R.gerar(d.get("conversao") or [], d.get("renitencia") or [], d.get("por_motivo") or []):
        if sb.rpc("registrar_recomendacao_voz", r.para_rpc(empresa)) is not None:
            n += 1
    return n


def medir_impactos(sb, empresa: int, hoje: date) -> int:
    """Antes × depois de 28 dias das recomendações aplicadas (motor/retroalimentacao.py › medir)."""
    from motor import retroalimentacao as R
    n = 0
    for rec in sb.rpc("recomendacoes_aplicadas_voz", {"empresa": empresa}) or []:
        quando = date.fromisoformat(str(rec.get("aplicada_em"))[:10])
        if (hoje - quando).days < R.JANELA_DIAS:
            continue                                     # ainda medindo
        lados = []
        for de, ate in R.janela_impacto(quando):
            d = sb.rpc("dados_retroalimentacao_voz", {"empresa": empresa, "de": de.isoformat(), "ate": ate.isoformat(),
                                                      "so_total": True}) or {}
            linhas = [x for x in d.get("conversao") or [] if x.get("dimensao") == "total"
                      and (not rec.get("credor_id") or int(x.get("credor_id") or 0) == int(rec["credor_id"]))]
            lados.append((sum(int(x["conversas"]) for x in linhas), sum(int(x["com_acordo"]) for x in linhas)))
        m = R.medir(*lados)
        if m is None:
            continue
        sb.rpc("gravar_impacto_voz", {"rec": rec["id"], "metrica": "acordo_pct", **m, "janela_dias": R.JANELA_DIAS})
        n += 1
    return n


def noite(sb, hoje: date, parte: str = "1/1", dias: int = 2, retro: bool = True) -> dict:
    out = Counter()
    empresas = sb.rpc("speech_empresas_voz", {"parte": parte}) or []
    out["empresas"] = len(empresas)
    if retro and empresas:
        try:
            sb.rpc("conferir_rascunhos_recomendacoes", {})
        except Exception as ex:   # noqa: BLE001
            log.warning("speech: conferir rascunhos falhou (%s)", ex.__class__.__name__)
            out["erros"] += 1
    for e in empresas:
        try:
            for k in range(max(1, dias), 0, -1):         # o mais antigo primeiro; hoje fica para amanhã
                sb.rpc("agregar_speech_dia", {"empresa": int(e), "dia": (hoje - timedelta(days=k)).isoformat()})
                out["dias"] += 1
            if retro:
                out["recomendacoes"] += publicar_recomendacoes(sb, int(e), hoje)
                out["impactos"] += medir_impactos(sb, int(e), hoje)
        except Exception as ex:   # noqa: BLE001 — uma empresa não segura as outras
            log.warning("speech: noite da empresa %s falhou (%s)", e, ex.__class__.__name__)
            out["erros"] += 1
    return dict(out)


# ------------------------------------------------------------------ serviço
def ligado(ambiente=None) -> bool:
    amb = os.environ if ambiente is None else ambiente
    return (amb.get("MOTORCX_SPEECH_ANALYTICS") or "").strip() == "1"


def modelo_da_vm(provedores: str = "/etc/motorcx/provedores.json", segredos=None):   # pragma: no cover - VM
    """O LLM configurado na Montagem (base, modelo e referência da chave); a chave só do Secret Manager."""
    from voz.provedores import ler_config
    from voz.provedores.montagem import ConfigMontagem, ModeloOpenAICompat
    if segredos is None:
        from voz.segredos import SecretManager
        segredos = SecretManager()
    bruto = ler_config(provedores)
    cfg = ConfigMontagem(**{k: v for k, v in (bruto.get("montagem_motorcx") or bruto.get("montagem") or {}).items()
                            if k != "portas"})
    return ModeloOpenAICompat(cfg.llm_base_url, segredos.valor(cfg.ref_llm), cfg.llm_modelo, timeout=90), cfg.llm_modelo


def embedder_da_vm(ambiente=None):   # pragma: no cover - VM
    """Vertex AI em São Paulo pela conta de serviço da VM (sem chave em arquivo); None sem o projeto."""
    amb = os.environ if ambiente is None else ambiente
    projeto = (amb.get("MOTORCX_GCP_PROJETO") or "").strip()
    return TR.EmbeddingVertex(projeto) if projeto else None


def main(argv=None, ambiente=None, sb=None, modelo=None, embedder=None) -> int:
    ap = argparse.ArgumentParser(description="Speech Analytics na VM (análise das ligações e job noturno)")
    sub = ap.add_subparsers(dest="rotina", required=True)
    a1 = sub.add_parser("analisar")
    a1.add_argument("--pasta", default="/var/motorcx/transcricoes")
    a1.add_argument("--provedores", default="/etc/motorcx/provedores.json")
    a1.add_argument("--limite", type=int, default=200)
    a1.add_argument("--dias", type=int, default=7)
    a2 = sub.add_parser("noite")
    a2.add_argument("--parte", default="1/1")
    a2.add_argument("--dias", type=int, default=2)
    a2.add_argument("--hoje", type=date.fromisoformat, default=None)
    a2.add_argument("--sem-retroalimentacao", action="store_true")
    a3 = sub.add_parser("temas")
    a3.add_argument("--parte", default="1/1")
    a3.add_argument("--provedores", default="/etc/motorcx/provedores.json")
    a3.add_argument("--hoje", type=date.fromisoformat, default=None)
    for x in (a1, a3):
        x.add_argument("--sem-embedding", action="store_true", help="não calcula embedding (só a busca por termo)")
    a = ap.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    if not ligado(ambiente):
        print(json.dumps({"desligado": True, "motivo": "MOTORCX_SPEECH_ANALYTICS != 1"}))
        return 0
    if sb is None:
        from voz.configuracao import supabase_do_ambiente
        sb = supabase_do_ambiente()
    if a.rotina in ("analisar", "temas") and embedder is None and not a.sem_embedding:
        embedder = embedder_da_vm(ambiente)
    if a.rotina == "analisar":
        nome = ""
        if modelo is None:
            modelo, nome = modelo_da_vm(a.provedores)
        out = analisar_pendentes(sb, modelo, FonteLocal(a.pasta, a.dias), a.limite, nome, embedder)
        out["expiradas"] = TIA.expirar(a.pasta, TIA.RETENCAO_DIAS)
    elif a.rotina == "temas":
        if modelo is None:
            modelo, _ = modelo_da_vm(a.provedores)
        hoje = a.hoje or datetime.now(ZoneInfo("America/Sao_Paulo")).date()
        out = TM.rodar(sb, hoje, a.parte, modelo, embedder)
    else:
        hoje = a.hoje or datetime.now(ZoneInfo("America/Sao_Paulo")).date()
        out = noite(sb, hoje, a.parte, a.dias, retro=not a.sem_retroalimentacao)
    print(json.dumps(out, ensure_ascii=False, sort_keys=True))
    return 0


if __name__ == "__main__":   # pragma: no cover
    sys.exit(main())
