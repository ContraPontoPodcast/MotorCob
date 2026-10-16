# Prompt Horizons — 67: Console › Assistente (substitui a aba "Assistente" do Console › Atendimento, prompt 17)

Rode depois do SQL 43 e do prompt 66. Protótipo aprovado em 16/10/2026: `docs/homologacao/assistente-prototipo.html`
(telas "Painel", "Para resolver" e "Respostas da equipe").

```text
NÃO crie, altere ou apague tabelas, views ou políticas. A equipe nunca vê quem perguntou no Painel.

## 1. Lugar
Console › Assistente (/console/assistente), com abas Painel · Para resolver · Respostas da equipe · Sugestões.
A aba antiga "Assistente" de Console › Atendimento vira o link "Agora em Console › Assistente".
Painel: toda a equipe. As outras abas: rpc pode_responder_assistente() (Master e Atendimento); sem ela, aviso
"Quem cuida das respostas do Assistente é o Atendimento."

## 2. Painel
Período 7 · 30 · 90 dias → rpc assistente_painel(dias). Cartões: Perguntas ({pessoas} pessoas · {empresas} empresas)
· Respondidas (respondidas_pct %, "{sem_resposta} sem resposta") · Aprovação (aprovacao_pct %, "👍 sobre avaliadas
({avaliadas})") · Viraram chamado · Custo no mês (custo.brl em R$, "teto R$ {custo.teto} · {custo.pct}%"; barra que
fica âmbar com 80% e vermelha com 100%; sem cotação: "aguardando a cotação do dólar") · Fora do ar (falhas nossas,
à parte). Tempo médio de resposta (tempo_medio_ms em segundos) em texto pequeno.
"Temas mais perguntados" (temas: barras horizontais com o número) e "Telas com mais dúvida sem resposta" (telas:
Tela · Perguntas · Sem resposta %, vermelho acima de 20%).
Só o Master: "Teto do mês" (R$) e "Cotação do dólar" (vazio = Banco Central, com "PTAX de {cotacao_em}") →
rpc salvar_assistente_config(teto, cotacao|null), com resumo antes de salvar. Texto: "Com o teto atingido, o
Assistente responde só com as Respostas da equipe e o Suporte até virar o mês."

## 3. Para resolver
Abas de situação: Novas · Base completada · Viraram chamado · Ignoradas → rpc assistente_fila(resolucao, 30)
('nova' | 'base_completada' | 'virou_chamado' | 'ignorada'). Colunas: Pergunta · Tela · Por quê (pílula "sem
resposta" âmbar ou "👎 {motivo em palavras}" vermelha) · Repetiu ({repetiu}× · {empresas} empresas) · Ações:
"Responder na base" (abre o item 4 com a pergunta e a tela preenchidas; ao publicar, rpc
resolver_perguntas_assistente(ids, 'base_completada')) · "Ignorar" (Motivo obrigatório →
resolver_perguntas_assistente(ids, 'ignorada', motivo)) · "Ver chamado" quando virou chamado.

## 4. Respostas da equipe
from('assistente_respostas') — lista: Pergunta · Tela · Frente · Usada (usos) · 👍 (aprovacoes / (aprovacoes +
reprovacoes)) · Ativa. "Nova resposta" e editar no PainelEdicao: Pergunta (como o cliente escreve, 5 a 200) ·
Resposta (até 1500, sem markdown) · Passos (até 6) · Tela relacionada (lista de ações do prompt 17) · Frente (Todas ·
MotorCob · MotorCli) · Ativa. A tela recusa CPF, e-mail, telefone, números longos e "R$" antes de salvar (o banco
também recusa: mostre "Sem dado pessoal nem preço na resposta"). Texto: "Vale em até 1 minuto, sem publicar a
função. Fica na Auditoria." "Testar a pergunta" abre a gaveta do Assistente com a pergunta.

## 5. Sugestões
from('assistente_sugestoes'): agrupado por tela (rota). Até 3 ativas por tela, arrastar para ordenar; Nova (tela +
pergunta, 5 a 120). Texto: "Aparecem em 'Nesta tela' na gaveta; tela sem sugestão própria usa as da tela de cima."

Confira em 1440 e 390 px, claro e escuro.
```
