# Prompt Horizons — Workspace 10: Mensageria com RCS, respostas e operadora

Rode depois do SQL 13 e do prompt 6 (Mensageria). Só acrescenta; não refaça a página.

```text
Ajustes na página /mensageria e em Empresa › Módulos. Não mude tabelas, views ou políticas.

1. CANAL RCS nos lotes: pílula rcs "RCS" #3B5BA9 (além de SMS #7A4FB0 e E-mail #A2552B) em Hoje, Lotes e no
   detalhe. Filtro de canal da aba Lotes com RCS.

2. NÚMEROS DO LOTE (Hoje e Lotes): acrescente "Respostas" (coluna respostas de mensageria_lotes) depois de
   Descadastros. Legenda curta conforme o canal: SMS "Respostas são cobradas pelo preço do SMS."; RCS "Com agente
   conversacional, quem responde abre uma sessão de 24 h."

3. DETALHE DO LOTE (/mensageria/lotes/{id}): selecione também item, operadora e respondida_em. Colunas novas:
   - Tipo (item): sms "SMS", email "E-mail", rcs_basic "RCS Basic", rcs_single "RCS Single", rcs_conversacional
     "RCS Conversacional", rcs_sessao "Na sessão (sem custo)".
   - Operadora (só SMS): vivo "Vivo", claro "Claro", tim "TIM", oi "Oi", outras "Outras", invalido "Número
     inválido" (vermelho).
   - Respondeu: "Sim · {hora}" quando respondida_em, senão "—".
   Filtro por Operadora (só SMS). O CSV exportado ganha essas três colunas.
   Motivos novos aparecem em texto como vêm do banco ("frase acima de 160 caracteres", "número inválido (consulta
   de operadora)").

4. EMPRESA › MÓDULOS › card Mensageria (só equipe MotorCob): campo "Agente RCS" com o segmentado
   "Não conversacional" / "Conversacional" → upsert em mensageria_config {empresa_id, rcs_agente:
   'nao_conversacional' | 'conversacional'} (onConflict 'empresa_id'). Legenda: "Conversacional: a resposta do
   cliente transforma o envio em sessão Conversacional (cobrada como tal) e, por 24 h, novas mensagens para o
   mesmo número não têm custo extra." Cliente vê o valor, sem editar. Canais liberados ganham a pílula RCS.

5. MODELO DE TEXTO: onde o site mostra ou edita frases de SMS (Canais e frases), conte os caracteres ao lado do
   campo: "{n}/160"; acima de 160 em vermelho com "O SMS acima de 160 caracteres não é enviado." Nas frases de RCS:
   até 160 "RCS Basic"; acima "RCS Single (preço diferente)".

Sem rolagem lateral em 1440, 1024 e 390px. Foco visível; Esc fecha modais.
```
