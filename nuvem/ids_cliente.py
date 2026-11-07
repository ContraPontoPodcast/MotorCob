"""Troca dos ids antigos (CPF) no banco e no Storage, depois da troca local (motor/pseudonimo.migrar_pasta).

A montagem da carteira troca, uma vez por pasta, o id que era CPF pelo código pseudônimo no estado e nas saídas
locais e deixa os pares em estado/rechavear_banco.json. Aqui a rotina manda os pares ao banco (RPC
`rechavear_clientes`, SQL 73: estado_cliente, fila_dia, trilha, voz, mensageria…; o banco nunca guarda os pares),
republica no Storage os dias de saída que mudaram (as listas antigas deixam de ter o CPF no id) e apaga o arquivo.
Banco sem o SQL 73: o arquivo fica e a rotina tenta de novo na próxima rodada (alerta "BANCO").
"""
import json
from pathlib import Path

from motor.pseudonimo import PENDENTE

ALERTA_SQL73 = ("BANCO: rode o SQL 73 (supabase/migrations/20270109000001_id_cliente_sem_cpf.sql): o banco ainda tem "
                "clientes antigos com o CPF no lugar do id; a rotina troca assim que a função existir")


def aplicar_pendente(sb, empresa_id, credor_id, pasta: Path, prefixo_do_dia, publicar, out=print) -> str | None:
    """Manda os pares pendentes ao banco e republica os dias de saída trocados. Devolve um alerta ou None.
    prefixo_do_dia(dia) → caminho no bucket saidas; publicar(sb, pasta_do_dia, prefixo) sobe a pasta."""
    arq = Path(pasta) / "estado" / PENDENTE
    if not arq.exists():
        return None
    dados = json.loads(arq.read_text(encoding="utf-8"))
    pares = [{"de": k, "para": v} for k, v in sorted((dados.get("pares") or {}).items())]
    trocados = 0
    try:
        for i in range(0, len(pares), 500):
            r = sb.rpc("rechavear_clientes", {"empresa": empresa_id, "credor": credor_id, "pares": pares[i:i + 500]})
            trocados += int(r or 0) if not isinstance(r, list) else 0
    except Exception as ex:  # noqa: BLE001 — banco sem o SQL 73: tenta de novo na próxima rodada
        out(f"  ids: troca no banco pendente ({str(ex)[:160]})")
        return ALERTA_SQL73
    for dia in dados.get("dias") or []:
        pasta_dia = Path(pasta) / "saida" / dia
        if pasta_dia.is_dir():
            try:
                publicar(sb, pasta_dia, prefixo_do_dia(dia))
            except Exception as ex:  # noqa: BLE001 — o dia fica para a próxima rodada
                out(f"  ids: saída de {dia} não republicada ({str(ex)[:160]})")
                return f"LISTAS: a saída de {dia} ainda não foi republicada com o código do cliente (tenta de novo)"
    arq.unlink()
    out(f"  ids: {len(pares)} clientes antigos passaram do CPF para o código ({trocados} linhas no banco, "
        f"{len(dados.get('dias') or [])} dias de saída republicados)")
    return None
