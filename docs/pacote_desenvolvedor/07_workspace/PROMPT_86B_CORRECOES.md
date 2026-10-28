# Prompt Horizons — 86b: correções do que entrou dos prompts 83 a 86 (conferência de 28/10)

CX, 28/10/2026. Rode depois do 86. Depois deste, cole de novo o PROMPT_84_ESTAGIOS inteiro: ele não entrou
(o passo Estágios ainda mostra o editor de fases antigo, sem a lista de estágios, "+ Estágio", condições,
ordem por arrastar, nomes das fases nem Propensão/Abordagem "em breve").

```text
NÃO crie, altere ou apague tabelas, views ou políticas. Só a tela /orquestracao. Não mude gravações, regras
nem permissões. Nada de CPF ou nome de devedor.

## 1. ?carteira= e ?segmento= da URL (hoje não selecionam nada)
Os parâmetros da URL chegam como texto e os ids das carteiras e dos segmentos são números. Hoje a tela compara
texto com número e nunca acha a carteira nem o segmento: o "Resolver" da Lista do dia e do Início abre a
Orquestração sem trocar a carteira e sem abrir o segmento.
- carteira: procure a carteira com String(c.id) === carteira da URL (ou Number(carteira) === c.id) e, se for
  diferente da carteira do contexto, chame o selectCredor(id) de hoje.
- segmento: converta para número antes de comparar com segmentos_em_uso.cluster_id e de escolher o segmento
  (o valor especial "demais" continua texto).
- passo: continua como hoje.

## 2. "≈ N sem estágio" usa o número errado
Hoje o cartão do passo 3 ("N estágios · ≈ N sem estágio") e o Revisar ("≈ N clientes sem estágio ficam sem
ação") usam a contagem de clientes SEM PERSONA (soma de enquadramento com persona_usuario vazio). Troque, nos
dois lugares, pela contagem de clientes sem estágio:
- consulta só de contagem (head: true, count: 'exact') em estado_cliente, filtrando empresa_id, credor_id da
  carteira, na_carga não falso e motivo_hoje começando por "sem ação: sem estágio", "sem ação: a fase do
  cliente" ou "sem ação: acordo quebrado, mas a quebra" (os dois últimos são o texto antigo);
- no passo 3, com um segmento escolhido, filtre também cluster_atual = código do segmento;
- recarregue ao trocar de carteira e depois de Salvar. A contagem de clientes sem persona continua onde já
  estava (personas), com o nome dela.

## 3. Não mexa
O que já entrou certo fica como está: abas (81), redirecionamentos /estrategias, /estrategias/:id e /clusters,
definição vazia com as 5 fases desligadas e "Desligar todos os estágios", os 3 caminhos e os modelos (frente
'motorcob', sem uso, padrao false, "O que vem dentro"), "Guardar como modelo" com nome único, "Sem estágio"
na Lista do dia e o item do Início.

Aceite: abrir /orquestracao?carteira=<id>&segmento=<id>&passo=estagios troca a carteira para a do link e
abre aquele segmento no passo Estágios; o "Resolver" da Lista do dia e do Início leva à carteira certa; o
número "sem estágio" do passo 3 e do Revisar bate com a linha "Sem estágio" da Lista do dia da mesma carteira
(e muda quando se escolhe outra carteira); a contagem de clientes sem persona não aparece mais como "sem
estágio". 1440 e 390 px, claro e escuro.
```
