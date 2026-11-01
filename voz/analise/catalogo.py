"""Listas fechadas do Speech Analytics (SQL 56 › codigos_voz_validos, SQL 60 › voz_alertas e SQL 62 ›
codigos_speech_ok). O LLM só escolhe dentro delas; o que vier fora é recusado (e a análise pede de novo).
tests/test_voz_speech_dados.py confere que estas listas batem com o texto das migrações e com
motor/retroalimentacao.py. A intenção vem do catálogo do banco (voz_intencoes) e o tema, dos temas promovidos pela
Curadoria: os dois chegam no contexto de cada empresa (speech_contexto_voz)."""
from __future__ import annotations

MOTIVOS = ("desemprego", "reducao_renda", "outras_dividas", "esquecimento", "aguardando_recebimento", "nao_reconhece",
           "contestacao", "fraude_alegada", "insatisfacao_servico", "outro")
OBJECOES = ("valor_alto", "parcela_alta", "juros", "sem_dinheiro_agora", "quer_desconto", "desconfia_golpe",
            "quer_por_escrito", "quer_falar_humano", "outro")
CANAIS = ("whatsapp", "sms", "email", "rcs", "agente_voz", "discador")
HORARIOS = ("manha", "tarde", "noite", "sabado")
# vulnerabilidade: só o sinal vai para voz_alertas (nunca código, nunca trecho)
SINAIS = ("idade_confusao", "saude", "luto", "desemprego_recente")
# risco de reclamação/fraude: os quatro primeiros viram alerta (com trecho mascarado); fraude e reclamacao, só código
RISCOS = ("procon", "juridico", "ameaca", "abusiva", "fraude", "reclamacao")
RISCOS_ALERTA = ("procon", "juridico", "ameaca", "abusiva")
# frases-código do agente (motor/retroalimentacao.py › FRASES)
FRASES = ("reconheceu_dificuldade", "resumiu_acordo", "link_na_ligacao", "dia_vencimento")
RESPOSTAS = ("sim", "nao", "na")
FALANTES = ("cliente", "agente", "operador")

DESCRICAO = {
    "motivo": {"desemprego": "perdeu o emprego", "reducao_renda": "a renda caiu", "outras_dividas": "outras dívidas",
               "esquecimento": "esqueceu", "aguardando_recebimento": "espera receber salário/benefício",
               "nao_reconhece": "não reconhece a dívida", "contestacao": "contesta valor ou cobrança",
               "fraude_alegada": "diz que foi fraude", "insatisfacao_servico": "insatisfeito com o produto/serviço",
               "outro": "outro motivo"},
    "sinais": {"idade_confusao": "idade avançada com confusão", "saude": "problema de saúde", "luto": "luto recente",
               "desemprego_recente": "acabou de perder o emprego"},
    "riscos": {"procon": "ameaça reclamar no Procon", "juridico": "fala em processo, advogado ou justiça",
               "ameaca": "ameaça ou constrangimento", "abusiva": "linguagem abusiva/ofensiva",
               "fraude": "suspeita de fraude ou golpe", "reclamacao": "reclamação em ouvidoria, Banco Central ou site"},
    "frases": {"reconheceu_dificuldade": "o atendente reconheceu a dificuldade antes da oferta",
               "resumiu_acordo": "o atendente resumiu o combinado antes de encerrar",
               "link_na_ligacao": "o atendente mandou o link de pagamento durante a ligação",
               "dia_vencimento": "o atendente deixou escolher o dia do vencimento"},
}
