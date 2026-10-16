# Prompt Horizons — 54: Resposta em grupo, Painel do Radar e Configurar o atendimento

Rode depois do prompt 53. Protótipo aprovado em 15/10/2026: `docs/homologacao/radar-atendimento-prototipo.html`.

```text
Plataforma do cliente (motorcob.online). NÃO crie, altere ou apague tabelas, views ou políticas.

## 1. Responder em grupo (dentro da Caixa, com um filtro de classe ativo)
Botão "Responder em grupo" no topo da fila → painel: texto (contador 160 se houver SMS), e a tabela do custo
previsto por rpc custo_resposta_grupo(ids das conversas abertas sem resposta nossa do filtro, até 200, texto):
canal, item, mensagens, descadastrados, preço, total; linha Total. Abaixo: "N conversas com o contato descadastrado
não recebem". Botão "Enviar para N conversas" → confirmação do prompt 49: "N mensagens serão enviadas agora: X SMS
e Y RCS. Custo previsto de R$ …. As conversas ficam Aguardando cliente." → "Enviar N mensagens". Envio com o
ProcessoLongo (uma chamada de responder_conversa por conversa) e aviso no fim.

## 2. Painel do Radar (Mensageria › "Painel do Radar")
Período (Últimos 7 dias · Este mês · datas). Só respostas de lotes reais.
- Quatro números (resumo_atendimento(empresa, de, ate)): "Respostas recebidas" (respostas; abaixo "de {entregues}
  mensagens entregues (x%)"), "CPC Negócio" (de painel_radar; % das respostas), "Primeira resposta (mediana)"
  (primeira_resposta_mediana_min; abaixo "meta da empresa: N min" ou "sem meta definida") e "Esperando resposta
  agora" (esperando_agora; abaixo "a mais antiga há {mais_antiga_min} min").
- "Respostas por classe" (painel_radar(empresa, de, ate)): classe, respostas, %, "Corrigidas pela equipe" (n e %).
  Acima de 10%, pílula âmbar "revisar". Nota: "Corrigidas pela equipe mede onde o Radar mais erra."
- "Por quem atende" (desempenho_atendimento): pessoa, atendidas, primeira resposta (mediana), resolvidas. Só Admin e
  Gestão; para os outros o cartão não aparece (é sigiloso).

## 3. Configurar o atendimento (Mensageria › Configurar › Atendimento; Admin e Planejamento)
Com o painel lateral do prompt 49. Os outros veem somente leitura com "Só Admin e Planejamento configuram o
atendimento".
- "Meta de primeira resposta" (opcional): chave "Usar meta de primeira resposta" (desligada = meta nula); ligada,
  campo Minutos (5 a 240). Texto: "Acima da meta, âmbar; acima do dobro, vermelho. Sem meta, a espera aparece sem
  cor."
- "Avisos no sino": Judicial: avisar Admin e Gestão na hora (ligado) · Conversa acima do dobro da meta: avisar quem
  atende (só habilita com a meta; frase "precisa da meta") · CPC Negócio sem responsável há 10 min: avisar a Gestão
  (desligado). Salvar → salvar_config_atendimento(empresa, meta_ou_nulo, judicial, acima_meta, negocio).
- "Respostas rápidas": nenhuma vem pronta. Texto: "Cada empresa escreve as suas (com o jurídico dela, quando
  precisar). Nunca dados pessoais." Tabela nome · classe (ou Todas) · texto, com editar e apagar; vazio: "Nenhuma
  resposta rápida ainda" + "Nova resposta rápida". Salvar → salvar_resposta_rapida(empresa, id ou nulo, nome,
  classe ou nulo, texto); apagar → apagar_resposta_rapida(id), com confirmação.

Confira em 1440 e 390 px, claro e escuro.
```
