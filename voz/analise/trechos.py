"""Trechos mascarados com embedding (SA14) e busca semântica (SA15) na VM.

  janelas()        segmentos da transcrição → janelas de 15 a 30 s por falante (agente, cliente e, depois do horário
                   da transferência, operador), já mascaradas (redigir_trecho) antes de qualquer embedding.
  EmbeddingVertex  Vertex AI em São Paulo (southamerica-east1), pela conta de serviço da VM (voz/gcp.py: token do
                   metadata server, sem chave em arquivo), modelo gemini-embedding-001 com 1536 dimensões — a mesma
                   dimensão da coluna voz_trechos.embedding (decisão 9 do dono).
  gravar()         grava as janelas em voz_trechos (upsert por gravação, início e falante); sem pgvector no banco,
                   grava sem embedding (a busca por termo funciona igual).
  atender_buscas() pega as buscas semânticas pendentes (buscas_voz_pendentes), calcula o embedding da pergunta e
                   chama responder_busca_voz, que procura no banco (mesma empresa, dentro da retenção) e registra.
"""
from __future__ import annotations

import json
import logging
from dataclasses import dataclass
from datetime import datetime
from zoneinfo import ZoneInfo

from voz import gcp
from voz.analise import contrato as K
from voz.transcricao.redacao import redigir_trecho

log = logging.getLogger("motorcx.voz")
MIN_S, MAX_S = 15.0, 30.0
REGIAO = "southamerica-east1"
MODELO = "gemini-embedding-001"


@dataclass
class Janela:
    inicio_s: float
    fim_s: float
    falante: str
    texto: str


def falante_de(locutor: str | None, inicio: float, transferida_s: float | None) -> str:
    """Canal/locutor da transcrição → falante. Depois da transferência, o lado da empresa é o operador humano."""
    lado_empresa = (locutor or "").lower() in ("agente", "ia", "empresa", "operador", "a")
    if not lado_empresa:
        return "cliente"
    return "operador" if transferida_s is not None and inicio >= transferida_s else "agente"


def janelas(segmentos: list[dict], transferida_s: float | None = None, nomes=()) -> list[Janela]:
    """Agrupa segmentos seguidos do mesmo falante até 30 s; fecha a janela ao trocar de falante ou ao passar de 15 s
    com o próximo segmento estourando 30 s. Texto sempre mascarado."""
    out: list[Janela] = []
    atual: Janela | None = None
    for s in sorted(segmentos, key=lambda x: float(x.get("inicio", 0))):
        ini, fim = float(s.get("inicio", 0)), float(s.get("fim", 0))
        texto = (s.get("texto") or "").strip()
        if not texto or fim < ini:
            continue
        fal = falante_de(s.get("locutor"), ini, transferida_s)
        if atual and atual.falante == fal and fim - atual.inicio_s <= MAX_S:
            atual.fim_s, atual.texto = fim, f"{atual.texto} {texto}"
            continue
        if atual:
            out.append(atual)
        atual = Janela(ini, fim, fal, texto)
    if atual:
        out.append(atual)
    for j in out:
        j.texto = redigir_trecho(j.texto, nomes)[:2000]
    return out


class Embedder:
    dimensao = K.DIMENSAO

    def vetores(self, textos: list[str]) -> list[list[float]]:
        raise NotImplementedError


class EmbeddingVertex(Embedder):
    def __init__(self, projeto: str, regiao: str = REGIAO, modelo: str = MODELO, token=None, requisitar=gcp.requisitar,
                 tarefa: str = "RETRIEVAL_DOCUMENT"):
        self.projeto, self.regiao, self.modelo = projeto, regiao, modelo
        self.tarefa = tarefa                                 # RETRIEVAL_QUERY para a pergunta da busca
        self.token = token or gcp.Token()
        self._req = requisitar
        self.tokens_entrada = 0

    def _url(self) -> str:
        return (f"https://{self.regiao}-aiplatform.googleapis.com/v1/projects/{self.projeto}/locations/{self.regiao}"
                f"/publishers/google/models/{self.modelo}:predict")

    def vetores(self, textos):
        out = []
        for t in textos:                                     # o modelo aceita uma instância por pedido
            corpo = json.dumps({"instances": [{"content": t, "task_type": self.tarefa}],
                                "parameters": {"outputDimensionality": self.dimensao}}).encode()
            d = self._req("POST", self._url(), self.token, corpo, "application/json")
            pred = d["predictions"][0]["embeddings"]
            v = pred["values"]
            if len(v) != self.dimensao:
                raise ValueError(f"embedding com {len(v)} dimensões (esperado {self.dimensao})")
            self.tokens_entrada += int((pred.get("statistics") or {}).get("token_count") or 0)
            out.append(v)
        return out


