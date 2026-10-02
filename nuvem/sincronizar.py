"""Sincroniza a rotina do motor com o Supabase (site motorcob.online).

    python -m nuvem.sincronizar dia    [--data AAAA-MM-DD] [--empresa slug] [--dados ~/MotorCob-dados]
    python -m nuvem.sincronizar comite --mes AAAA-MM   [--empresa slug] [--dados ~/MotorCob-dados]

Roda para cada empresa ativa em public.empresas (ou só a de --empresa). Cada empresa tem
a própria pasta de dados, <dados>/empresas/<slug>/, e o próprio arquivo de entrada no
repositório, empresas/<slug>.json (como ler a base bruta e a ocorrência dela). Uma
empresa com erro não impede as outras.

dia, para cada empresa:
  1. baixa os arquivos que o site recebeu (envios pendentes da empresa): base bruta vai
     para bruto/ e vira base/clientes.csv e base/contatos.csv; ocorrências vão para
     ocorrencias/; retornos de fornecedor para retornos/ com o nome original (é pelo
     nome que o motor acha o layout); clientes/contatos/parcelas já no formato do motor
     substituem base/; portal vira logs/portal.csv;
  2. roda a rotina diária (rodar_dia.py);
  3. publica: estado_cliente (upsert), trilha (só o que ainda não subiu), fila_dia do dia
     (só IDs), arquivos de saida/<data>/ em saidas/<slug>/<data>/, envios processados com
     o relatório de ingestão, e a execução com resumo e alertas.
  Se algo falhar, a execução da empresa fica com status 'erro' e os envios dela
  continuam pendentes.

comite: roda o relatório do mês de cada empresa, sobe em saidas/<slug>/comite/<mês>/ e
grava kpis.

Configuração (nunca no git): variáveis MOTORCOB_SUPABASE_URL e MOTORCOB_SUPABASE_KEY
(chave service_role) ou o arquivo <dados>/config/supabase.env criado por
scripts/configurar_nuvem.sh.
"""
import argparse
import calendar
import csv
import json
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
PASTA_DO_TIPO = {"retorno": "retornos", "base": "bruto", "ocorrencia": "ocorrencias",
                 "enriquecimento": "enriquecimento"}
MARCADOR_TRILHA = "nuvem_trilha_enviada.txt"
PASTA_EMPRESAS = RAIZ / "empresas"


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


def empresas_ativas(sb: Supabase, slug: str | None = None) -> list[dict]:
    filtros = {"ativa": "eq.true"}
    if slug:
        filtros["slug"] = f"eq.{slug}"
    lista = sb.selecionar("empresas", filtros, ordem="slug.asc") or []
    if slug and not lista:
        raise SystemExit(f"empresa '{slug}' não existe ou não está ativa no site")
    return lista


def pasta_empresa(dados: Path, emp: dict) -> Path:
    if not re.fullmatch(r"[a-z0-9][a-z0-9-]{1,39}", emp["slug"]):
        raise ValueError(f"slug inválido: {emp['slug']!r}")
    return dados / "empresas" / emp["slug"]


def arquivo_entrada(emp: dict, pasta_empresas: Path = PASTA_EMPRESAS) -> Path | None:
    arq = pasta_empresas / f"{emp['slug']}.json"
    return arq if arq.exists() else None


# ------------------------------------------------------------------ dia
def baixar_entradas(sb: Supabase, dados: Path, empresa_id, out=print):
    pendentes = sb.selecionar("envios", {"status": "eq.pendente", "empresa_id": f"eq.{empresa_id}"},
                              ordem="enviado_em.asc,id.asc") or []
    baixados = []
    for e in pendentes:
        try:
            conteudo = sb.baixar("entradas", e["caminho"])
        except Exception as ex:  # noqa: BLE001 — um arquivo ruim não derruba os outros
            sb.atualizar("envios", {"id": f"eq.{e['id']}"},
                         {"status": "erro", "relatorio": {"erro": f"não foi possível baixar: {ex}"}})
            out(f"  envio {e['id']} ({e['nome_original']}): erro ao baixar")
            continue
        if e["tipo"] in PASTA_DO_TIPO:
            destino = dados / PASTA_DO_TIPO[e["tipo"]] / nome_seguro(e["nome_original"])
        else:
            destino = dados / DESTINO_BASE[e["tipo"]]
        destino.parent.mkdir(parents=True, exist_ok=True)
        destino.write_bytes(conteudo)
        baixados.append((e, destino))
    out(f"  entradas: {len(baixados)} arquivo(s) baixado(s) do site")
    return baixados
