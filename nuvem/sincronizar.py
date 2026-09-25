"""Sincroniza a rotina do motor com o Supabase (site motorcob.online).

    python -m nuvem.sincronizar dia    [--data AAAA-MM-DD] [--dados ~/MotorCob-dados]
    python -m nuvem.sincronizar comite --mes AAAA-MM   [--dados ~/MotorCob-dados]

dia:
  1. baixa os arquivos enviados pelo site (envios com status pendente) para a pasta de
     dados: clientes/contatos/parcelas substituem base/, retornos entram em retornos/
     com o nome original (é pelo nome que o motor acha o layout), portal vira logs/portal.csv;
  2. roda a rotina diária (rodar_dia.py);
  3. publica: estado_cliente (upsert), trilha (só o que ainda não subiu), fila_dia do dia
     (só IDs), arquivos de saida/<data>/ no bucket 'saidas', envios processados com o
     relatório de ingestão, e a execução com resumo e alertas.
  Se algo falhar, a execução fica com status 'erro' e os envios continuam pendentes.

comite: roda o relatório do mês, sobe os arquivos para saidas/comite/<mês>/ e grava kpis.

Configuração (nunca no git): variáveis MOTORCOB_SUPABASE_URL e MOTORCOB_SUPABASE_KEY
(chave service_role) ou o arquivo <dados>/config/supabase.env criado por
scripts/configurar_nuvem.sh.
"""
import argparse
import calendar
import csv
import os
import re
import sys
import traceback
from collections import Counter
from datetime import date, datetime, timezone
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(RAIZ))

from nuvem.supabase_api import Supabase  # noqa: E402

DESTINO_BASE = {"clientes": "base/clientes.csv", "contatos": "base/contatos.csv",
                "parcelas": "base/parcelas.csv", "portal": "logs/portal.csv"}
MARCADOR_TRILHA = "nuvem_trilha_enviada.txt"


def agora():
    return datetime.now(timezone.utc).isoformat()


def carregar_config(dados: Path) -> tuple[str, str]:
    url, chave = os.environ.get("MOTORCOB_SUPABASE_URL"), os.environ.get("MOTORCOB_SUPABASE_KEY")
    arq = dados / "config" / "supabase.env"
    if (not url or not chave) and arq.exists():
        for linha in arq.read_text(encoding="utf-8").splitlines():
            k, _, v = linha.partition("=")
            if k.strip() == "MOTORCOB_SUPABASE_URL":
                url = url or v.strip()
            elif k.strip() == "MOTORCOB_SUPABASE_KEY":
                chave = chave or v.strip()
    if not url or not chave:
        raise SystemExit(f"Supabase não configurado: rode scripts/configurar_nuvem.sh (ou crie {arq})")
    return url, chave


def nome_seguro(nome: str) -> str:
    """Só o nome do arquivo, sem pastas (evita gravar fora de retornos/)."""
    nome = Path(nome.replace("\\", "/")).name
    return re.sub(r"[^A-Za-z0-9._-]", "_", nome) or "arquivo.csv"


# ------------------------------------------------------------------ dia
def baixar_entradas(sb: Supabase, dados: Path, out=print):
    pendentes = sb.selecionar("envios", {"status": "eq.pendente"}, ordem="enviado_em.asc,id.asc") or []
    baixados = []
    for e in pendentes:
        try:
            conteudo = sb.baixar("entradas", e["caminho"])
        except Exception as ex:  # noqa: BLE001 — um arquivo ruim não derruba os outros
            sb.atualizar("envios", {"id": f"eq.{e['id']}"},
                         {"status": "erro", "relatorio": {"erro": f"não foi possível baixar: {ex}"}})
            out(f"  envio {e['id']} ({e['nome_original']}): erro ao baixar")
            continue
        if e["tipo"] == "retorno":
            destino = dados / "retornos" / nome_seguro(e["nome_original"])
        else:
            destino = dados / DESTINO_BASE[e["tipo"]]
        destino.parent.mkdir(parents=True, exist_ok=True)
        destino.write_bytes(conteudo)
        baixados.append((e, destino))
    out(f"  entradas: {len(baixados)} arquivo(s) baixado(s) do site")
    return baixados


def _linhas_estado(estados):
    ts = agora()
    return [{"id_cliente": k, "tag": e.tag, "safra": e.safra.isoformat(), "cluster_origem": e.cluster_origem,
             "cluster_atual": e.cluster_atual, "estado": e.estado, "canal": e.canal, "ciclo": e.ciclo,
             "reenriquecer": e.reenriquecer, "atualizado_em": ts} for k, e in estados.items()]


