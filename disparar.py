"""Prepara um disparo a partir do plano: mailing por canal com link rastreável.

Uso:
    export MOTORCOB_SEGREDO='...'     # segredo do HMAC dos tokens (nunca versionar)
    python disparar.py --plano saida/plano_acionamento.csv --campanha CAMP-2026-10-A \\
        --mensagem SMS-V3 --base-url https://portal.exemplo.com.br/r

Gera saida/mailing_<canal>.csv (o que sobe no fornecedor) e acrescenta as ações
ao registro (--registro, padrão acoes/acoes.csv), que o rodar.py usa para
atribuir os acessos do portal.
"""
import argparse
import csv
import os
from collections import defaultdict
from datetime import date
from pathlib import Path

from motor.rastreio import preparar_disparo, salvar_acoes


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--plano", required=True)
    ap.add_argument("--campanha", required=True)
    ap.add_argument("--mensagem", required=True, help="versão do roteiro/template (para medir comunicação)")
    ap.add_argument("--base-url", required=True, help="endereço do redirecionador do portal")
    ap.add_argument("--ordem", default="1", help="'1' = só a 1ª ação de cada cliente; 'todas' = plano inteiro")
    ap.add_argument("--canais", help="lista separada por vírgula; padrão: todos do plano")
    ap.add_argument("--registro", default="acoes/acoes.csv")
    ap.add_argument("--saida", default="saida")
    a = ap.parse_args()

    segredo = os.environ.get("MOTORCOB_SEGREDO")
    if not segredo:
        raise SystemExit("defina MOTORCOB_SEGREDO (segredo dos tokens) antes de disparar")
    with open(a.plano, newline="", encoding="utf-8") as f:
        plano = list(csv.DictReader(f))
    acoes = preparar_disparo(plano, a.campanha, a.mensagem, a.base_url, segredo, date.today(),
                             ordem=None if a.ordem == "todas" else int(a.ordem),
                             canais=tuple(a.canais.split(",")) if a.canais else None)
    salvar_acoes(a.registro, acoes)

    por_canal = defaultdict(list)
    for x in acoes:
        por_canal[x.canal].append({"id_cliente": x.id_cliente, "contato": x.contato,
                                   "link": x.link, "token": x.token})
    saida = Path(a.saida)
    saida.mkdir(parents=True, exist_ok=True)
    for canal, linhas in por_canal.items():
        with open(saida / f"mailing_{canal}.csv", "w", newline="", encoding="utf-8") as f:
            w = csv.DictWriter(f, fieldnames=list(linhas[0].keys()), delimiter=";")
            w.writeheader()
            w.writerows(linhas)
        print(f"  {canal:<11} {len(linhas):>5} ações → {saida / f'mailing_{canal}.csv'}")
    print(f"Registro de ações: {a.registro}")


if __name__ == "__main__":
    main()