def _linhas_estado(estados, empresa_id, clientes=None, dia=None):
    ts = agora()
    clientes = clientes or {}

    def extra(k):
        c = clientes.get(k)
        if c is None:
            return {}
        return {"saldo": round(c.saldo, 2), "dias_atraso": c.atraso_em(dia) if dia else c.dias_atraso}

    return [{"empresa_id": empresa_id, "id_cliente": k, "tag": e.tag, "safra": e.safra.isoformat(),
             "cluster_origem": e.cluster_origem, "cluster_atual": e.cluster_atual, "estado": e.estado,
             "canal": e.canal, "ciclo": e.ciclo, "reenriquecer": e.reenriquecer, "atualizado_em": ts, **extra(k)}
            for k, e in estados.items()]


def _linhas_fila(fila, data, empresa_id):
    vistos, saida = set(), []
    for l in fila:
        chave = (l["canal"], l["id_cliente"], bool(l["condicao"]))
        if chave in vistos:
            continue
        vistos.add(chave)
        saida.append({"empresa_id": empresa_id, "data": data.isoformat(), "canal": l["canal"],
                      "id_cliente": l["id_cliente"], "reserva": bool(l["condicao"]), "regua": l["regua"],
                      "passo": l["passo"], "tag": l["tag"]})
    return saida


def publicar_trilha(sb: Supabase, pasta_estado: Path, empresa_id) -> int:
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
        sb.inserir("trilha", [{"empresa_id": empresa_id, **{k: l[k] for k in (
            "id_cliente", "data", "tag_anterior", "tag", "motivo", "quem_marcou")}} for l in lote])
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


def _relatorio_envio(e, destino, r, rel_base=None, rel_enriq=None):
    nome = destino.name
    if e["tipo"] == "enriquecimento":
        if rel_enriq is None:
            return "erro", {"erro": "retorno de enriquecimento sem base da empresa ou sem layout em empresas/<slug>.json"}
        if nome in rel_enriq["sem_layout"]:
            return "erro", {"erro": "arquivo não reconhecido como retorno de enriquecimento: confira o nome"}
        arq = next((a for a in rel_enriq["arquivos"] if a["arquivo"] == nome), None)
        return ("processado", arq) if arq else ("processado", {"observacao": "arquivo recebido"})
    if e["tipo"] == "base":
        arq = next((a for a in (rel_base or {}).get("arquivos", []) if a["arquivo"] == nome), None)
        if arq is None:
            return "erro", {"erro": "arquivo não reconhecido como base bruta: confira o nome do arquivo"}
        return "processado", {**arq, "clientes_na_base": rel_base["clientes"], "contatos": rel_base["contatos"],
                              "rejeitadas": rel_base["rejeitadas"], "na_carga": rel_base["na_carga"],
                              "fora_da_carga": rel_base["fora_da_carga"]}
    if e["tipo"] == "ocorrencia":
        if nome in r["sem_layout"] or any(s.startswith(nome + " ") for s in r["sem_layout"]):
            return "erro", {"erro": "arquivo não reconhecido como ocorrência: confira o nome do arquivo"}
        rel = next((x for x in r["relatorios_ocorrencia"] if x.arquivo == nome), None)
        if rel is None:
            return "processado", {"observacao": "arquivo recebido"}
        return "processado", {"linhas": rel.linhas, "aceitas": rel.aceitas, "duplicadas": rel.duplicadas,
                              "contato_identificado": rel.contato_identificado, "avisos": dict(rel.avisos),
                              "rejeitadas": dict(rel.rejeitadas), "quarentena": dict(rel.desconhecidos)}
    if e["tipo"] != "retorno":
        with open(destino, encoding="utf-8", errors="replace") as f:
            return "processado", {"linhas": max(sum(1 for _ in f) - 1, 0)}
    if nome in r["sem_layout"] or any(s.startswith(nome + " ") for s in r["sem_layout"]):
        return "erro", {"erro": "arquivo sem layout de fornecedor: crie layouts/<fornecedor>.json no motor"}
    rel = next((x for x in r["relatorios"] if x.arquivo == nome), None)
    if rel is None:
        return "processado", {"observacao": "arquivo recebido"}
    return "processado", {"fornecedor": rel.fornecedor, "linhas": rel.linhas, "aceitas": rel.aceitas,
                          "duplicadas": rel.duplicadas, "rejeitadas": dict(rel.rejeitadas),
                          "quarentena": dict(rel.desconhecidos)}