def literal(v: list[float]) -> str:
    """Vetor no formato do pgvector ('[0.1,0.2,...]'), que o PostgREST aceita como texto."""
    return "[" + ",".join(f"{x:.7g}" for x in v) + "]"


def gravar(sb, gravacao: dict, lista: list[Janela], embedder: Embedder | None, com_vetor: bool = True) -> int:
    """gravacao: {id, empresa_id, credor_id, origem}. Retorna quantos trechos foram gravados."""
    if not lista:
        return 0
    vet = embedder.vetores([j.texto for j in lista]) if (embedder and com_vetor) else None
    linhas = []
    for i, j in enumerate(lista):
        linha = {"empresa_id": gravacao["empresa_id"], "credor_id": gravacao.get("credor_id"),
                 "gravacao_id": gravacao["id"], "origem": gravacao["origem"], "inicio_s": round(j.inicio_s, 2),
                 "fim_s": round(j.fim_s, 2), "falante": j.falante, "texto_redigido": j.texto}
        if vet is not None:
            linha[K.COLUNA_EMBEDDING] = literal(vet[i])
        linhas.append(linha)
    sb.inserir("voz_trechos", linhas, conflito=K.CONFLITO["voz_trechos"])
    return len(linhas)


def atender_buscas(sb, embedder: Embedder, limite: int = 20, parte: str | None = None, dia=None) -> int:
    """Responde as buscas semânticas pendentes. Com `parte` (SQL 63: buscas_semanticas_pendentes_voz), só as da parte
    i/n desta VM e o custo do embedding da pergunta vai para a empresa (registrar_uso_ia_voz, componente embeddings,
    nada cobrado a mais); sem `parte`, o caminho do SQL 60."""
    n = 0
    if parte is not None:
        pendentes = sb.rpc("buscas_semanticas_pendentes_voz", {"parte": parte, "limite": limite}) or []
    else:
        pendentes = sb.rpc("buscas_voz_pendentes", {"limite": limite}) or []
    uso: dict = {}
    for b in pendentes:
        try:
            antes = int(getattr(embedder, "tokens_entrada", 0) or 0)
            v = embedder.vetores([b["termo"]])[0]
            tok = int(getattr(embedder, "tokens_entrada", 0) or 0) - antes or len(b["termo"]) // 4 + 1
            if b.get("empresa_id") is not None:
                u = uso.setdefault(int(b["empresa_id"]), [0, 0])
                u[0], u[1] = u[0] + 1, u[1] + tok
            sb.rpc("responder_busca_voz", {"busca": b["id"], "emb": literal(v)})
            n += 1
        except Exception as ex:   # noqa: BLE001 — a busca vira "erro" sozinha depois de 2 min
            log.warning("busca semântica %s falhou (%s)", b.get("id"), ex.__class__.__name__)
    for emp, (q, tok) in uso.items():
        try:
            registrar_uso(sb, emp, dia or datetime.now(ZoneInfo("America/Sao_Paulo")).date(), "embeddings", q, 0, 0, tok, 0)
        except Exception as ex:   # noqa: BLE001 — o uso não segura a resposta (já foi dada)
            log.warning("busca semântica: uso de IA não registrado (%s)", ex.__class__.__name__)
    return n


def registrar_uso(sb, empresa_id: int, dia, componente: str, chamadas: int, minutos: float, minutos_cobraveis: float,
                  tokens_entrada: int = 0, tokens_saida: int = 0):
    """Uso de IA (decisão 8 revista): o banco calcula o custo real pelo custo unitário (margem, só o Master) e soma a
    quantidade cobrável no item de IA da fatura. A VM nunca manda custo nem preço."""
    return sb.rpc("registrar_uso_ia_voz", {
        "empresa": empresa_id, "dia": (dia if isinstance(dia, str) else dia.isoformat()), "componente": componente,
        "chamadas": int(chamadas), "minutos": round(float(minutos), 2), "minutos_cobraveis": round(float(minutos_cobraveis), 2),
        "tokens_entrada": int(tokens_entrada), "tokens_saida": int(tokens_saida)})


def agora() -> str:
    return datetime.now().isoformat(timespec="seconds")
