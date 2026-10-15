# Prompt Horizons — Workspace 24: as telas do MotorCli (produto Jornada)

> Seções 2 e 3 substituídas pelo prompt 61 e seção 6 pelo prompt 62 (SQL 40).

Rode depois do prompt 23. O motor da jornada já roda na nuvem (`rodar_jornada.py`): toda carteira com a frente
MotorCli ganha a Lista do dia, o enquadramento de cada cliente (`jornada_cliente`) e os lotes da Mensageria.
Estas telas só leem e configuram; nada de dado pessoal na tela (só o ID do cliente).

```text
MotorCli: produto "Jornada" no menu lateral escuro (app-shell), visível só com a frente MotorCli. Não mude o
MotorCob. Mesmos componentes, cabeçalho e estilo da Orquestração.

1. SELETOR DE PRODUTO na frente MotorCli: Workspace · Jornada (/jornada, ponto #8E8E93) · Mensageria · Console
   MotorCX (só equipe). Itens do menu da Jornada: Operação: Início (/jornada), Lista do dia (/jornada/lista),
   Enviar arquivos (/jornada/cargas) · Configuração: Carteiras (/jornada/carteiras), Momentos da jornada
   (/jornada/momentos), Canais (a tela de canais que já existe) · fixo: Relatórios, Usuários, Auditoria.
   SELETOR DE CARTEIRA no topo das telas: credores da empresa com frente='motorcli' e ativo (o nome na tela é
   "Carteira"). Sem carteira: card "Crie a primeira carteira" → /jornada/carteiras.

2. /jornada (Início): título "Jornada" e a linha "{empresa} · {carteira} · {data da última rodada}".
   - 5 cards (um por momento, nesta ordem): Pré-vencimento, Boas-vindas, Ativação, Retenção, Reativação. Cada
     card: nome, clientes com ação hoje (jornada_resumo com motivo='com ação hoje' e o momento) e o total no
     momento. Momento desligado na estratégia: card cinza "Desligado".
   - "Quem ficou de fora hoje": lista de jornada_resumo com momento='' ou motivo<>'com ação hoje', agrupada por
     motivo, com o número de clientes (ex.: "em atraso: fica com a cobrança (MotorCob)" 120).
   - "Ações dos últimos 30 dias": acoes_dia da carteira, somando enviadas por regua (o momento) e canal,
     em barras simples. Nomes: boas_vindas=Boas-vindas, ativacao=Ativação, pre_vencimento=Pré-vencimento,
     retencao=Retenção, reativacao=Reativação.

3. /jornada/lista: igual à Lista do dia da Orquestração (fila_dia da carteira e da data), colunas ID do
   cliente, Momento, Passo (D-5, D0, D+3…), Canal. Filtros por momento e canal. Botão "Baixar por canal" usa os
   arquivos saidas/{slug}/{data}/{codigo}/ids/{canal}.csv, como hoje. Sem telefone nem e-mail na tela.

4. /jornada/cargas: envio de 2 arquivos da carteira, com o mesmo upload de hoje (bucket entradas, linha em
   envios com credor_id da carteira): "Clientes da jornada" (tipo 'clientes') e "Contatos" (tipo 'contatos').
   Mostre o layout esperado e um botão "Baixar modelo" que gera o CSV vazio com o cabeçalho:
   Clientes: id_cliente;data_contratacao;proximo_vencimento;vencimento_pago;ativado;ultima_atividade;dias_atraso;bloqueio
   Contatos: id_cliente;contato;tipo;whatsapp_valido   (tipo = telefone ou email; whatsapp_valido = sim só se confirmado)
   Ajuda curta: "Datas em AAAA-MM-DD ou DD/MM/AAAA. vencimento_pago e ativado: sim ou não. Cliente com
   dias_atraso maior que zero fica com a cobrança (MotorCob)." Histórico de envios com status e relatório.

5. /jornada/carteiras: lista de credores com frente='motorcli' (nome, código, estratégia, ativo) e "Nova
   carteira" (insert em credores com frente 'motorcli'; código minúsculo sem espaço). Quem pode: os mesmos de
   Credores hoje. Estratégia: só as estrategias com frente='motorcli' (vazio = a padrão da frente).

6. /jornada/momentos: estratégias da frente MotorCli (estrategias com frente='motorcli'), com "Nova" e
   "Padrão" (uma padrão por frente). definicao = {"recencia_horas": 48, "momentos": {"<momento>": {"ativo":
   true, "passos": {"<dia>": [{"canal": "rcs", "senao": "sms"}]}}}}. Tela: um bloco por momento com
   chave Ligado/Desligado e a lista de passos (dia, canal, "senão"). Dias permitidos: Boas-vindas 0 a 2
   (dias desde a contratação) · Ativação 3 a 30 · Pré-vencimento -5 a 0 (dias até o vencimento; mostre D-5)
   · Retenção 30 a 89 e Reativação 90 a 365 (dias sem atividade). Canais: WhatsApp, RCS, SMS, E-mail, Agente
   virtual (agente_voz), Discador, e "Melhor canal" (canal 'melhor' + opcoes: escolha 2 ou 3 canais). Passo
   sem "senão" é permitido. Momento sem passos personalizados usa o padrão do MotorCli (mostre o padrão em
   cinza: Boas-vindas D0 e-mail + RCS senão SMS · Ativação D+3, D+7, D+15, D+30 · Pré-vencimento D-5, D-2, D0
   · Retenção D+30, D+45, D+60, D+75 · Reativação D+90, D+120, D+180, D+270). Recência: campo "Horas entre
   ações" (padrão 48; o pré-vencimento não espera). Salvar grava definicao; valide os dias antes de salvar.

Confira em 1440 e 390px, com uma empresa que tem as duas frentes: o MotorCob continua igual; no MotorCli o
menu mostra só a Jornada e a Mensageria, e nenhuma tela mostra telefone, e-mail ou CPF.
```
