"""Os 4 modelos para começar um fluxo (voz_fluxo_modelos, SQL 58). Fonte única: a migração grava exatamente estes
JSONs (tests/test_voz_fluxo_validador.py confere que o texto do SQL bate com este módulo e que todos passam no
validador). Conectores ficam sem escolha (null): a empresa escolhe os dela antes de mandar para aprovação.
"""
from __future__ import annotations

from voz.fluxo_casos import _s, negociador

RECADO = "Peço que {{primeiro_nome}} retorne a ligação para a {{assessoria}}. Obrigada."
ABERTURA = "Olá, aqui é a central da {{assessoria}}. Falo com {{primeiro_nome}}?"
IDENTIDADE = "Para sua segurança, me confirma o dia e o mês do seu nascimento?"
TRANSFERE = "Vou passar você para um atendente agora, só um instante."


def localizador() -> dict:
    return {"esquema": 1, "blocos": [
        {"id": "N1", "tipo": "abertura", "modo": "arvore", "x": 300, "y": 20, "params": {"fala": ABERTURA},
         "saidas": [_s("Sou eu", "N2", "titular"), _s("Não é a pessoa", "N6", "terceiro")]},
        {"id": "N2", "tipo": "identidade", "modo": "cognicao", "x": 300, "y": 180,
         "params": {"fala": IDENTIDADE, "pergunta": "dia_mes_nascimento", "conector_id": None, "tentativas": 2},
         "saidas": [_s("Confirmou", "N3", "confirmou"), _s("Não confirmou", "N6", "nao_confirmou")]},
        {"id": "N3", "tipo": "pergunta", "modo": "arvore", "x": 300, "y": 360,
         "params": {"fala": "Obrigada. Posso transferir você agora para um atendente da {{assessoria}}?", "tentativas": 1,
                    "opcoes": [{"codigo": "sim", "rotulo": "Pode transferir"}, {"codigo": "nao", "rotulo": "Agora não"}]},
         "saidas": [_s("Pode transferir", "N4", "sim"), _s("Agora não", "N5", "nao"), _s("Sem resposta", "N4", "sem_resposta")]},
        {"id": "N4", "tipo": "transferir", "modo": "arvore", "x": 80, "y": 540, "params": {"fala": TRANSFERE, "motivo": "cpc"},
         "saidas": []},
        {"id": "N5", "tipo": "retorno", "modo": "cognicao", "x": 300, "y": 540,
         "params": {"fala": "Sem problema. Quando fica melhor para falarmos?", "dias_max": 7},
         "saidas": [_s("Agendou", "N7", "agendou"), _s("Não agendou", "N8", "nao_agendou")]},
        {"id": "N6", "tipo": "encerrar", "modo": "arvore", "x": 560, "y": 180, "titulo": "Encerrar · recado neutro",
         "params": {"fala": RECADO, "resultado": "recado"}, "saidas": []},
        {"id": "N7", "tipo": "encerrar", "modo": "arvore", "x": 300, "y": 720,
         "params": {"fala": "Combinado, eu ligo nesse horário. Até lá!", "resultado": "retorno_agendado"}, "saidas": []},
        {"id": "N8", "tipo": "encerrar", "modo": "arvore", "x": 560, "y": 720,
         "params": {"fala": "Obrigada pela atenção. Até logo.", "resultado": "cpc"}, "saidas": []},
    ]}