def _baixar(sb: Supabase, pasta: Path, tabela: str, empresa_id, ordem: str) -> list[dict]:
    linhas = sb.selecionar(tabela, {"empresa_id": f"eq.{empresa_id}"}, ordem=ordem) or []
    (pasta / "config").mkdir(parents=True, exist_ok=True)
    (pasta / "config" / f"{tabela}.json").write_text(json.dumps(linhas, ensure_ascii=False, indent=1),
                                                     encoding="utf-8")
    return linhas


def baixar_clusters(sb: Supabase, pasta: Path, empresa_id) -> list[dict]:
    """Regras de cluster ativas da empresa; cópia em config/clusters.json (auditoria da rodada)."""
    regras = sb.selecionar("clusters", {"empresa_id": f"eq.{empresa_id}", "ativo": "eq.true"},
                           ordem="ordem.asc,codigo.asc") or []
    (pasta / "config").mkdir(parents=True, exist_ok=True)
    (pasta / "config" / "clusters.json").write_text(json.dumps(regras, ensure_ascii=False, indent=1),
                                                    encoding="utf-8")
    return regras


def sincronizar_empresa_dia(sb: Supabase, dados: Path, emp: dict, data: date, out=print,
                            pasta_empresas: Path = PASTA_EMPRESAS):
    import rodar_dia
    eid, slug = emp["id"], emp["slug"]
    pasta = pasta_empresa(dados, emp)
    entrada = arquivo_entrada(emp, pasta_empresas)
    out(f"EMPRESA {slug}")
    execucao = sb.inserir("execucoes", {"empresa_id": eid, "data_ref": data.isoformat(), "status": "rodando"},
                          retornar=True)[0]
    try:
        baixados = baixar_entradas(sb, pasta, eid, out)
        rel_base = None
        tem_bruto = (pasta / "bruto").exists() and any(p.is_file() for p in (pasta / "bruto").iterdir())
        tem_ocorrencia = (pasta / "ocorrencias").exists() and any((pasta / "ocorrencias").iterdir())
        tem_enriq = (pasta / "enriquecimento").exists() and any((pasta / "enriquecimento").iterdir())
        if (tem_bruto or tem_ocorrencia or tem_enriq) and entrada is None:
            raise RuntimeError(f"a empresa {slug} ainda não tem arquivo de entrada (empresas/{slug}.json): "
                               "mande o cabeçalho da base e da ocorrência para configurar")
        if tem_bruto:
            rel_base = rodar_dia.preparar_base(entrada, pasta / "bruto", pasta / "base")
            out(f"  base bruta: {rel_base['clientes']} clientes, {rel_base['contatos']} contatos")
            # só nomes e tipos das colunas, para o site montar as regras de cluster
            sb.atualizar("empresas", {"id": f"eq.{eid}"},
                         {"colunas_base": {"colunas": rel_base["colunas"], "atualizado_em": agora()}})
        rel_enriq = None
        if tem_enriq and (pasta / "base" / "contatos.csv").exists():
            rel_enriq = rodar_dia.preparar_enriquecimento(entrada, pasta / "enriquecimento", pasta / "base")
        clusters = baixar_clusters(sb, pasta, eid)
        estrategias = _baixar(sb, pasta, "estrategias", eid, "id.asc")
        canais = _baixar(sb, pasta, "canais_empresa", eid, "canal.asc")
        for obrig in ("base/clientes.csv", "base/contatos.csv"):
            if not (pasta / obrig).exists():
                raise RuntimeError(f"falta a base da empresa {slug}: envie a base pelo site (Enviar arquivos)")
        (pasta / "retornos").mkdir(parents=True, exist_ok=True)
        parcelas = pasta / "base" / "parcelas.csv"
        acoes, portal = pasta / "acoes" / "acoes.csv", pasta / "logs" / "portal.csv"
        tem_portal = acoes.exists() and portal.exists()
        r = rodar_dia.rodar_dia(pasta / "base" / "clientes.csv", pasta / "base" / "contatos.csv", pasta / "retornos",
                                data, RAIZ / "layouts", parcelas if parcelas.exists() else None,
                                acoes if tem_portal else None, portal if tem_portal else None,
                                pasta / "estado", pasta / "saida", out=out,
                                ocorrencias=pasta / "ocorrencias" if entrada else None, entrada=entrada,
                                clusters=clusters, atributos=pasta / "base" / "atributos.csv",
                                estrategias=estrategias, canais=canais)

        sb.inserir("estado_cliente", _linhas_estado(r["estados"], eid, r.get("clientes"), data),
                   conflito="empresa_id,id_cliente")
        n_trilha = publicar_trilha(sb, pasta / "estado", eid)
        sb.apagar("fila_dia", {"empresa_id": f"eq.{eid}", "data": f"eq.{data.isoformat()}"})
        fila = _linhas_fila(r["fila"], data, eid)
        if fila:
            sb.inserir("fila_dia", fila)
        n_arq = publicar_arquivos(sb, r["saida"], f"{slug}/{data.isoformat()}")
        for e, destino in baixados:
            status, rel = _relatorio_envio(e, destino, r, rel_base, rel_enriq)
            sb.atualizar("envios", {"id": f"eq.{e['id']}"}, {"status": status, "relatorio": rel})

        estados = Counter(e.estado for e in r["estados"].values())
        resumo = {"clientes": len(r["estados"]), "estados": dict(estados),
                  "clusters": dict(Counter(e.cluster_atual for e in r["estados"].values())),
                  "fila": dict(Counter(l["canal"] for l in fila if not l["reserva"])),
                  "reserva": sum(l["reserva"] for l in fila), "enriquecimento": len(r["enriquecimento"]),
                  "dias_processados": r["dias_processados"], "trilha_enviada": n_trilha,
                  "ocorrencias": sum(x.aceitas for x in r["relatorios_ocorrencia"]),
                  "na_carga": r.get("na_carga"), "contatos": r.get("contatos_status") or {},
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


def sincronizar_dia(dados: Path, data: date, sb: Supabase | None = None, out=print, empresa: str | None = None,
                    pasta_empresas: Path = PASTA_EMPRESAS):
    """Roda o dia para cada empresa ativa. Retorna {slug: resultado}; erros ficam em resultado['erro']."""
    sb = sb or Supabase(*carregar_config(dados))
    resultados = {}
    for emp in empresas_ativas(sb, empresa):
        try:
            resultados[emp["slug"]] = sincronizar_empresa_dia(sb, dados, emp, data, out, pasta_empresas)
        except Exception as ex:  # noqa: BLE001 — uma empresa com erro não para as outras
            out(f"  ERRO na empresa {emp['slug']}: {ex}")
            resultados[emp["slug"]] = {"erro": str(ex)}
    if not resultados:
        out("Nenhuma empresa ativa no site: cadastre em Empresas.")
    return resultados


# ------------------------------------------------------------------ comitê
def sincronizar_comite(dados: Path, mes: str, sb: Supabase | None = None, out=print, empresa: str | None = None,
                       pasta_empresas: Path = PASTA_EMPRESAS):
    import relatorio
    import rodar_dia
    from motor.certificacao import certificar_contatos
    from motor.entrada import carregar_entrada, ingerir_ocorrencias
    from motor.ingestao import (carregar_carteira, carregar_clientes, carregar_layouts, carregar_parcelas,
                                ingerir_pasta)
    from motor.regua import carregar_regua

    sb = sb or Supabase(*carregar_config(dados))
    ano, m = map(int, mes.split("-"))
    inicio, fim = date(ano, m, 1), date(ano, m, calendar.monthrange(ano, m)[1])
    regua = carregar_regua()
    resultados = {}
    for emp in empresas_ativas(sb, empresa):
        pasta = pasta_empresa(dados, emp)
        if not (pasta / "estado" / "trilha.csv").exists():
            out(f"  {emp['slug']}: sem rotina rodada ainda, sem comitê")
            continue
        clientes, _ = carregar_clientes(pasta / "base" / "clientes.csv")
        contatos, pessoa_de, _ = carregar_carteira(pasta / "base" / "contatos.csv")
        eventos = ingerir_pasta(pasta / "retornos", carregar_layouts(RAIZ / "layouts"))[0]
        entrada = arquivo_entrada(emp, pasta_empresas)
        if entrada:
            eventos += ingerir_ocorrencias(pasta / "ocorrencias", carregar_entrada(entrada), pasta / "estado")[0]
        parc = pasta / "base" / "parcelas.csv"
        parcelas = carregar_parcelas(parc)[0] if parc.exists() else {}
        estados, _ = rodar_dia.carregar_estado(pasta / "estado")
        with open(pasta / "estado" / "trilha.csv", newline="", encoding="utf-8") as f:
            trilha = list(csv.DictReader(f))
        certs = certificar_contatos([e for e in eventos if e.data <= fim], fim, contatos, pessoa_de)
        saida = pasta / "saida" / "comite" / mes
        res = relatorio.montar(clientes, estados, trilha, eventos, parcelas, regua, inicio, fim, saida, certs,
                               out=out)
        n_arq = publicar_arquivos(sb, saida, f"{emp['slug']}/comite/{mes}")
        sb.inserir("kpis", [{"empresa_id": emp["id"], "inicio": inicio.isoformat(), "fim": fim.isoformat(),
                             "safra": k["safra"], "cluster": k["cluster"], "dados": k, "gerado_em": agora()}
                            for k in res["kpis"]],
                   conflito="empresa_id,inicio,fim,safra,cluster")
        out(f"  nuvem {emp['slug']}: {len(res['kpis'])} linhas de KPI e {n_arq} arquivos do comitê publicados")
        resultados[emp["slug"]] = res
    return resultados


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("modo", choices=["dia", "comite"])
    ap.add_argument("--dados", type=Path, default=Path(os.environ.get("MOTORCOB_DADOS", Path.home() / "MotorCob-dados")))
    ap.add_argument("--data", type=date.fromisoformat, default=date.today())
    ap.add_argument("--mes", help="AAAA-MM (modo comite)")
    ap.add_argument("--empresa", help="slug de uma empresa (padrão: todas as ativas)")
    a = ap.parse_args()
    try:
        if a.modo == "dia":
            res = sincronizar_dia(a.dados, a.data, empresa=a.empresa)
            if any("erro" in r for r in res.values()):
                sys.exit(1)
        else:
            if not a.mes:
                ap.error("informe --mes AAAA-MM")
            sincronizar_comite(a.dados, a.mes, empresa=a.empresa)
    except SystemExit:
        raise
    except Exception:
        traceback.print_exc()
        sys.exit(1)


if __name__ == "__main__":
    main()
