# Prompt de ajuste do site: personas aparecendo e sendo usadas no orquestrador

Não precisa de SQL novo (usa `personas_usuario`, `estrategias` e a view `enquadramento`, que já
existem). Pré-requisito: `20261007000001_personas_usuario.sql` aplicado.

---

```text
As personas da carteira (personas_usuario) precisam APARECER e ser USADAS na Orquestração da
carteira. Hoje "Usar nesta carteira" copia o modelo, mas o usuário não vê nada mudar no
orquestrador. NÃO crie, altere ou apague tabelas, views, buckets ou políticas. Tudo filtrado
pela carteira (credor do topo / credor_id).

## Dados
- personas_usuario (id, credor_id, nome, descricao, ordem, condicoes, cor, ativo).
  Os canais sugeridos de quem veio dos modelos estão na descricao, depois de
  " · Canais sugeridos: " (texto separado por vírgula); se existir personas_modelo com o
  mesmo nome, use personas_modelo.canais_sugeridos (lista de canais) no lugar.
- view enquadramento (credor_id, persona_usuario, clientes, ...): quantos clientes caíram em
  cada persona na última rotina.
- estrategias.definicao: a esteira. Cada dia é uma lista de ações
  {"canal": ..., "modo": "sempre"|"senao"|"junto"|"reserva", "personas": [ids]}
  em definicao.localizacao.passos, definicao.giro.passos, definicao.preventivo.passos,
  definicao.quebra.passos (chaves = número do dia, ex. "1", "3").

## 1. Bloco "Personas desta carteira" no topo da Orquestração da carteira
Logo acima do Desenho da Esteira, uma faixa com um chip por persona ATIVA da carteira (na
ordem): bolinha da cor, nome, quantos clientes (enquadramento.clientes com persona_usuario =
nome; antes da 1ª rotina "—"), e um selo:
- verde "Na esteira" se o id dela aparece em alguma ação ("personas") da esteira da carteira;
- âmbar "Fora da esteira: recebe as mesmas ações de todos" se não aparece.
Último chip, cinza: "Sem persona" com a contagem. Link "Gerenciar personas" → aba Personas.
Sem nenhuma persona: "Esta carteira não tem personas. Crie em Personas ou use um modelo."
Texto curto: "Cada cliente fica na primeira persona que combina com ele. Para mudar o canal de
uma persona, use o botão Público no canal do dia, ou monte a esteira pelas personas."

## 2. Botão "Montar esteira pelas personas" (admin e planejamento)
No mesmo bloco. Abre um modal com:
- a lista das personas ativas, na ordem, cada uma com os canais sugeridos (editáveis: chips
  na ordem, com × e + canal; só os 6 canais);
- escolha da faixa: "Cliente novo" (padrão), "Não CPC";
- os dias da faixa que já têm ação (ex.: D+1, D+3, D+5, D+7);
- prévia em texto: "D+1: WhatsApp para Digital nativo; senão Discador para Só telefone fixo;
  senão SMS para os demais".
Ao confirmar, para cada dia k da lista (1º dia = 1º canal sugerido, 2º dia = 2º, ...; quando
acabar a lista da persona, repete o último), REESCREVA as ações do dia assim, nesta ordem:
  1) para a 1ª persona: {"canal": canal_dela_no_dia, "modo": "sempre", "personas": [id]}
  2) para cada persona seguinte: {"canal": canal_dela_no_dia, "modo": "senao", "personas": [id]}
  3) por último, para quem não tem persona: as ações que o dia já tinha, com o primeiro item
     convertido para "modo": "senao" e SEM "personas" (os "junto" e "reserva" dele ficam
     como estavam, logo depois). Se o dia não tinha ação, use {"canal":"sms","modo":"senao"}.
IMPORTANTE: só o 1º item é "sempre"; todos os outros itens de persona são "senao". Assim cada
cliente recebe só o canal da sua persona (e, se não tiver contato para ele, cai no próximo
"senão").
Antes de gravar, mostre "Isso substitui as ações desses dias. Continuar?". Grave em
estrategias.definicao (update) e mostre o toast "Esteira montada pelas personas · vale a
partir da próxima rotina (em até 1 minuto)".

## 3. Botão "Público" em cada canal do dia (se ainda não existir)
Cada chip de canal colocado num dia tem um botão pequeno "Público" (ícone de pessoas): menu
com "Todos" (padrão) e as personas ativas desta carteira (checkbox, com a cor). Grava na
ação "personas": [ids] (sem a chave quando for Todos). No chip, abaixo do canal: "só {nome}"
(ou "só N personas") com a cor da persona. Ação com persona apagada/inativa: aviso vermelho
"persona removida" e, ao salvar, tira o id.

## 4. Na aba Personas
Depois de "Usar nesta carteira" (ou de criar uma persona), o toast passa a ter o botão
"Ir para a Orquestração", que abre a Orquestração da carteira já com o modal "Montar esteira
pelas personas" aberto.
```
