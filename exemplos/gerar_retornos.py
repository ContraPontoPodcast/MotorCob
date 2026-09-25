"""Gera arquivos de retorno simulados, no formato de cada fornecedor fictício.

Reproduz a bagunça real de propósito: cada fornecedor nomeia a coluna do ID do
cliente e formata telefone, data e custo de um jeito; há códigos que o layout
não conhece, linhas sem ID, reexportação com linhas duplicadas e um fornecedor
sem layout. Os fornecedores recebem e devolvem só o ID do cliente, nunca o CPF.

Uso (na raiz do repositório): python exemplos/gerar_retornos.py
Gera exemplos/carteira_contatos.csv, clientes.csv, parcelas.csv e exemplos/retornos/*.csv
"""
import csv
import random
import sys
from datetime import datetime, time, timedelta
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(RAIZ))

import demo  # noqa: E402  (reaproveita a carteira sintética da demo)
from motor.rastreio import preparar_disparo, salvar_acoes  # noqa: E402

PASTA = RAIZ / "exemplos"
COMPETENCIA = "2026-09"
SEGREDO_EXEMPLO = "segredo-so-para-exemplo"  # em produção: variável MOTORCOB_SEGREDO
BASE_URL = "https://portal.exemplo.com.br/r"


def mascara_tel(t):
    return f"({t[:2]}) {t[2:7]}-{t[7:]}"


def virgula(x):
    return f"{x:.2f}".replace(".", ",")


