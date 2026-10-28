# Prompt Horizons — 80b: vista Fluxo da Orquestração (o item 3 do 80, que não entrou)

28/10/2026. Conferido no código publicado depois do 80: a ordem dos canais na célula (conector em pílula) e o
quadro "Primeiro canal / Depois" entraram; a vista Fluxo não (não existe "Raias | Fluxo" nem mc-orq-forma). Este
prompt traz só a vista Fluxo. Protótipo aprovado: `orquestracao-prototipo.html` v3.

```text
NÃO crie, altere ou apague tabelas, views ou políticas. Não crie formato de dado novo, não mude consultas, gravações
nem regras. Só a tela /orquestracao. O que já existe e NÃO deve mudar: a célula das raias com o 1º canal em destaque
e os conectores em pílula, e o quadro de edição da célula ("Primeiro canal" / "Depois" / "Sem ação neste dia").

## 1. Controle "Raias | Fluxo"
Na barra da Orquestração, quando a vista é "Desenho da esteira": controle segmentado "Raias | Fluxo" à esquerda das
vistas (ativo com fundo var(--base-texto) e texto var(--base-cartao)). Guarde a escolha em localStorage mc-orq-forma;
padrão Raias. Nas outras vistas o controle some.

## 2. Mesmos dados, outra forma
O Fluxo é desenhado DENTRO do mesmo componente do editor que desenha as raias, com a mesma definição e a mesma
função de mudança que ele recebe (nada carregado ou copiado para um estado próprio). Trocar Raias ↔ Fluxo só troca o
desenho; não desmonta o editor nem a tela e não perde "Alterações não salvas". No topo, um botão por faixa: Cliente
novo · Deu CPC · Não CPC · Acordo (Preventivo e Quebra), cada um com a linha de resumo que esse componente já calcula
(a mesma da Visão geral). Desenhe só a faixa escolhida.

## 3. Caminho por dias (Cliente novo, Não CPC, Preventivo, Quebra)
- Caminho vertical: nó "Entra em {faixa}" → um cartão por dia com ação ("Dia N" + o rótulo D+N ou D-N de hoje),
  ligados por uma linha com seta. Dias seguidos sem ação viram um nó tracejado "Dias X–Y sem ação".
- No cartão, as ações na ordem: a 1ª em destaque (bolinha colorida do canal, nome em peso 700) com a frase dela; as
  seguintes como ramos com o conector: "↳ senão · se nada acima foi", "↻ reserva · se o de cima não contatar no dia",
  "e sempre · além do que foi acima"; as "+ junto" ficam lado a lado com a de cima. Cores dos canais: as de sempre.
- Não CPC: o nó de entrada diz "ciclo de N dias, repetido M vezes" (giro.ciclo_dias e giro.max_ciclos).
- Faixa desligada: um nó "Desligada" com o texto do resumo, sem caminho.
- Raias de persona: ao lado do cartão do dia, um cartão tracejado "Persona {nome} → {ações}", só nos dias em que a
  persona tem raia; abaixo do caminho, "{personas}: nos outros dias, segue o geral".

## 4. Deu CPC (não tem dias)
Nós só de leitura com a configuração de hoje: ordem dos canais do CPC (cpc.ordem) · CPC A a cada N dias
(cpc.intervalo_cpa) · CPC B a cada M dias (cpc.intervalo_cpb) · tentativas por canal (cpc.tentativas_por_canal) ·
reforço junto (cpc.junto). Clicar volta às Raias com a faixa Deu CPC aberta.

## 5. Saídas (só leitura)
Fim do caminho: "Saídas deste momento", com os textos e números que a tela já tem: Cliente novo "contato → Deu CPC" e
"D+{dia} sem CPC → Não CPC" (localizacao.dias_sem_contato_para_ncp); Deu CPC "sem resposta → CPC B" e "esgotou os
canais → Não CPC"; Não CPC "contato → Deu CPC" e "ao fim dos ciclos, espera novo enriquecimento"; Acordo "quebra sem
pagamento → volta ao estoque como CPC A em {K} dias" (quebra.dias_para_estoque; com quebra.carencia, "a partir do
D+…" como no resumo). Use os mesmos valores padrão da tela quando faltarem. Sem botão nem campo de edição.

## 6. Edição e permissões
Clicar num cartão de dia, numa ação ou num desvio de persona abre o MESMO quadro de edição da célula que já existe
(o de "Primeiro canal" / "Depois"), para aquele dia e público. Quem não edita a Orquestração (ex.: Operação) vê o
Fluxo e o quadro só em leitura, como as raias hoje.
Rodapé do Fluxo: "As faixas de segurança valem sempre: 08:00–20:00, intervalo mínimo de 12 h, freio do WhatsApp
até 5%." (o mesmo texto das Travas).

## 7. Celular (< 1024 px)
Vertical, uma faixa por vez, cartões na largura toda; o desvio de persona fica abaixo do dia.

Aceite: o controle "Raias | Fluxo" aparece no Desenho da esteira e lembra a escolha; mudar uma ação no Fluxo aparece
igual nas Raias e vice-versa; trocar Raias ↔ Fluxo não perde alterações não salvas; o Fluxo não grava nada sozinho
(só o Salvar); as saídas não têm controle de edição. Confira em 1440 e 390 px, claro e escuro, como Admin e
Operação (leitura).
```