def _linhas_fila(fila, data):
    vistos, saida = set(), []
    for l in fila:
        chave = (l["canal"], l["id_cliente"], bool(l["condicao"]))
        if chave in vistos:
            continue
        vistos.add(chave)
        saida.append({"data": data.isoformat(), "canal": l["canal"], "id_cliente": l["id_cliente"],
                      "reserva": bool(l["condicao"]), "regua": l["regua"], "passo": l["passo"], "tag": l["tag"]})
    return saida


def publicar_trilha(sb: Supabase, pasta_estado: Path) -> int:
    """Sobe as linhas de estado/trilha.csv que ainda não foram enviadas (retomável)."""
    arq, marca = pasta_estado / "trilha.csv", pasta_estado / MARCADOR_TRILHA
    if not arq.exists():
        return 0
    with open(arq, newline="", encoding="utf-8") as f:
        linhas = list(csv.DictReader(f))
    ja = int(marca.read_text()) if marca.exists() else 0
    novas = linhas[ja:]
    for i in range(0, len(novas), 1000):
        lote = novas[i:i + 1000]
        sb.inserir("trilha", [{k: l[k] for k in ("id_cliente", "data", "tag_anterior", "tag", "motivo",
                                                  "quem_marcou")} for l in lote])
        marca.write_text(str(ja + i + len(lote)))  # avança só depois de cada lote confirmado
    return len(novas)


