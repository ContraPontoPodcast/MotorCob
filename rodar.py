"""Pipeline de produção do MVP: retornos dos fornecedores → plano de acionamento.

Uso:
    python rodar.py --retornos exemplos/retornos --carteira exemplos/carteira_contatos.csv
    python rodar.py ... --hoje 2026-09-25 --saida saida --valor-contato 8
    python rodar.py ... --acoes acoes/acoes.csv --portal logs/portal.csv   # com atribuição

Etapas: ingestão (layouts/) → [acessos do portal atribuídos pelo token] →
certificação → hit rate e afinidade → plano + funil.
Saídas em --saida: certificação, hit rate, plano, bloqueios, quarentena,
relatório de ingestão e, com --portal, conversões e atribuição por canal.
"""
import argparse
import csv
from collections import defaultdict
from datetime import date
from pathlib import Path

from motor.certificacao import afinidade_canal, certificar_contatos, hit_rate_por_canal
from motor.ingestao import carregar_carteira, carregar_layouts, ingerir_pasta
from motor.priorizacao import VALOR_CONTATO_EFETIVO, funil_projetado, planejar
from motor.rastreio import atribuicao_por_canal, carregar_acoes, ler_log_portal

# Usado só para canal sem nenhum custo observado nos retornos.
CUSTO_PADRAO = {"discador": 0.35, "agente_voz": 0.12, "sms": 0.07, "whatsapp": 0.30, "rcs": 0.12, "email": 0.01}


def custo_medio_por_canal(eventos):
    soma, n = defaultdict(float), defaultdict(int)
    for e in eventos:
        soma[e.canal] += e.custo
        n[e.canal] += 1
    return {c: round(soma[c] / n[c], 4) if n[c] else CUSTO_PADRAO[c] for c in CUSTO_PADRAO}


def reais(v: float) -> str:
    return "R$ " + f"{v:,.2f}".replace(",", "_").replace(".", ",").replace("_", ".")


def salvar_csv(pasta: Path, nome: str, linhas: list[dict]):
    if not linhas:
        return
    pasta.mkdir(parents=True, exist_ok=True)
    with open(pasta / nome, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=list(linhas[0].keys()))
        w.writeheader()
        w.writerows(linhas)


