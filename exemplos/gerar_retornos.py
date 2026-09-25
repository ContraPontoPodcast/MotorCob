"""Gera arquivos de retorno simulados, no formato de cada fornecedor fictício.

Reproduz a bagunça real de propósito: cada fornecedor formata CPF, telefone,
data e custo de um jeito; há códigos que o layout não conhece, linhas com CPF
inválido, reexportação com linhas duplicadas e um fornecedor sem layout.

Uso (na raiz do repositório): python exemplos/gerar_retornos.py
Gera exemplos/carteira_contatos.csv e exemplos/retornos/*.csv
"""
import csv
import random
import sys
from datetime import datetime, time
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(RAIZ))

import demo  # noqa: E402  (reaproveita a carteira sintética da demo)

PASTA = RAIZ / "exemplos"
COMPETENCIA = "2026-09"


def mascara_cpf(c):
    return f"{c[:3]}.{c[3:6]}.{c[6:9]}-{c[9:]}"


def mascara_tel(t):
    return f"({t[:2]}) {t[2:7]}-{t[7:]}"


def virgula(x):
    return f"{x:.2f}".replace(".", ",")


# Por fornecedor: nome do arquivo, separador, cabeçalho, função que formata a
# linha e o de-para inverso (resultado da taxonomia -> código do fornecedor).
FORNECEDORES = {
    "discador": ("discadora_alfa", ";", ["CPF_CLIENTE", "TELEFONE", "DT_LIGACAO", "COD_TABULACAO", "ID_CHAMADA", "CUSTO"],
                 lambda e, cod, dt, i: [mascara_cpf(e.cpf), mascara_tel(e.contato), dt.strftime("%d/%m/%Y %H:%M"),
                                        cod, f"CH{i:07d}", virgula(e.custo)],
                 {"nao_atendida": "01", "numero_inexistente": "02", "caixa_postal": "03", "cpc": "10",
                  "atendida_sem_cpc": "11", "atendida_terceiro_desconhece": "12"}, "99"),
    "agente_voz": ("vozbot", ",", ["document", "phone", "timestamp", "outcome", "call_id", "cost"],
                   lambda e, cod, dt, i: [e.cpf, "+55" + e.contato, dt.strftime("%Y-%m-%dT%H:%M:%S"),
                                          cod, f"vb-{i}", f"{e.custo:.2f}"],
                   {"nao_atendida": "NO_ANSWER", "numero_inexistente": "INVALID_NUMBER", "caixa_postal": "VOICEMAIL",
                    "atendida_sem_cpc": "ANSWERED", "atendida_terceiro_desconhece": "WRONG_PERSON", "cpc": "CPC",
                    "identidade_confirmada": "IDENTITY_CONFIRMED"}, "BUSY_NETWORK"),
    "sms": ("sms_rapido", ";", ["cpf", "celular", "data_envio", "status", "id_msg", "valor"],
            lambda e, cod, dt, i: [e.cpf, e.contato, dt.strftime("%d/%m/%Y"), cod, f"S{i}", virgula(e.custo)],
            {"entregue": "DELIVRD", "nao_entregue": "UNDELIV", "clique_link": "CLICK", "resposta": "MO",
             "opt_out": "STOP", "acesso_portal_autenticado": "PORTAL_LOGIN"}, "EXPIRED"),
    "whatsapp": ("zaphub", ",", ["customer_doc", "wa_number", "event_at", "status", "message_id"],
                 lambda e, cod, dt, i: [e.cpf, "55" + e.contato, dt.strftime("%Y-%m-%d %H:%M:%S"), cod, f"wamid.{i:x}"],
                 {"entregue": "delivered", "lido": "read", "resposta": "replied", "sem_conta": "failed_not_on_whatsapp",
                  "bloqueio": "blocked", "desconhece": "wrong_person", "identidade_confirmada": "identity_verified",
                  "acesso_portal_autenticado": "portal_login"}, "pending"),
    "rcs": ("rcs_mais", ";", ["CPF", "MSISDN", "DATA_HORA", "EVENTO", "ID", "TARIFA"],
            lambda e, cod, dt, i: [e.cpf, "55" + e.contato, dt.strftime("%d/%m/%Y %H:%M"), cod, f"R{i}", virgula(e.custo)],
            {"entregue": "ENTREGUE", "nao_entregue": "FALHA_ENTREGA", "lido": "LIDO", "interacao": "INTERACAO",
             "identidade_confirmada": "ID_CONFIRMADA", "acesso_portal_autenticado": "LOGIN_PORTAL"}, "REVOGADO"),
    "email": ("mailpro", ",", ["doc", "email", "date", "event", "event_id"],
              lambda e, cod, dt, i: [e.cpf, e.contato.upper() if i % 7 == 0 else e.contato, dt.strftime("%Y-%m-%d"),
                                     cod, f"m{i}"],
              {"hard_bounce": "bounce_hard", "soft_bounce": "bounce_soft", "entregue": "delivered", "abertura": "open",
               "clique": "click", "descadastro": "unsubscribe", "acesso_portal_autenticado": "portal_login"}, "deferred"),
}


def main(seed=42, pasta=PASTA, verbose=True):
    rng = random.Random(seed)
    clientes, contatos = demo.gerar_carteira(rng)
    eventos = demo.gerar_historico(rng, clientes, contatos)
    retornos = pasta / "retornos"
    retornos.mkdir(parents=True, exist_ok=True)

    with open(pasta / "carteira_contatos.csv", "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f, delimiter=";")
        w.writerow(["cpf", "contato", "tipo", "origem"])
        for c in contatos:
            valor = mascara_tel(c["contato"]) if c["tipo"] == "telefone" and rng.random() < 0.5 else c["contato"]
            w.writerow([mascara_cpf(c["cpf"]), valor, c["tipo"], rng.choice(["cadastro", "enriquecimento", "bureau"])])

    for canal, (nome, sep, cab, fmt, depara, cod_novo) in FORNECEDORES.items():
        linhas = []
        for i, e in enumerate((e for e in eventos if e.canal == canal), 1):
            dt = datetime.combine(e.data, time(rng.randint(8, 19), rng.randint(0, 59)))
            linha = fmt(e, depara[e.resultado], dt, i)
            if rng.random() < 0.01:           # código que o layout ainda não conhece
                linha[3] = cod_novo
            elif rng.random() < 0.005:        # CPF digitado errado na origem
                linha[0] = linha[0][:-1] + str((int(linha[0][-1]) + 1) % 10)
            linhas.append(linha)
        linhas += rng.sample(linhas, len(linhas) // 20)  # reexportação: ~5% duplicadas
        rng.shuffle(linhas)
        with open(retornos / f"{nome}_{COMPETENCIA}.csv", "w", newline="", encoding="utf-8") as f:
            w = csv.writer(f, delimiter=sep)
            w.writerow(cab)
            w.writerows(linhas)

    # Fornecedor recém-contratado, ainda sem layout: o motor não deve adivinhar.
    with open(retornos / f"voz_nova_{COMPETENCIA}.csv", "w", newline="", encoding="utf-8") as f:
        f.write("cliente|fone|quando|tab\n")
    if verbose:
        print(f"Arquivos gerados em {retornos} e carteira em {pasta / 'carteira_contatos.csv'}")


if __name__ == "__main__":
    main()
