# Prompt de ajuste do site: personas como raias da esteira (arrastar para os dias)

Não precisa de SQL novo. Pré-requisito: `20261012000001_personas_empresa_do_credor.sql` aplicado
(sem ele a persona não grava). Substitui o botão "Público" e muda o "Montar esteira pelas
personas" (de `PROMPT_SITE_PERSONAS_ORQUESTRADOR.md`).

---

```text
No Desenho da Esteira (Orquestração da carteira), as personas viram RAIAS: o usuário vê o
público geral e as personas na mesma grade e ARRASTA uma persona para os dias em que quer
tratá-la diferente. As outras frentes continuam como estão. NÃO crie, altere ou apague tabelas,
views, buckets ou políticas. Continua gravando no mesmo estrategias.definicao.

## Regra (o motor já faz assim; mostre este texto como legenda da grade)
"Cada dia tem a raia do PÚBLICO GERAL. Persona colocada num dia recebe só o que está na raia
dela nesse dia; se não tiver contato para esses canais, recebe o do público geral. Nos dias em
que a persona não está, ela segue o público geral. Quem não tem persona segue o público geral."

## Gravação (não muda o formato)
Cada dia continua sendo uma lista de ações em definicao.<faixa>.passos["<dia>"]:
- raia do público geral = ações SEM a chave "personas";
- raia de uma persona = ações com "personas": [id dela] (um id por ação);
- "Sem ação neste dia" para a persona = {"canal": "sem_acao", "personas": [id]}.
Grave primeiro as ações do público geral, depois as de cada persona (na ordem das personas).
Os modos (sempre/senão/junto/reserva) funcionam dentro de cada raia como hoje.
Ao abrir, ação antiga com várias personas ("personas": [7, 9]) aparece nas duas raias; ao
salvar, grave uma ação por persona.

## 1. Paleta (acima da grade, fixa ao rolar)
Duas linhas de fichas arrastáveis:
- Canais (como hoje): WhatsApp, RCS, Agente virtual, Discador, SMS, E-mail, ★/☆, Enriquecimento.
- "Personas desta carteira": uma ficha por persona ativa (bolinha da cor + nome + nº de
  clientes da última rotina, da view enquadramento). Sem personas: link "Criar personas".

## 2. Grade de cada faixa (Cliente novo, Não CPC, Preventivo, Quebra)
Colunas = dias da faixa (D+1, D+3, …; "+ dia" como hoje). Linhas = raias:
- 1ª linha fixa "Público geral" (ícone de pessoas): as fichas de canal do dia, como hoje.
- Uma linha por persona que tem ação em algum dia desta faixa (rótulo com a cor e o nome; ×
  no rótulo tira a persona de todos os dias da faixa, com confirmação).
Célula da persona num dia SEM ação própria: tracejada e apagada, mostrando em cinza os canais
do público geral e o texto "segue o geral". Célula COM ação própria: borda na cor da persona,
com as fichas de canal dela; se for "sem ação", mostra "⦸ sem ação neste dia".

## 3. Arrastar
- Ficha de PERSONA solta numa coluna de dia (em qualquer linha daquela coluna): cria a raia da
  persona nesse dia já COPIANDO as ações do público geral daquele dia (com "personas": [id]),
  para o usuário só trocar o que quiser. Se a persona ainda não tinha linha na faixa, a linha
  aparece. Se já tinha ação própria nesse dia, só destaca a célula.
- Ficha de persona solta no rótulo "Público geral" ou fora dos dias: cria a linha dela vazia
  (todos os dias "segue o geral").
- Ficha de CANAL solta numa célula de persona: entra na raia daquela persona (mesmas regras de
  senão/junto/reserva das fichas do público geral). Solta numa célula "segue o geral": cria a
  raia da persona nesse dia só com esse canal.
- Arrastar uma ficha de canal de uma célula para outra move; com Alt/Option copia.
- No celular: tocar a ficha e depois tocar a célula faz o mesmo que arrastar.
Menu "⋯" de cada célula de persona: "Sem ação neste dia", "Voltar a seguir o geral" (apaga as
ações da persona nesse dia), "Copiar para os outros dias da faixa", "Copiar do público geral".

## 4. "Como vai funcionar" (resumo abaixo da grade)
Uma linha por dia, por público:
"D+1 · Público geral: WhatsApp; senão SMS · Digital nativo: WhatsApp + E-mail · Só telefone
fixo: Discador · Sênior: sem ação". Persona sem raia no dia não aparece na linha.
Aviso âmbar quando uma persona está com raia em todos os dias de uma faixa e o geral está
vazio nessa faixa: "Só personas nesta faixa: quem não tem persona não recebe nada".

## 5. O que sai / o que muda
- O botão "Público" das fichas de canal SAI (as raias substituem). Ações antigas com personas
  aparecem nas raias.
- "Montar esteira pelas personas" passa a: escolher QUAIS personas (checkbox, nenhuma marcada
  de início), a faixa e os dias; para cada persona marcada, cria a raia dela nesses dias com o
  canal sugerido do dia (1º dia = 1º canal sugerido, 2º dia = 2º…; acabou a lista, repete o
  último). NÃO mexe na raia do público geral nem nas personas não marcadas. Prévia antes de
  gravar.
- Bloco "Personas desta carteira" (topo): o selo "Na esteira" vale quando a persona tem raia
  em algum dia; "Fora da esteira: segue o público geral" quando não tem.
Toast ao salvar: "Esteira salva · vale a partir da próxima rotina (em até 1 minuto)".
```