# Por fornecedor: nome do arquivo, separador, cabeçalho, função que formata a
# linha e o de-para inverso (resultado da taxonomia -> código do fornecedor).
FORNECEDORES = {
    "discador": ("discadora_alfa", ";", ["COD_CLIENTE", "TELEFONE", "DT_LIGACAO", "COD_TABULACAO", "ID_CHAMADA", "CUSTO"],
                 lambda e, cod, dt, i: [e.id_cliente, mascara_tel(e.contato), dt.strftime("%d/%m/%Y %H:%M"),
                                        cod, f"CH{i:07d}", virgula(e.custo)],
                 {"nao_atendida": "01", "numero_inexistente": "02", "caixa_postal": "03", "cpc": "10",
                  "atendida_sem_cpc": "11", "atendida_terceiro_desconhece": "12"}, "99"),
    "agente_voz": ("vozbot", ",", ["customer_id", "phone", "timestamp", "outcome", "call_id", "cost"],
                   lambda e, cod, dt, i: [e.id_cliente, "+55" + e.contato, dt.strftime("%Y-%m-%dT%H:%M:%S"),
                                          cod, f"vb-{i}", f"{e.custo:.2f}"],
                   {"nao_atendida": "NO_ANSWER", "numero_inexistente": "INVALID_NUMBER", "caixa_postal": "VOICEMAIL",
                    "atendida_sem_cpc": "ANSWERED", "atendida_terceiro_desconhece": "WRONG_PERSON", "cpc": "CPC",
                    "identidade_confirmada": "IDENTITY_CONFIRMED"}, "BUSY_NETWORK"),
    "sms": ("sms_rapido", ";", ["id_cliente", "celular", "data_envio", "status", "id_msg", "valor"],
            lambda e, cod, dt, i: [e.id_cliente, e.contato, dt.strftime("%d/%m/%Y"), cod, f"S{i}", virgula(e.custo)],
            {"entregue": "DELIVRD", "nao_entregue": "UNDELIV", "clique_link": "CLICK", "resposta": "MO",
             "opt_out": "STOP", "acesso_portal_autenticado": "PORTAL_LOGIN"}, "EXPIRED"),
    "whatsapp": ("zaphub", ",", ["customer_ref", "wa_number", "event_at", "status", "message_id"],
                 lambda e, cod, dt, i: [e.id_cliente, "55" + e.contato, dt.strftime("%Y-%m-%d %H:%M:%S"), cod, f"wamid.{i:x}"],
                 {"entregue": "delivered", "lido": "read", "resposta": "replied", "sem_conta": "failed_not_on_whatsapp",
                  "bloqueio": "blocked", "desconhece": "wrong_person", "identidade_confirmada": "identity_verified",
                  "acesso_portal_autenticado": "portal_login"}, "pending"),
    "rcs": ("rcs_mais", ";", ["ID_CLIENTE", "MSISDN", "DATA_HORA", "EVENTO", "ID", "TARIFA"],
            lambda e, cod, dt, i: [e.id_cliente, "55" + e.contato, dt.strftime("%d/%m/%Y %H:%M"), cod, f"R{i}", virgula(e.custo)],
            {"entregue": "ENTREGUE", "nao_entregue": "FALHA_ENTREGA", "lido": "LIDO", "interacao": "INTERACAO",
             "identidade_confirmada": "ID_CONFIRMADA", "acesso_portal_autenticado": "LOGIN_PORTAL"}, "REVOGADO"),
    "email": ("mailpro", ",", ["client_id", "email", "date", "event", "event_id"],
              lambda e, cod, dt, i: [e.id_cliente, e.contato.upper() if i % 7 == 0 else e.contato, dt.strftime("%Y-%m-%d"),
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
        # cpf, whatsapp_valido e atualizado_em são opcionais
        w.writerow(["id_cliente", "contato", "tipo", "origem", "cpf", "whatsapp_valido", "atualizado_em"])
        cpf_de = {c["id_cliente"]: c["cpf"] for c in clientes}
        rng2 = random.Random(seed + 1000)  # dados do playbook num gerador à parte: não muda os demais exemplos
        entrada = {c["id_cliente"]: demo.HOJE - timedelta(days=8 if c["novo"] else rng2.randint(62, 75))
                   for c in clientes}
        for c in contatos:
            valor = mascara_tel(c["contato"]) if c["tipo"] == "telefone" and rng.random() < 0.5 else c["contato"]
            cpf = cpf_de[c["id_cliente"]] if rng.random() < 0.7 else ""
            zap = rng2.random() < (0.85 if c["whatsapp"] else 0.10)
            w.writerow([c["id_cliente"], valor, c["tipo"], rng.choice(["cadastro", "enriquecimento", "bureau"]), cpf,
                        "1" if zap else "0", entrada[c["id_cliente"]].isoformat()])

    escrever_clientes_e_parcelas(rng2, clientes, entrada, pasta)

    for canal, (nome, sep, cab, fmt, depara, cod_novo) in FORNECEDORES.items():
        linhas = []
        for i, e in enumerate((e for e in eventos if e.canal == canal), 1):
            dt = datetime.combine(e.data, time(rng.randint(8, 19), rng.randint(0, 59)))
            linha = fmt(e, depara[e.resultado], dt, i)
            if rng.random() < 0.01:           # código que o layout ainda não conhece
                linha[3] = cod_novo
            elif rng.random() < 0.005:        # fornecedor devolveu sem o ID do cliente
                linha[0] = ""
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
    simular_campanha_pulverizada(rng, clientes, contatos, pasta)
    if verbose:
        print(f"Arquivos gerados em {retornos}, carteira em {pasta / 'carteira_contatos.csv'}, "
              f"registro de ações em {pasta / 'acoes.csv'} e log do portal em {pasta / 'portal'}")
    return clientes, contatos


def escrever_clientes_e_parcelas(rng, clientes, entrada, pasta):
    """Base de clientes (com um cliente em 2 contratos e bloqueios) e parcelas de acordos."""
    with open(pasta / "clientes.csv", "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f, delimiter=";")
        w.writerow(["id_cliente", "id_contrato", "data_entrada", "saldo", "dias_atraso", "bloqueio"])
        for i, c in enumerate(clientes):
            faixa = rng.random()
            saldo = rng.uniform(5000, 30000) if faixa < 0.25 else rng.uniform(1000, 4999) if faixa < 0.65 \
                else rng.uniform(100, 999)
            r = rng.random()
            atraso = rng.randint(1, 90) if r < 0.5 else rng.randint(91, 180) if r < 0.75 else rng.randint(181, 720)
            bloqueio = rng.choice(["opt-out geral", "óbito", "judicial", "reclamação"]) if rng.random() < 0.01 else ""
            w.writerow([c["id_cliente"], f"CT{i:06d}", entrada[c["id_cliente"]].isoformat(),
                        virgula(saldo), atraso, bloqueio])
            if i % 50 == 0:  # alguns clientes têm um segundo contrato
                w.writerow([c["id_cliente"], f"CT{i:06d}B", entrada[c["id_cliente"]].isoformat(),
                            virgula(rng.uniform(100, 3000)), atraso + rng.randint(0, 60), ""])
    antigos = [c["id_cliente"] for c in clientes if not c["novo"]]
    with open(pasta / "parcelas.csv", "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f, delimiter=";")
        w.writerow(["id_cliente", "id_acordo", "parcela", "vencimento", "valor", "pago_em"])
        for k, idc in enumerate(rng.sample(antigos, 40)):
            n, inicio, perfil = rng.choice([1, 3, 6]), demo.HOJE - timedelta(days=rng.randint(5, 40)), rng.random()
            for p in range(n):
                venc = inicio + timedelta(days=7 + 30 * p)
                pago = ""
                if venc < demo.HOJE and perfil < 0.8:
                    pago = (venc - timedelta(days=rng.randint(0, 2))).isoformat()
                w.writerow([idc, f"AC{k:04d}", p + 1, venc.isoformat(), virgula(rng.uniform(100, 900)), pago])


def simular_campanha_pulverizada(rng, clientes, contatos, pasta):
    """Como o mercado faz hoje com cliente novo: SMS, WhatsApp, RCS e e-mail para
    TODOS os contatos, ao mesmo tempo. A diferença é que cada ação sai com link único.

    O log do portal é gerado a partir da verdade simulada: só o titular consegue
    se autenticar; terceiros às vezes clicam, mas não passam do login.
    """
    novos = {c["id_cliente"]: c for c in clientes if c["novo"]}
    plano = [{"ordem": 1, "id_cliente": c["id_cliente"], "contato": c["contato"], "tipo": c["tipo"], "canal": canal}
             for c in contatos if c["id_cliente"] in novos
             for canal in (("sms", "whatsapp", "rcs") if c["tipo"] == "telefone" else ("email",))]
    envio = demo.HOJE - timedelta(days=7)
    acoes = preparar_disparo(plano, "CAMP-NOVOS-2026-09", "MSG-V1", BASE_URL, SEGREDO_EXEMPLO, envio, ordem=None)
    (pasta / "acoes.csv").unlink(missing_ok=True)
    salvar_acoes(pasta / "acoes.csv", acoes)

    verdade = {(c["id_cliente"], c["contato"]): c for c in contatos}
    log = []
    for a in acoes:
        c, pref = verdade[(a.id_cliente, a.contato)], novos[a.id_cliente]["pref"][a.canal]
        if not c["existe"] or (a.canal == "whatsapp" and not c["whatsapp"]):
            continue
        quando = datetime.combine(envio, time(9)) + timedelta(hours=rng.randint(0, 120), minutes=rng.randint(0, 59))
        if c["titular"] and rng.random() < min(0.9, pref * 1.5):
            log.append([a.token, "clique", quando.isoformat(), ""])
            if rng.random() < 0.5:
                quando += timedelta(minutes=rng.randint(1, 10))
                log.append([a.token, "login", quando.isoformat(), ""])
                if rng.random() < 0.35:
                    quando += timedelta(minutes=rng.randint(2, 20))
                    log.append([a.token, "acordo", quando.isoformat(), f"{rng.uniform(200, 3000):.2f}"])
            if rng.random() < 0.2:  # voltou pelo mesmo link depois
                log.append([a.token, "clique", (quando + timedelta(days=1)).isoformat(), ""])
        elif not c["titular"] and rng.random() < 0.03:
            log.append([a.token, "clique", quando.isoformat(), ""])
    log.append(["tokenadulterado0", "login", datetime.combine(demo.HOJE, time(10)).isoformat(), ""])
    log.sort(key=lambda l: l[2])
    (pasta / "portal").mkdir(exist_ok=True)
    with open(pasta / "portal" / f"acessos_{COMPETENCIA}.csv", "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f, delimiter=";")
        w.writerow(["token", "evento", "ocorrido_em", "valor_acordo"])
        w.writerows(log)


if __name__ == "__main__":
    main()