def ambos() -> dict:
    return {"esquema": 1, "blocos": [
        {"id": "N1", "tipo": "abertura", "modo": "arvore", "x": 300, "y": 20, "params": {"fala": ABERTURA},
         "saidas": [_s("Sou eu", "N2", "titular"), _s("Não é a pessoa", "N10", "terceiro")]},
        {"id": "N2", "tipo": "identidade", "modo": "cognicao", "x": 300, "y": 180,
         "params": {"fala": IDENTIDADE, "pergunta": "dia_mes_nascimento", "conector_id": None, "tentativas": 2},
         "saidas": [_s("Confirmou", "N3", "confirmou"), _s("Não confirmou", "N10", "nao_confirmou")]},
        {"id": "N3", "tipo": "conector", "modo": "sistema", "x": 300, "y": 360,
         "params": {"conector_id": None, "fala_espera": "Um instante, vou ver as condições para você."},
         "saidas": [_s("Respondeu", "N4", "respondeu"), _s("Falhou", "N9", "falhou", "falha")]},
        {"id": "N4", "tipo": "condicao", "modo": "sistema", "x": 300, "y": 540,
         "params": {"campo": "ofertas_quantidade", "op": ">=", "valor": 1},
         "saidas": [_s("Tem oferta", "N5", "sim"), _s("Sem oferta", "N9", "nao")]},
        {"id": "N5", "tipo": "generativa", "modo": "generativo", "x": 300, "y": 720,
         "params": {"objetivo": "Apresentar as ofertas recebidas e fechar um acordo com uma delas. Se a pessoa não "
                                "quiser negociar agora, devolva por sem_acordo para transferir com o titular na linha.",
                    "tom": ["cordial", "frases_curtas", "nao_pressiona"], "max_turnos": 8,
                    "ferramentas": ["apresentar_oferta", "consultar_base", "transferir_humano", "encerrar_chamada"],
                    "contrapropostas_max": 2},
         "saidas": [_s("Fechou acordo", "N6", "fechou_acordo", "devolve"), _s("Sem acordo", "N9", "sem_acordo", "devolve"),
                    _s("Contestou", "N8", "contestou", "devolve")]},
        {"id": "N6", "tipo": "registrar", "modo": "sistema", "x": 80, "y": 900,
         "params": {"registra": "promessa_motorcx", "conectores": []},
         "saidas": [_s("Registrado", "N7", "registrado"), _s("Falhou", "N9", "falhou", "falha")]},
        {"id": "N7", "tipo": "encerrar", "modo": "arvore", "x": 80, "y": 1080,
         "params": {"fala": "Combinado. Obrigada pela atenção, até logo.", "resultado": "promessa"}, "saidas": []},
        {"id": "N8", "tipo": "transferir", "modo": "arvore", "x": 560, "y": 900,
         "params": {"fala": TRANSFERE, "motivo": "contestacao"}, "saidas": []},
        {"id": "N9", "tipo": "transferir", "modo": "arvore", "x": 560, "y": 540, "params": {"fala": TRANSFERE, "motivo": "cpc"},
         "saidas": []},
        {"id": "N10", "tipo": "encerrar", "modo": "arvore", "x": 560, "y": 180, "titulo": "Encerrar · recado neutro",
         "params": {"fala": RECADO, "resultado": "recado"}, "saidas": []},
    ]}


def branco() -> dict:
    return {"esquema": 1, "blocos": [
        {"id": "N1", "tipo": "abertura", "modo": "arvore", "x": 300, "y": 20, "params": {"fala": ABERTURA},
         "saidas": [_s("Sou eu", "N2", "titular"), _s("Não é a pessoa", "N4", "terceiro")]},
        {"id": "N2", "tipo": "identidade", "modo": "cognicao", "x": 300, "y": 180,
         "params": {"fala": IDENTIDADE, "pergunta": "dia_mes_nascimento", "conector_id": None, "tentativas": 2},
         "saidas": [_s("Confirmou", "N3", "confirmou"), _s("Não confirmou", "N4", "nao_confirmou")]},
        {"id": "N3", "tipo": "encerrar", "modo": "arvore", "x": 300, "y": 360,
         "params": {"fala": "Obrigada pela atenção. Até logo.", "resultado": "identidade_confirmada"}, "saidas": []},
        {"id": "N4", "tipo": "encerrar", "modo": "arvore", "x": 560, "y": 180, "titulo": "Encerrar · recado neutro",
         "params": {"fala": RECADO, "resultado": "recado"}, "saidas": []},
    ]}


# codigo → (nome, tipo_agente, descrição, definição)
MODELOS = {
    "localizador": ("Localizador", "localizador",
                    "Confirma o titular e transfere para o discador de vocês. Quase tudo árvore.", localizador),
    "negociador": ("Negociador", "negociador",
                   "Confirma o titular, entende a intenção, busca ofertas no CRM e negocia.",
                   lambda: negociador(None, None, None, None)),
    "ambos": ("Localizador + Negociador", "ambos", "Negocia quando há oferta; sem oferta, transfere com CPC.", ambos),
    "branco": ("Em branco", "negociador", "Só Abertura, Confirmar identidade e Encerrar. As travas já vêm valendo.", branco),
}
