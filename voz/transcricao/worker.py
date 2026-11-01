"""Worker de transcrição das gravações do DISCADOR DO CLIENTE (a parte humana depois da transferência e as
gravações importadas; decisão 21: as chamadas da IA usam o texto da própria conversa, sem custo extra).

Para cada gravação pendente da fonte:
  - empresa com transcrever desligado      -> situação "desligada";
  - duração < transcrever_min_segundos      -> "abaixo_limiar" (não transcreve, não extrai, não cobra; decisão 4a);
  - senão transcreve (Whisper local, reserva por API), REDIGE CPF e cartão e só então salva -> "ok";
  - erro                                    -> "erro" (tenta de novo na próxima rodada, até max_tentativas).
O texto bruto nunca é gravado: só a versão redigida (voz/transcricao/redacao.py). Situação final (ok, abaixo do
limiar, desligada ou erro no limite de tentativas): o áudio local sai da VM (já está no bucket da empresa).

  python3 -m voz.transcricao.worker --dados /run/motorcx/voz.json --entrada /var/motorcx/importadas \\
      --saida /var/motorcx/transcricoes [--modelo medium] [--reserva-api] [--registrar]

Fonte padrão (FontePasta): <entrada>/empresa_<id>/<id_gravacao>.<wav|mp3|ogg|opus|flac|m4a> (+ <id_gravacao>.json
com duracao_s), que o importador (voz/importador/rotina.py, SQL 64) deixa na VM. Com --registrar, a situação de cada
gravação vai ao banco (registrar_transcricao_voz, nos dois acessos da VM): voz_gravacoes.transcricao e, na 1ª vez
que dá certo, os minutos no item voz_transcricao (custo para a margem e quantidade da fatura, SQL 61). Banco fora:
fica marcado na pasta e vai na próxima rodada.
"""
from __future__ import annotations

import argparse
import contextlib
import json
import logging
import os
import re
import sys
import wave
from dataclasses import dataclass
from pathlib import Path

from voz import banco as B
from voz.transcricao.redacao import redigir
from voz.transcricao.transcritores import ApiTranscricao, ComReserva, Transcritor, WhisperLocal

log = logging.getLogger("motorcx.voz")
ID = re.compile(r"^[A-Za-z0-9_\-]{1,80}$")
EXT_AUDIO = ("wav", "mp3", "ogg", "opus", "flac", "m4a")
FINAIS = ("ok", "abaixo_limiar", "desligada")


@dataclass
class Gravacao:
    id: str
    empresa_id: int
    caminho: Path
    duracao_s: float | None = None


def duracao_wav(caminho: Path) -> float | None:
    try:
        with contextlib.closing(wave.open(str(caminho), "rb")) as w:
            return w.getnframes() / float(w.getframerate())
    except (wave.Error, EOFError, OSError):
        return None


class FontePasta:
    """Gravações numa pasta local; a situação fica em <id>.situacao.json ao lado (sem dado pessoal). apagar_audio:
    na situação final o áudio (e o .json de duração) sai do disco da VM; a situação fica para o registro."""

    def __init__(self, pasta: str | Path, max_tentativas: int = 3, apagar_audio: bool = True):
        self.pasta, self.max_tentativas, self.apagar_audio = Path(pasta), max_tentativas, apagar_audio

    def pendentes(self) -> list[Gravacao]:
        out = []
        audios = [a for ext in EXT_AUDIO for a in self.pasta.glob(f"empresa_*/*.{ext}")]
        for arq in sorted(audios):
            if not ID.match(arq.stem):
                continue
            sit = self._situacao(arq)
            if sit.get("situacao") in ("ok", "abaixo_limiar", "desligada") or \
                    sit.get("tentativas", 0) >= self.max_tentativas:
                continue
            meta = arq.with_suffix(".json")
            dur = None
            if meta.exists():
                with contextlib.suppress(ValueError, TypeError):
                    dur = float(json.loads(meta.read_text(encoding="utf-8")).get("duracao_s"))
            out.append(Gravacao(arq.stem, int(arq.parent.name.split("_", 1)[1]), arq, dur))
        return out

    def _situacao(self, arq: Path) -> dict:
        s = arq.with_name(arq.stem + ".situacao.json")
        return json.loads(s.read_text(encoding="utf-8")) if s.exists() else {}

    def marcar(self, g: Gravacao, situacao: str, **dados) -> None:
        anterior = self._situacao(g.caminho)
        tent = anterior.get("tentativas", 0) + (1 if situacao == "erro" else 0)
        final = situacao in FINAIS or tent >= self.max_tentativas
        g.caminho.with_name(g.id + ".situacao.json").write_text(
            json.dumps({"situacao": situacao, "tentativas": tent, "final": final, "registrado": False,
                        "empresa_id": g.empresa_id, **dados}, ensure_ascii=False), encoding="utf-8")
        if final and self.apagar_audio:
            g.caminho.unlink(missing_ok=True)
            g.caminho.with_suffix(".json").unlink(missing_ok=True)

    def nao_registrados(self) -> dict[int, list[dict]]:
        """{empresa: [{gravacao_id, situacao, duracao_s}]} das gravações do importador (id numérico) com situação
        final ainda não registrada no banco."""
        out: dict[int, list[dict]] = {}
        for s in sorted(self.pasta.glob("empresa_*/*.situacao.json")):
            gid = s.name[: -len(".situacao.json")]
            if not gid.isdigit():
                continue
            try:
                d = json.loads(s.read_text(encoding="utf-8"))
            except (ValueError, OSError):
                continue
            if not d.get("final") or d.get("registrado"):
                continue
            emp = int(s.parent.name.split("_", 1)[1])
            out.setdefault(emp, []).append({"gravacao_id": int(gid), "situacao": d.get("situacao"),
                                            "duracao_s": d.get("duracao_s")})
        return out

    def marcar_registrado(self, empresa_id: int, ids: list[int]) -> None:
        for gid in ids:
            s = self.pasta / f"empresa_{int(empresa_id)}" / f"{int(gid)}.situacao.json"
            try:
                d = json.loads(s.read_text(encoding="utf-8"))
            except (ValueError, OSError):
                continue
            d["registrado"] = True
            s.write_text(json.dumps(d, ensure_ascii=False), encoding="utf-8")


