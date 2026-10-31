"""Casos do validador do fluxo de voz, usados nos DOIS lados (paridade Python × banco).

tests/test_voz_fluxo_validador.py roda cada caso em voz/fluxo_validador.erros(); supabase/testes/testar_rls.py roda
os mesmos casos em public.fluxo_voz_erros(jsonb) e confere que a lista de erros é a mesma. Um caso por recusa do
protótipo (FL2), mais os de forma do esquema. Só dados fictícios.

negociador() é o fluxo do protótipo (Negociador · carteira de exemplo), com os conectores 1 a 4:
1 = Buscar ofertas, 2 = Validar cadastro, 3 = Registrar acordo, 4 = Gerar boleto ou link.
"""
from __future__ import annotations

import copy

C_OFERTAS, C_VALIDAR, C_ACORDO, C_BOLETO = 1, 2, 3, 4


def _s(rotulo, para, quando, tipo="normal"):
    return {"rotulo": rotulo, "para": para, "tipo": tipo, "quando": quando}


def negociador(ofertas=C_OFERTAS, validar=C_VALIDAR, acordo=C_ACORDO, boleto=C_BOLETO) -> dict:
    b = [
        {"id": "N1", "tipo": "abertura", "modo": "arvore", "x": 480, "y": 20,
         "params": {"fala": "Olá, aqui é a central da {{assessoria}}. Falo com {{primeiro_nome}}?"},
         "saidas": [_s("Sou eu", "N2", "titular"), _s("Não é a pessoa", "N14", "terceiro")]},
        {"id": "N2", "tipo": "identidade", "modo": "cognicao", "x": 480, "y": 180,
         "params": {"fala": "Para sua segurança, me confirma o dia e o mês do seu nascimento?",
                    "pergunta": "dia_mes_nascimento", "conector_id": validar, "tentativas": 2},
         "saidas": [_s("Confirmou", "N3", "confirmou"), _s("Não confirmou", "N14", "nao_confirmou"),
                    _s("Conector falhou", "N13", "falhou", "falha")]},
        {"id": "N3", "tipo": "intencao", "modo": "cognicao", "x": 480, "y": 360,
         "params": {"fala": "Obrigada. Consta {{saldo}} em aberto com {{credor}}. Como fica melhor para você resolver?",
                    "intencoes": ["quero_negociar", "ja_paguei", "nao_reconheco", "sem_dinheiro"],
                    "exemplos": {"quero_negociar": ["quero parcelar", "tem desconto?"], "ja_paguei": ["já paguei"]},
                    "confianca_min": 0.7, "tentativas": 2, "entidades": ["data", "parcelas"]},
         "saidas": [_s("Quer negociar", "N4", "quero_negociar"), _s("Já paguei", "N8", "ja_paguei"),
                    _s("Não reconheço", "N10", "nao_reconheco"), _s("Sem dinheiro agora", "N9", "sem_dinheiro"),
                    _s("Não entendi 2×", "N13", "nao_entendido")]},
        {"id": "N4", "tipo": "conector", "modo": "sistema", "x": 20, "y": 600,
         "params": {"conector_id": ofertas, "fala_espera": "Um instante, vou ver as condições para você."},
         "saidas": [_s("Respondeu", "N15", "respondeu"), _s("Falhou", "N6", "falhou", "falha")]},
        {"id": "N15", "tipo": "condicao", "modo": "sistema", "x": 20, "y": 780,
         "params": {"campo": "ofertas_quantidade", "op": ">=", "valor": 1},
         "saidas": [_s("Sim", "N5", "sim"), _s("Nenhuma oferta", "N13", "nao")]},
        {"id": "N6", "tipo": "oferta", "modo": "cognicao", "x": 250, "y": 780, "titulo": "Oferta da carteira",
         "params": {"origem": "carteira",
                    "fala": "Consigo para você {{oferta.parcelas}} parcelas de {{oferta.valor_parcela}}, "
                            "com vencimento em {{oferta.vencimento}}. Fica bom?"},
         "saidas": [_s("Aceitou", "N7", "aceitou"), _s("Quer outra condição", "N5", "quer_outra"),
                    _s("Recusou", "N9", "recusou")]},
        {"id": "N5", "tipo": "generativa", "modo": "generativo", "x": 20, "y": 980, "titulo": "Negociar dentro das ofertas",
         "params": {"objetivo": "Fechar um acordo usando uma das ofertas recebidas. Comece pela que tem menor parcela. "
                                "Se a pessoa pedir algo fora das ofertas, explique o limite uma vez; se insistir, "
                                "devolva por fora_alcada.",
                    "tom": ["cordial", "frases_curtas", "sem_giria", "nao_pressiona"], "max_turnos": 8,
                    "ferramentas": ["apresentar_oferta", "registrar_promessa", "agendar_retorno", "consultar_base",
                                    "transferir_humano", "encerrar_chamada"],
                    "contrapropostas_max": 2},
         "saidas": [_s("Fechou acordo", "N7", "fechou_acordo", "devolve"), _s("Contestou", "N10", "contestou", "devolve"),
                    _s("Sem acordo", "N9", "sem_acordo", "devolve"), _s("Fora da alçada", "N13", "fora_alcada", "devolve")]},
        {"id": "N7", "tipo": "registrar", "modo": "sistema", "x": 20, "y": 1200,
         "params": {"registra": "acordo_crm", "conectores": [acordo, boleto]},
         "saidas": [_s("Registrado", "N11", "registrado"), _s("CRM falhou", "N13", "falhou", "falha")]},
        {"id": "N11", "tipo": "link", "modo": "arvore", "x": 250, "y": 1200,
         "params": {"canal": "whatsapp_sms", "fala": "Acabei de mandar o link do pagamento no seu WhatsApp."},
         "saidas": [_s("Enviado", "N12", "enviado"), _s("Não enviou", "N12", "falhou", "falha")]},
        {"id": "N12", "tipo": "encerrar", "modo": "arvore", "x": 480, "y": 1200, "titulo": "Encerrar · acordo",
         "params": {"fala": "Obrigada pela atenção. Até logo.", "resultado": "promessa", "codigo": "acordo_registrado"},
         "saidas": []},
        {"id": "N8", "tipo": "pergunta", "modo": "arvore", "x": 480, "y": 600, "titulo": "Pergunta · já paguei",
         "params": {"fala": "Em que data você pagou?", "tentativas": 1,
                    "opcoes": [{"codigo": "informou_data", "rotulo": "Informou a data"},
                               {"codigo": "nao_lembra", "rotulo": "Não lembra", "exemplos": ["não lembro", "não sei"]}]},
         "saidas": [_s("Informou a data", "N16", "informou_data"), _s("Não lembra", "N13", "nao_lembra"),
                    _s("Sem resposta", "N13", "sem_resposta")]},
        {"id": "N16", "tipo": "encerrar", "modo": "arvore", "x": 480, "y": 780, "titulo": "Encerrar · alega pagamento",
         "params": {"fala": "Obrigada. Vou registrar e a equipe confere o pagamento.", "resultado": "recusa",
                    "codigo": "alega_pagamento"},
         "saidas": []},
        {"id": "N10", "tipo": "transferir", "modo": "arvore", "x": 710, "y": 600, "titulo": "Transferir · contestação",
         "params": {"fala": "Vou passar você para um atendente agora, só um instante.", "motivo": "contestacao"},
         "saidas": []},
        {"id": "N9", "tipo": "retorno", "modo": "cognicao", "x": 940, "y": 600,
         "params": {"fala": "Quando fica melhor eu ligar de novo?", "dias_max": 7},
         "saidas": [_s("Agendou", "N17", "agendou"), _s("Não agendou", "N13", "nao_agendou")]},
        {"id": "N17", "tipo": "encerrar", "modo": "arvore", "x": 940, "y": 780, "titulo": "Encerrar · retorno",
         "params": {"fala": "Combinado, eu ligo nesse horário. Até lá!", "resultado": "retorno_agendado"},
         "saidas": []},
        {"id": "N13", "tipo": "transferir", "modo": "arvore", "x": 1170, "y": 600, "titulo": "Transferir · atendente",
         "params": {"fala": "Vou passar você para um atendente agora, só um instante.", "motivo": "pedido_humano"},
         "saidas": []},
        {"id": "N14", "tipo": "encerrar", "modo": "arvore", "x": 940, "y": 180, "titulo": "Encerrar · recado neutro",
         "params": {"fala": "Peço que {{primeiro_nome}} retorne para a {{assessoria}}. Obrigada.", "resultado": "recado"},
         "saidas": []},
    ]
    return {"esquema": 1, "blocos": b}


