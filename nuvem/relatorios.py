"""Relatórios (SQL 39): foto diária da carteira, exportação grande em segundo plano e envio por e-mail agendado.

* foto(sb): uma vez por dia (a partir das 20h de São Paulo) o banco guarda os totais da carteira por situação,
  segmento, safra e etapa; ficam 90 dias e, para sempre, a última foto de cada mês.
* exportar(sb): um arquivo por rodada. O banco já conferiu a permissão e o tamanho no pedido (até 1 milhão de
  linhas); aqui as linhas vêm em páginas de 50 mil, viram Excel ou CSV no bucket privado "relatorios" e o link
  (7 dias) chega no sino de quem pediu.
* expirar(sb): uma vez por dia apaga os arquivos vencidos.
* enviar(sb): a cada 10 minutos, cada envio agendado na hora vai para a função "relatorios", que monta o e-mail
  (os números do topo e um link, sem anexo) e manda só para quem ainda pode ver.
Banco sem o SQL 39: nada acontece e o plantão segue.
"""
import csv
import io
import json
from datetime import date, datetime, timedelta, timezone

PAGINA = 50_000
LIMITE = 1_000_000
VALIDADE = 7 * 86400
TRAVADA = timedelta(minutes=30)        # "processando" há mais que isso: o motor caiu no meio; começa de novo


def foto(sb, out=print) -> int:
    try:
        n = int(sb.rpc("tirar_foto_carteira") or 0)
    except Exception as erro:  # noqa: BLE001 — banco sem o SQL 39
        out(f"relatórios: foto da carteira não saiu ({str(erro)[:120]})")
        return 0
    out(f"relatórios: foto da carteira com {n} linhas")
    return n


def _rotulos(campos: list[dict], metricas) -> dict:
    r = {c["campo"]: c["rotulo"] for c in campos}
    for m in metricas or []:
        r[m.get("nome") or ""] = m.get("rotulo") or m.get("nome") or ""
    r.update({"semana": "Semana", "mes": "Mês"})
    return r


def _valor_xlsx(v):
    if isinstance(v, str) and len(v) == 10 and v[4] == "-" and v[7] == "-":
        try:
            return date.fromisoformat(v)
        except ValueError:
            return v
    if isinstance(v, bool):
        return "Sim" if v else "Não"
    return v


def _valor_csv(v):
    if v is None:
        return ""
    if isinstance(v, bool):
        return "Sim" if v else "Não"
    if isinstance(v, float):
        return f"{v}".replace(".", ",")
    if isinstance(v, str) and len(v) == 10 and v[4] == "-" and v[7] == "-":
        return "/".join(reversed(v.split("-")))
    return str(v)


def montar_arquivo(linhas_por_pagina, colunas: list[str], rotulos: dict, formato: str) -> bytes:
    """Excel (uma planilha, cabeçalho com o nome de cada coluna) ou CSV com ; e UTF-8 com BOM (abre certo no Excel)."""
    cab = [rotulos.get(c, c) for c in colunas]
    if formato == "csv":
        buf = io.StringIO()
        w = csv.writer(buf, delimiter=";", lineterminator="\r\n")
        w.writerow(cab)
        for pagina in linhas_por_pagina:
            for l in pagina:
                w.writerow([_valor_csv(l.get(c)) for c in colunas])
        return ("﻿" + buf.getvalue()).encode("utf-8")
    from openpyxl import Workbook
    wb = Workbook(write_only=True)
    ws = wb.create_sheet("Relatório")
    ws.append(cab)
    for pagina in linhas_por_pagina:
        for l in pagina:
            ws.append([_valor_xlsx(l.get(c)) for c in colunas])
    saida = io.BytesIO()
    wb.save(saida)
    return saida.getvalue()


def _colunas(e: dict, campos: list[dict]) -> list[str]:
    if e.get("agrupar") or e.get("metricas"):
        return list(e.get("agrupar") or []) + [m.get("nome") for m in (e.get("metricas") or [])]
    return list(e.get("colunas") or [c["campo"] for c in sorted(campos, key=lambda c: c.get("ordem") or 0)])