def registrar_no_banco(sb, fonte: FontePasta) -> dict:
    """Manda ao banco a situação final das gravações importadas (registrar_transcricao_voz). Erro numa empresa não
    segura as outras; o que não foi fica para a próxima rodada."""
    out = {"empresas": 0, "registradas": 0, "minutos": 0.0, "erros": 0}
    for emp, itens in fonte.nao_registrados().items():
        for i in range(0, len(itens), 500):
            bloco = itens[i:i + 500]
            try:
                r = sb.rpc("registrar_transcricao_voz", {"empresa": emp, "itens": bloco}) or {}
            except Exception as ex:   # noqa: BLE001
                log.warning("transcrição: registro da empresa %s falhou (%s)", emp, ex.__class__.__name__)
                out["erros"] += 1
                break
            fonte.marcar_registrado(emp, [x["gravacao_id"] for x in bloco])
            out["registradas"] += len(bloco)
            out["minutos"] += float(r.get("minutos") or 0)
        out["empresas"] += 1
    return out


class DestinoPasta:
    """Transcrição redigida em <saida>/empresa_<id>/<id>.json (0600)."""

    def __init__(self, pasta: str | Path):
        self.pasta = Path(pasta)

    def salvar(self, g: Gravacao, conteudo: dict) -> Path:
        arq = self.pasta / f"empresa_{g.empresa_id}" / f"{g.id}.json"
        arq.parent.mkdir(parents=True, exist_ok=True)
        fd = os.open(arq, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(conteudo, f, ensure_ascii=False)
        return arq


class Worker:
    def __init__(self, dados: B.DadosVoz, fonte, destino, transcritor: Transcritor):
        self.dados, self.fonte, self.destino, self.transcritor = dados, fonte, destino, transcritor

    def processar(self) -> dict:
        cont = {"ok": 0, "abaixo_limiar": 0, "desligada": 0, "erro": 0}
        for g in self.fonte.pendentes():
            cfg = self.dados.config(g.empresa_id)
            if not cfg.transcrever:
                self.fonte.marcar(g, "desligada")
                cont["desligada"] += 1
                continue
            dur = g.duracao_s if g.duracao_s is not None else duracao_wav(g.caminho)
            if dur is None or dur < cfg.transcrever_min_segundos:
                self.fonte.marcar(g, "abaixo_limiar", duracao_s=dur)
                cont["abaixo_limiar"] += 1
                continue
            try:
                t = self.transcritor.transcrever(g.caminho, "pt")
            except Exception as ex:   # noqa: BLE001
                log.warning("transcrição %s falhou (%s)", g.id, ex.__class__.__name__)
                self.fonte.marcar(g, "erro", erro=ex.__class__.__name__)
                cont["erro"] += 1
                continue
            texto, red = redigir(t.texto)          # a contagem vem do texto inteiro (os segmentos repetem)
            segs = [{"inicio": s.inicio, "fim": s.fim, "texto": redigir(s.texto)[0], "locutor": s.locutor}
                    for s in t.segmentos]
            self.destino.salvar(g, {"id": g.id, "empresa_id": g.empresa_id, "duracao_s": round(dur, 1),
                                    "motor": t.motor, "idioma": t.idioma, "texto": texto, "segmentos": segs,
                                    "redigidos": red})
            self.fonte.marcar(g, "ok", duracao_s=round(dur, 1), motor=t.motor)
            cont["ok"] += 1
        return cont


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="Transcrição das gravações do discador do cliente (Whisper)")
    ap.add_argument("--dados", required=True)
    ap.add_argument("--entrada", required=True)
    ap.add_argument("--saida", required=True)
    ap.add_argument("--modelo", default=os.environ.get("MOTORCX_WHISPER_MODELO", "medium"))
    ap.add_argument("--reserva-api", action="store_true", help="API como reserva (segredo motorcx-voz-transcricao-api)")
    ap.add_argument("--registrar", action="store_true", help="manda a situação e os minutos ao banco (SQL 64)")
    a = ap.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    dados = B.carregar(json.loads(Path(a.dados).read_text(encoding="utf-8")))
    reserva = None
    if a.reserva_api:
        from voz.segredos import SecretManager
        reserva = ApiTranscricao(SecretManager().valor("voz/transcricao-api"))
    fonte = FontePasta(a.entrada)
    w = Worker(dados, fonte, DestinoPasta(a.saida),
               ComReserva(WhisperLocal(a.modelo, pasta_modelos=os.environ.get("MOTORCX_WHISPER_PASTA")), reserva))
    out = w.processar()
    if a.registrar:
        try:
            from voz.configuracao import supabase_do_ambiente
            out["registro"] = registrar_no_banco(supabase_do_ambiente(), fonte)
        except Exception as ex:   # noqa: BLE001 — banco fora: fica para a próxima rodada
            log.warning("transcrição: sem acesso ao banco para registrar (%s)", ex.__class__.__name__)
    print(json.dumps(out, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
