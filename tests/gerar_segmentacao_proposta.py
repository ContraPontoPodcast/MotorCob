"""Gera tests/dados/segmentacao_proposta_dono.json: a proposta compilada do exemplo do dono e casos de respostas com o
resultado esperado. O site (lib/segmentacao-ia.test.tsx) aplica os mesmos patches e precisa chegar ao mesmo resultado
(paridade motor × site). tests/test_segmentacao_ia.py confere que o arquivo está em dia.
    python3 tests/gerar_segmentacao_proposta.py"""
import json
import sys
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(RAIZ))
from motor import segmentacao_ia as SI  # noqa: E402
from tests.test_segmentacao_ia import CTX, ENTREGA, com_respostas  # noqa: E402

CASOS = [{"ticket": "parcela", "a2": "alterar", "a1cpc": "diario"},
         {"demais": "a1", "a1d1": "junto", "xbloq": "segmento", "b1estr": "manter", "bpers": "map"}]
ARQ = RAIZ / "tests" / "dados" / "segmentacao_proposta_dono.json"


def montar() -> str:
    prop, erros = SI.compilar(ENTREGA, CTX)
    assert not erros, erros
    casos = []
    for r in CASOS:
        x = com_respostas(prop, r)
        casos.append({"respostas": r, "esperado": {"ordem": x["ordem"], "demais": x["demais"],
                                                  "segmentos": {k: {c: v[c] for c in ("acao", "incluir", "condicoes", "estrategia", "definicao", "canais_bloqueados")}
                                                                for k, v in x["segmentos"].items()}}})
    personas = [{"id": p["id"], "nome": p["nome"], "canais": p["canais"]} for p in CTX["personas"]]
    return json.dumps({"_leia": "Gerado por tests/gerar_segmentacao_proposta.py (não edite à mão).", "personas": personas,
                       "proposta": prop, "casos": casos}, ensure_ascii=False, indent=None, sort_keys=True) + "\n"


if __name__ == "__main__":
    ARQ.write_text(montar(), encoding="utf-8")
    print(ARQ, ARQ.stat().st_size)