def publicar_arquivos(sb: Supabase, pasta: Path, prefixo: str) -> int:
    n = 0
    for arq in sorted(p for p in pasta.rglob("*") if p.is_file()):
        rel = arq.relative_to(pasta).as_posix()
        tipo = {"xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                "txt": "text/plain; charset=utf-8"}.get(arq.suffix.lstrip("."), "text/csv; charset=utf-8")
        sb.enviar("saidas", f"{prefixo}/{rel}", arq.read_bytes(), tipo)
        n += 1
    return n


def _relatorio_envio(e, destino, r):
    if e["tipo"] != "retorno":
        with open(destino, encoding="utf-8", errors="replace") as f:
            return "processado", {"linhas": max(sum(1 for _ in f) - 1, 0)}
    nome = destino.name
    if nome in r["sem_layout"] or any(s.startswith(nome + " ") for s in r["sem_layout"]):
        return "erro", {"erro": "arquivo sem layout de fornecedor: crie layouts/<fornecedor>.json no motor"}
    rel = next((x for x in r["relatorios"] if x.arquivo == nome), None)
    if rel is None:
        return "processado", {"observacao": "arquivo recebido"}
    return "processado", {"fornecedor": rel.fornecedor, "linhas": rel.linhas, "aceitas": rel.aceitas,
                          "duplicadas": rel.duplicadas, "rejeitadas": dict(rel.rejeitadas),
                          "quarentena": dict(rel.desconhecidos)}


def sincronizar_dia(dados: Path, data: date, sb: Supabase | None = None, out=print):
    import rodar_dia
    sb = sb or Supabase(*carregar_config(dados))
    execucao = sb.inserir("execucoes", {"data_ref": data.isoformat(), "status": "rodando"}, retornar=True)[0]
    try:
        baixados = baixar_entradas(sb, dados, out)
        for obrig in ("base/clientes.csv", "base/contatos.csv"):
            if not (dados / obrig).exists():
                raise RuntimeError(f"falta {obrig}: envie pelo site (Enviar arquivos)")
        (dados / "retornos").mkdir(parents=True, exist_ok=True)
        parcelas = dados / "base" / "parcelas.csv"
        acoes, portal = dados / "acoes" / "acoes.csv", dados / "logs" / "portal.csv"
        tem_portal = acoes.exists() and portal.exists()
        r = rodar_dia.rodar_dia(dados / "base" / "clientes.csv", dados / "base" / "contatos.csv", dados / "retornos",
                                data, RAIZ / "layouts", parcelas if parcelas.exists() else None,
                                acoes if tem_portal else None, portal if tem_portal else None,
                                dados / "estado", dados / "saida", out=out)

        sb.inserir("estado_cliente", _linhas_estado(r["estados"]), conflito="id_cliente")
        n_trilha = publicar_trilha(sb, dados / "estado")
        sb.apagar("fila_dia", {"data": f"eq.{data.isoformat()}"})
        fila = _linhas_fila(r["fila"], data)
        if fila:
            sb.inserir("fila_dia", fila)
        n_arq = publicar_arquivos(sb, r["saida"], data.isoformat())
        for e, destino in baixados:
            status, rel = _relatorio_envio(e, destino, r)
            sb.atualizar("envios", {"id": f"eq.{e['id']}"}, {"status": status, "relatorio": rel})

        estados = Counter(e.estado for e in r["estados"].values())
        resumo = {"clientes": len(r["estados"]), "estados": dict(estados),
                  "fila": dict(Counter(l["canal"] for l in fila if not l["reserva"])),
                  "reserva": sum(l["reserva"] for l in fila), "enriquecimento": len(r["enriquecimento"]),
                  "dias_processados": r["dias_processados"], "trilha_enviada": n_trilha,
                  "quarentena": len(r["quarentena"]), "sem_layout": r["sem_layout"], "arquivos": n_arq}
        sb.atualizar("execucoes", {"id": f"eq.{execucao['id']}"},
                     {"status": "ok", "terminada_em": agora(), "resumo": resumo, "alertas": r["alertas"]})
        out(f"  nuvem: {len(r['estados'])} clientes · {n_trilha} eventos de trilha · {len(fila)} linhas de fila "
            f"· {n_arq} arquivos publicados")
        return {"execucao": execucao["id"], "resumo": resumo, "rodar": r}
    except Exception as ex:
        sb.atualizar("execucoes", {"id": f"eq.{execucao['id']}"},
                     {"status": "erro", "terminada_em": agora(), "erro": str(ex)[:2000]})
        raise


# ------------------------------------------------------------------ comitê
def sincronizar_comite(dados: Path, mes: str, sb: Supabase | None = None, out=print):
    import relatorio
    import rodar_dia
    from motor.certificacao import certificar_contatos
    from motor.ingestao import (carregar_carteira, carregar_clientes, carregar_layouts, carregar_parcelas,
                                ingerir_pasta)
    from motor.regua import carregar_regua

    sb = sb or Supabase(*carregar_config(dados))
    ano, m = map(int, mes.split("-"))
    inicio, fim = date(ano, m, 1), date(ano, m, calendar.monthrange(ano, m)[1])
    regua = carregar_regua()
    clientes, _ = carregar_clientes(dados / "base" / "clientes.csv")
    contatos, pessoa_de, _ = carregar_carteira(dados / "base" / "contatos.csv")
    eventos = ingerir_pasta(dados / "retornos", carregar_layouts(RAIZ / "layouts"))[0]
    parc = dados / "base" / "parcelas.csv"
    parcelas = carregar_parcelas(parc)[0] if parc.exists() else {}
    estados, _ = rodar_dia.carregar_estado(dados / "estado")
    with open(dados / "estado" / "trilha.csv", newline="", encoding="utf-8") as f:
        trilha = list(csv.DictReader(f))
    certs = certificar_contatos([e for e in eventos if e.data <= fim], fim, contatos, pessoa_de)
    pasta = dados / "saida" / "comite" / mes
    res = relatorio.montar(clientes, estados, trilha, eventos, parcelas, regua, inicio, fim, pasta, certs, out=out)
    n_arq = publicar_arquivos(sb, pasta, f"comite/{mes}")
    sb.inserir("kpis", [{"inicio": inicio.isoformat(), "fim": fim.isoformat(), "safra": k["safra"],
                         "cluster": k["cluster"], "dados": k, "gerado_em": agora()} for k in res["kpis"]],
               conflito="inicio,fim,safra,cluster")
    out(f"  nuvem: {len(res['kpis'])} linhas de KPI e {n_arq} arquivos do comitê publicados")
    return res


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("modo", choices=["dia", "comite"])
    ap.add_argument("--dados", type=Path, default=Path(os.environ.get("MOTORCOB_DADOS", Path.home() / "MotorCob-dados")))
    ap.add_argument("--data", type=date.fromisoformat, default=date.today())
    ap.add_argument("--mes", help="AAAA-MM (modo comite)")
    a = ap.parse_args()
    try:
        if a.modo == "dia":
            sincronizar_dia(a.dados, a.data)
        else:
            if not a.mes:
                ap.error("informe --mes AAAA-MM")
            sincronizar_comite(a.dados, a.mes)
    except SystemExit:
        raise
    except Exception:
        traceback.print_exc()
        sys.exit(1)


if __name__ == "__main__":
    main()