def exportar(sb, out=print, agora: datetime | None = None) -> int | None:
    """Prepara um arquivo pedido (o mais antigo). Devolve o id ou None."""
    from nuvem import avisos
    agora = agora or datetime.now(timezone.utc)
    try:
        fila = sb.selecionar("relatorio_exportacoes", {"situacao": "in.(pendente,processando)"}, ordem="criado_em.asc",
                             limite=5) or []
    except Exception:  # noqa: BLE001 — banco sem o SQL 39
        return None
    e = next((x for x in fila if x["situacao"] == "pendente"
              or datetime.fromisoformat(str(x.get("iniciado_em") or x["criado_em"]).replace("Z", "+00:00")) < agora - TRAVADA),
             None)
    if not e:
        return None
    sb.atualizar("relatorio_exportacoes", {"id": f"eq.{e['id']}"},
                 {"situacao": "processando", "linhas_feitas": 0, "iniciado_em": agora.isoformat()})
    metricas = e.get("metricas") or []
    if isinstance(metricas, str):
        metricas = json.loads(metricas)
        e["metricas"] = metricas
    try:
        total = min(int(e.get("linhas_total") or LIMITE), LIMITE)

        def paginas():
            feitas = 0
            while feitas < total:
                pag = sb.rpc("rodar_relatorio_pagina", {
                    "base": e["base"], "colunas": e.get("colunas"), "filtros": e["filtros"], "agrupar": e.get("agrupar"),
                    "metricas": metricas or None, "ordem": e.get("ordem"), "inicio": feitas,
                    "qtd": min(PAGINA, total - feitas)}) or []
                pag = [x.get("rodar_relatorio_pagina", x) if isinstance(x, dict) and "rodar_relatorio_pagina" in x else x
                       for x in pag]
                if not pag:
                    return
                feitas += len(pag)
                sb.atualizar("relatorio_exportacoes", {"id": f"eq.{e['id']}"}, {"linhas_feitas": feitas})
                yield pag
                if len(pag) < PAGINA:
                    return

        campos = sb.selecionar("relatorio_campos", {"base": f"eq.{e['base']}"}) or []
        contagem = []

        def contadas():                    # página por página, direto no arquivo (sem 1 milhão de linhas na memória)
            for pag in paginas():
                contagem.append(len(pag))
                yield pag

        conteudo = montar_arquivo(contadas(), _colunas(e, campos), _rotulos(campos, metricas), e["formato"])
        caminho = f"{e['empresa_id']}/{e['id']}.{e['formato']}"
        tipo = "text/csv" if e["formato"] == "csv" else \
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        sb.enviar("relatorios", caminho, conteudo, tipo)
        link = sb.link_assinado("relatorios", caminho, VALIDADE)
        linhas = sum(contagem)
        expira = agora + timedelta(seconds=VALIDADE)
        sb.atualizar("relatorio_exportacoes", {"id": f"eq.{e['id']}"}, {
            "situacao": "pronta", "arquivo": caminho, "link": link, "linhas_feitas": linhas,
            "expira_em": expira.isoformat(), "concluido_em": datetime.now(timezone.utc).isoformat(), "erro": None})
        avisos.criar(sb, "usuario", f"Arquivo pronto: {e['nome']}",
                     f"{linhas:,} linhas · {'Excel' if e['formato'] == 'xlsx' else 'CSV'} · baixar até "
                     f"{(expira - timedelta(hours=3)).strftime('%d/%m')}".replace(",", "."),
                     "pronto", e["empresa_id"], e["pedido_por"], f"/relatorios?exportacao={e['id']}",
                     f"exportacao:{e['id']}")
        out(f"relatórios: arquivo {e['id']} pronto ({linhas} linhas)")
    except Exception as erro:  # noqa: BLE001 — registra para a pessoa e segue
        motivo = str(getattr(erro, "corpo", "") or erro)[:300]
        sb.atualizar("relatorio_exportacoes", {"id": f"eq.{e['id']}"}, {"situacao": "erro", "erro": motivo})
        avisos.criar(sb, "usuario", f"O arquivo não saiu: {e['nome']}",
                     "Tente de novo com um período menor. Se repetir, fale com o Suporte.", "erro", e["empresa_id"],
                     e["pedido_por"], f"/relatorios?exportacao={e['id']}", f"exportacao_erro:{e['id']}")
        out(f"relatórios: arquivo {e['id']} com erro ({motivo[:120]})")
    return e["id"]


def expirar(sb, out=print) -> int:
    try:
        vencidas = sb.rpc("exportacoes_vencidas") or []
    except Exception:  # noqa: BLE001
        return 0
    caminhos = [v["arquivo"] for v in vencidas if v.get("arquivo")]
    if caminhos:
        sb.apagar_arquivos("relatorios", caminhos)
        out(f"relatórios: {len(caminhos)} arquivo(s) vencido(s) apagados")
    return len(vencidas)


def enviar(sb, out=print) -> int:
    try:
        devidos = sb.rpc("envios_relatorio_devidos") or []
    except Exception:  # noqa: BLE001 — banco sem o SQL 39
        return 0
    n = 0
    for item in devidos:
        eid = item if isinstance(item, int) else (item.get("envios_relatorio_devidos") if isinstance(item, dict) else item)
        try:
            r = sb.funcao("relatorios", {"acao": "enviar_resumo", "envio": int(eid)}) or {}
            if r.get("enviado_para"):
                n += 1
                out(f"relatórios: e-mail do envio {eid} para {len(r['enviado_para'])} pessoa(s)")
        except Exception as erro:  # noqa: BLE001 — a função marca o erro; o motor só registra
            out(f"relatórios: envio {eid} não saiu ({str(erro)[:120]})")
            try:
                sb.rpc("marcar_envio_relatorio", {"envio": int(eid), "erro": str(erro)[:300]})
            except Exception:  # noqa: BLE001
                pass
    return n