def rodar(retornos, carteira, layouts="layouts", hoje=None, saida="saida",
          valor_contato=VALOR_CONTATO_EFETIVO, acoes=None, portal=None, out=print):
    hoje = hoje or date.today()
    saida = Path(saida)

    eventos, relatorios, quarentena, sem_layout = ingerir_pasta(retornos, carregar_layouts(layouts))
    contatos, pessoa_de, rej_carteira = carregar_carteira(carteira)

    out("INGESTÃO")
    for r in relatorios:
        rej = sum(r.rejeitadas.values())
        out(f"  {r.fornecedor:<15} {r.linhas:>5} linhas | {r.aceitas:>5} aceitas | {r.duplicadas:>4} duplicadas "
            f"| {rej:>3} rejeitadas | {sum(r.desconhecidos.values()):>3} em quarentena")
        for motivo, q in r.rejeitadas.items():
            out(f"  {'':<15}   rejeição: {motivo} ({q})")
        for cod, q in r.desconhecidos.items():
            out(f"  {'':<15}   código sem de-para: '{cod}' ({q}) → precisa de mapeamento no layout")
    for arq in sem_layout:
        out(f"  SEM LAYOUT: {arq} → arquivo não processado")
    out(f"  carteira: {len(contatos)} contatos válidos | {len({c['id_cliente'] for c in contatos})} clientes"
        f" | {len(pessoa_de)} clientes com CPF (só para agrupar IDs da mesma pessoa)"
        + (f" | rejeitados: {dict(rej_carteira)}" if rej_carteira else ""))

    eventos_portal, conversoes, atribuicao = [], [], {}
    if portal:
        if not acoes:
            raise ValueError("--portal exige --acoes (registro das ações disparadas)")
        registro = carregar_acoes(acoes)
        eventos_portal, conversoes, rel_portal = ler_log_portal(portal, registro)
        atribuicao = atribuicao_por_canal(registro, eventos_portal, conversoes)
        out(f"  portal: {rel_portal['linhas']} acessos | {rel_portal['clique']} cliques | "
            f"{rel_portal['login']} logins | {rel_portal['acordo']} acordos"
            + (f" | {rel_portal['token desconhecido']} com token desconhecido (descartados)"
               if rel_portal["token desconhecido"] else ""))

    # O portal certifica contatos, mas não é tentativa de contato: fica fora do
    # hit rate e da afinidade (que medem a força de cada canal de disparo).
    certs = certificar_contatos(eventos + eventos_portal, hoje, contatos, pessoa_de)
    hr = hit_rate_por_canal(eventos)
    custos = custo_medio_por_canal(eventos)
    plano, bloqueios = planejar(certs, afinidade_canal(eventos, hr, certs), custos, valor_contato)
    funil = funil_projetado(plano, len({c.id_cliente for c in certs.values()}))

    out("\nHIT RATE DA CARTEIRA")
    for canal, r in sorted(hr.items(), key=lambda kv: -kv[1]["hit_rate"]):
        out(f"  {canal:<11} {r['tentativas']:>5} tentativas | hit rate {r['hit_rate']:>6.1%} "
            f"| certificação {r['taxa_certificacao']:>5.1%}")

    status = defaultdict(int)
    for c in certs.values():
        status[c.status] += 1
    out("\nCERTIFICAÇÃO DOS CONTATOS")
    for s in ("CERTIFICADO", "PROVAVEL", "NAO_CONFIRMADO", "CONTESTADO", "INVALIDO", "DESCONHECIDO"):
        out(f"  {s:<15} {status[s]:>5}")

    out("\nFUNIL PROJETADO (1ª ação por cliente)")
    for k, v in funil.items():
        out(f"  {k}: {v}")

    if atribuicao:
        out("\nATRIBUIÇÃO PELO LINK RASTREÁVEL (ações únicas por canal)")
        for canal, r in sorted(atribuicao.items(), key=lambda kv: -kv[1]["logins"]):
            taxa = r["logins"] / r["acoes"] if r["acoes"] else 0
            out(f"  {canal:<9} {r['acoes']:>5} ações | {r['cliques']:>4} cliques | {r['logins']:>4} logins "
                f"({taxa:.1%}) | {r['acordos']:>3} acordos | {reais(r['valor_acordos'])}")

    salvar_csv(saida, "conversoes.csv", [vars(c) for c in conversoes])
    salvar_csv(saida, "atribuicao_por_canal.csv", [{"canal": k, **v} for k, v in atribuicao.items()])
    salvar_csv(saida, "relatorio_ingestao.csv", [
        {"fornecedor": r.fornecedor, "arquivo": r.arquivo, "linhas": r.linhas, "aceitas": r.aceitas,
         "duplicadas": r.duplicadas, "rejeitadas": sum(r.rejeitadas.values()),
         "quarentena": sum(r.desconhecidos.values()),
         "motivos": "; ".join(f"{m}={q}" for m, q in r.rejeitadas.items())} for r in relatorios])
    salvar_csv(saida, "quarentena.csv", quarentena)
    salvar_csv(saida, "certificacao_contatos.csv", [
        {"id_cliente": c.id_cliente, "contato": c.contato, "tipo": c.tipo, "status": c.status, "score": c.score,
         "tentativas": c.tentativas, "restricoes": ";".join(sorted(c.restricoes))} for c in certs.values()])
    salvar_csv(saida, "hit_rate_carteira.csv", [{"canal": k, **v} for k, v in hr.items()])
    salvar_csv(saida, "plano_acionamento.csv", plano)
    salvar_csv(saida, "bloqueios.csv", [dict(zip(("id_cliente", "contato", "canal", "motivo"), b)) for b in bloqueios])
    out(f"\nArquivos gerados em ./{saida}/")
    return {"eventos": eventos, "relatorios": relatorios, "quarentena": quarentena,
            "sem_layout": sem_layout, "certs": certs, "plano": plano, "funil": funil,
            "eventos_portal": eventos_portal, "conversoes": conversoes, "atribuicao": atribuicao}


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--retornos", required=True, help="pasta com os arquivos de retorno dos fornecedores")
    ap.add_argument("--carteira", required=True, help="CSV (;) com id_cliente;contato;tipo[;origem]")
    ap.add_argument("--layouts", default="layouts", help="pasta com os layouts dos fornecedores")
    ap.add_argument("--hoje", type=date.fromisoformat, help="data de referência (AAAA-MM-DD); padrão: hoje")
    ap.add_argument("--saida", default="saida")
    ap.add_argument("--valor-contato", type=float, default=VALOR_CONTATO_EFETIVO,
                    help="R$ de um contato efetivo (CPC) nesta carteira")
    ap.add_argument("--acoes", help="registro de ações disparadas (gerado pelo disparar.py)")
    ap.add_argument("--portal", help="log do portal: token;evento;ocorrido_em[;valor_acordo]")
    a = ap.parse_args()
    rodar(a.retornos, a.carteira, a.layouts, a.hoje, a.saida, a.valor_contato, a.acoes, a.portal)


if __name__ == "__main__":
    main()
