"""Diagnóstico dos arquivos de acordo, pagamento e ocorrência: por que o MotorCob não reconheceu?

Uso:  scripts/diagnostico_arquivos.sh        (ou: python3 -m nuvem.diagnostico_arquivos)

Para cada carteira mostra: os últimos envios desses tipos e o status no site; como o motor
leu cada arquivo (quais colunas usou); quantas linhas acharam o cliente da carga e por qual
chave; e os códigos de resultado da ocorrência com o que cada um virou (CPC, sem contato…).
Mostra só nomes de coluna, códigos de resultado e contagens — nunca CPF, telefone ou cliente.
"""
import csv
import json
import os
import sys
from collections import Counter
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(RAIZ))

TIPOS = ("acordo", "baixa", "ocorrencia")
PASTA = {"acordo": "acordo", "baixa": "baixa", "ocorrencia": "ocorrencias"}


def _envios(dados: Path):
    from nuvem.sincronizar import carregar_config
    from nuvem.supabase_api import Supabase
    try:
        sb = Supabase(*carregar_config(dados))
        cred = {c["id"]: c["codigo"] for c in (sb.selecionar("credores") or [])}
        linhas = sb.selecionar("envios", {"tipo": f"in.({','.join(TIPOS)})"}, ordem="id.desc", limite=30) or []
    except BaseException as ex:  # noqa: BLE001 — sem nuvem, segue só com o que está no Mac
        print(f"  (não consegui ler os envios do site: {ex})")
        return
    print("ÚLTIMOS ENVIOS (site)")
    for e in linhas:
        rel = e.get("relatorio") or {}
        resumo = rel.get("erro") or ", ".join(f"{k}={v}" for k, v in rel.items()
                                              if k in ("linhas", "aceitas", "identificacao", "quarentena",
                                                       "rejeitadas", "parcelas_pagas", "acordos_abertos") and v)
        print(f"  #{e['id']} {e.get('enviado_em', '')[:16]} {e['tipo']:<10} credor={cred.get(e.get('credor_id'), '-')}"
              f"  {e['status']:<10} {e.get('nome_original', '')}")
        if resumo:
            print(f"      {str(resumo)[:400]}")
    print()


def _layout(pasta: Path, slug: str):
    from motor.entrada import carregar_entrada
    repo = RAIZ / "empresas" / f"{slug}.json"
    efetiva = pasta / "config" / "entrada_efetiva.json"
    auto = pasta / "config" / "entrada_automatica.json"
    for arq, nome in ((efetiva, "mapeamento do site (config/entrada_efetiva.json)"), (repo, f"empresas/{repo.name}"),
                      (auto, "automático (config/entrada_automatica.json)")):
        if arq.exists():
            return carregar_entrada(arq), nome
    return None, "nenhum (ainda não rodou)"


def _arquivos(p: Path):
    if not p.exists():
        return []
    return sorted((x for x in p.iterdir() if x.is_file() and not x.name.startswith(".")), key=lambda x: x.stat().st_mtime)


def carteira(pasta: Path, slug: str, nome: str):
    from motor.carteira import ler
    from motor.entrada import carregar_escolhas, ler_ocorrencia
    from motor.identificar import Identificador
    print(f"=== {nome} ===")
    ent, origem = _layout(pasta, slug)
    print(f"  layout: {origem}")
    ident = Identificador.da_base(pasta / "base")
    print(f"  clientes na base: {len(ident.ids)}")
    if ent is None:
        print()
        return
    for tipo in TIPOS:
        arqs = _arquivos(pasta / PASTA[tipo])
        rej = _arquivos(pasta / PASTA[tipo] / "rejeitados")
        espera = _arquivos(pasta / PASTA[tipo] / "aguardando")
        if espera:
            print(f"  [{tipo}] ⏳ {len(espera)} arquivo(s) aguardando o mapeamento no site "
                  "(Credores → Configurações): " + ", ".join(a.name for a in espera[-3:]))
        lay = (ent.ocorrencias[0] if ent.ocorrencias else None) if tipo == "ocorrencia" else getattr(ent, tipo)
        print(f"  [{tipo}] {len(arqs)} arquivo(s)" + (f", {len(rej)} rejeitado(s)" if rej else ""))
        if lay is None:
            if arqs or rej:
                print("    ❌ sem layout para este tipo: o motor não sabe ler esses arquivos")
            continue
        print(f"    colunas usadas: {json.dumps(lay.colunas, ensure_ascii=False)}")
        for a in arqs[-3:]:
            with open(a, encoding=lay.encoding, errors="replace") as f:
                cab = f.readline().strip()
                brutas = sum(1 for x in f if x.strip())
            print(f"    · {a.name}: {brutas} linhas · cabeçalho: {cab[:200]}")
            try:
                if tipo == "ocorrencia":
                    ev, rel, _ = ler_ocorrencia(a, lay, "diag", carregar_escolhas(pasta / "estado"), set(),
                                                ident if ident else None)
                    gen = Counter()
                    with open(a, encoding=lay.encoding, errors="replace") as f:
                        for linha in csv.DictReader(f, delimiter=lay.delimitador):
                            cod = (linha.get(lay.colunas["resultado"]) or "").strip()
                            gen[(cod, lay.resultados.get(cod, "NÃO ENTENDIDO"))] += 1
                    print(f"      aproveitadas {rel.aceitas} de {rel.linhas}"
                          + (f" · rejeitadas {dict(rel.rejeitadas)}" if rel.rejeitadas else ""))
                    print("      resultados: " + " · ".join(f"'{c}'→{g} ({n})" for (c, g), n in gen.most_common(15)))
                    if not any(g == "cpc" for (_, g) in gen):
                        print("      ⚠️  nenhum código deste arquivo foi entendido como CPC")
                else:
                    rel = Counter()
                    linhas = ler(a, lay, tipo, rel)
                    como = Counter(ident.resolver(r["id_cliente"] or "", r["id_contrato"])[1] for r in linhas)
                    print(f"      lidas {len(linhas)} de {brutas}" + (f" · {dict(rel)}" if rel else "")
                          + f" · cliente achado por: {dict(como)}")
            except Exception as ex:  # noqa: BLE001
                print(f"      ❌ não consegui ler: {ex}")
        for a in rej[-3:]:
            print(f"    · REJEITADO {a.name}")
    print()


def main():
    dados = Path(os.environ.get("MOTORCOB_DADOS", Path.home() / "MotorCob-dados"))
    print("MOTORCOB — DIAGNÓSTICO DE ACORDO, PAGAMENTO E OCORRÊNCIA\n")
    _envios(dados)
    raiz = dados / "empresas"
    if not raiz.exists():
        print(f"nenhuma empresa em {raiz}")
        return
    for emp in sorted(p for p in raiz.iterdir() if p.is_dir()):
        creds = sorted(p for p in (emp / "credores").iterdir() if p.is_dir()) if (emp / "credores").exists() else []
        for c in creds or [emp]:
            carteira(c, emp.name, f"{emp.name}/{c.name}" if creds else emp.name)
    print("Copie tudo acima e mande para o suporte (não tem CPF, telefone nem cliente).")


if __name__ == "__main__":
    main()