def _bloco(d, bid):
    return next(b for b in d["blocos"] if b["id"] == bid)


def _mud(f):
    d = negociador()
    f(d)
    return d


def _saida(d, bid, quando):
    return next(s for s in _bloco(d, bid)["saidas"] if s["quando"] == quando)


def _muitos():
    d = negociador()
    for i in range(18, 18 + 44):     # 17 + 44 = 61 blocos
        d["blocos"].append({"id": f"N{i}", "tipo": "encerrar", "modo": "arvore",
                            "params": {"fala": "Até logo.", "resultado": "cpc"}, "saidas": []})
    return d


def _sem_n1(d):
    d["blocos"] = [b for b in d["blocos"] if b["id"] != "N1"]


def _set(bid, chave, valor, em="params"):
    def f(d):
        alvo = _bloco(d, bid)[em] if em else _bloco(d, bid)
        alvo[chave] = valor
    return f


def _del(bid, chave):
    def f(d):
        _bloco(d, bid)["params"].pop(chave)
    return f


def _para(bid, quando, para):
    def f(d):
        _saida(d, bid, quando)["para"] = para
    return f


def _varios(*fs):
    def f(d):
        for g in fs:
            g(d)
    return f


# (nome, definição, erros esperados). A definição é JSON puro (vai igual para o banco).
CASOS: list[tuple[str, object, list[str]]] = [
    ("fluxo do protótipo é válido", negociador(), []),
    ("Abertura ausente", _mud(_sem_n1), ["abertura_ausente"]),
    ("Abertura repetida", _mud(lambda d: d["blocos"].append(
        {"id": "N20", "tipo": "abertura", "modo": "arvore", "params": {"fala": "Olá!"},
         "saidas": [_s("Sou eu", "N2", "titular"), _s("Não", "N14", "terceiro")]})), ["abertura_repetida"]),
    ("bloco não final sem saída", _mud(_set("N9", "saidas", [], em=None)), ["inalcancavel:N17", "sem_saida:N9"]),
    ("saída para bloco inexistente", _mud(_para("N15", "nao", "N99")), ["saida_inexistente:N15"]),
    ("bloco inalcançável", _mud(lambda d: d["blocos"].append(
        {"id": "N18", "tipo": "encerrar", "modo": "arvore", "params": {"fala": "Até logo.", "resultado": "cpc"},
         "saidas": []})), ["inalcancavel:N18"]),
    ("ciclo sem limite de repetição", _mud(_para("N9", "nao_agendou", "N3")), ["ciclo_sem_limite:N3"]),
    ("ciclo com limite de repetição", _mud(_varios(_para("N9", "nao_agendou", "N3"), _set("N9", "repetir_max", 2, em=None))), []),
    ("laço no próprio bloco sem limite", _mud(_para("N9", "nao_agendou", "N9")), ["ciclo_sem_limite:N9"]),
    ("mais de 60 blocos", _muitos(), ["blocos_demais"]),
    ("fala acima de 500 caracteres", _mud(_set("N13", "fala", "a" * 501)), ["fala_longa:N13"]),
    ("fala de 500 caracteres passa", _mud(_set("N13", "fala", "a" * 500)), []),
    ("variável fora de variaveis_voz()", _mud(_set("N1", "fala", "Olá, falo com {{cpf}}?")), ["variavel_invalida:N1"]),
    ("variável de oferta inexistente", _mud(_set("N6", "fala", "Fica {{oferta.juros}}?")), ["variavel_invalida:N6"]),
    ("valor antes de Confirmar identidade", _mud(_set("N1", "fala", "Consta {{saldo}}. Falo com {{primeiro_nome}}?")),
     ["valor_antes_identidade:N1"]),
    ("credor da dívida antes de Confirmar identidade",
     _mud(_set("N1", "fala", "Olá, em nome de {{ credor }}. Falo com {{primeiro_nome}}?")), ["valor_antes_identidade:N1"]),
    ("oferta antes de Confirmar identidade em algum caminho", _mud(_para("N2", "nao_confirmou", "N6")),
     ["valor_antes_identidade:N11", "valor_antes_identidade:N5", "valor_antes_identidade:N6", "valor_antes_identidade:N7"]),
    ("Confirmar identidade em modo generativo", _mud(_set("N2", "modo", "generativo", em=None)), ["identidade_generativa:N2"]),
    ("Confirmar identidade em árvore passa", _mud(_set("N2", "modo", "arvore", em=None)), []),
    ("Generativo sem objetivo", _mud(_set("N5", "objetivo", "")), ["generativo_sem_objetivo:N5"]),
    ("Generativo sem limite de turnos", _mud(_del("N5", "max_turnos")), ["generativo_sem_limite:N5"]),
    ("Generativo acima do limite global de turnos", _mud(_set("N5", "max_turnos", 41)), ["generativo_sem_limite:N5"]),
    ("ferramenta fora da lista fechada", _mud(_set("N5", "ferramentas", ["transferir_humano", "consultar_cpf"])),
     ["ferramenta_invalida:N5"]),
    ("transferir_humano desligado", _mud(_set("N5", "ferramentas", ["apresentar_oferta", "encerrar_chamada"])),
     ["transferir_humano_desligado:N5"]),
    ("terceiro sem recado neutro", _mud(_para("N1", "terceiro", "N13")), ["terceiro_sem_recado"]),
    ("modo incompatível com o tipo", _mud(_set("N4", "modo", "arvore", em=None)), ["modo_incompativel:N4"]),
    ("saída obrigatória faltando", _mud(lambda d: _bloco(d, "N4")["saidas"].pop()), ["inalcancavel:N6", "saida_faltando:N4"]),
    ("intenção sem ramo", _mud(lambda d: _bloco(d, "N3")["params"]["intencoes"].append("nao_me_ligue")),
     ["saida_faltando:N3"]),
    ("identidade com conector sem ramo de falha", _mud(lambda d: _bloco(d, "N2")["saidas"].pop()), ["saida_faltando:N2"]),
    ("devolve fora do generativo", _mud(lambda d: _saida(d, "N15", "sim").update(tipo="devolve")),
     ["saida_faltando:N15", "saida_invalida:N15"]),
    ("generativo com saída normal", _mud(lambda d: _saida(d, "N5", "contestou").update(tipo="normal")),
     ["saida_invalida:N5"]),
    ("falha sem quando=falhou", _mud(lambda d: _saida(d, "N15", "nao").update(tipo="falha")),
     ["saida_faltando:N15", "saida_invalida:N15"]),
    ("saída com quando fora do tipo", _mud(lambda d: _saida(d, "N15", "nao").update(quando="talvez")),
     ["saida_faltando:N15", "saida_invalida:N15"]),
    ("final com saída", _mud(_set("N12", "saidas", [_s("x", "N13", "sim")], em=None)), ["final_com_saida:N12"]),
    ("fala que pede senha", _mud(_set("N13", "fala", "Me diga a sua SENHA, por favor.")), ["fala_pede_senha:N13"]),
    ("fala que pede número do cartão", _mud(_set("N11", "fala", "Qual o número do cartão?")), ["fala_pede_senha:N11"]),
    ("objetivo pode dizer para nunca pedir senha", _mud(_set("N5", "objetivo", "Feche o acordo. Nunca peça senha nem cartão.")), []),
    ("esquema 2", _mud(lambda d: d.update(esquema=2)), ["esquema_invalido"]),
    ("chave a mais no topo", _mud(lambda d: d.update(cpf="00000000000")), ["esquema_invalido"]),
    ("blocos não é lista", {"esquema": 1, "blocos": {}}, ["esquema_invalido"]),
    ("id fora do padrão", _mud(_set("N13", "id", "X13", em=None)), ["id_invalido"]),
    ("id repetido", _mud(_set("N16", "id", "N13", em=None)), ["id_repetido:N13"]),
    ("tipo desconhecido", _mud(_set("N13", "tipo", "pix", em=None)), ["tipo_invalido:N13"]),
    ("chave a mais no bloco", _mud(_set("N1", "cpf", "1", em=None)), ["bloco_invalido:N1"]),
    ("repetir_max fora da faixa", _mud(_set("N9", "repetir_max", 9, em=None)), ["bloco_invalido:N9"]),
    ("chave a mais nos params", _mud(_set("N1", "telefone", "x")), ["params_invalidos:N1"]),
    ("condição booleana com <", _mud(lambda d: _bloco(d, "N15")["params"].update(campo="identidade_confirmada", op="<", valor=True)),
     ["params_invalidos:N15"]),
    ("registrar com 3 conectores", _mud(_set("N7", "conectores", [3, 4, 5])), ["params_invalidos:N7"]),
    ("transferir com motivo fora da lista", _mud(_set("N13", "motivo", "cobrar")), ["params_invalidos:N13"]),
    ("modelo sem conector escolhido ainda é válido", negociador(None, None, None, None), []),
]


def casos() -> list[tuple[str, object, list[str]]]:
    return copy.deepcopy(CASOS)
