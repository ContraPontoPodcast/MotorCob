# Prompt Horizons — 87b: duas consultas da propensão com nome de coluna errado

CX, 29/10/2026. Rode depois do 87. Conferido no bundle de 29/10 (módulo de apoio da propensão, usado pelo
estágio, por Personas › Matriz e pela Lista do dia). As duas consultas abaixo dão erro de coluna inexistente;
como o 87 trata erro como "banco sem SQL 48", a tela esconde a propensão mesmo com o SQL 48 rodado.

```text
NÃO crie, altere ou apague tabelas, views ou políticas. Só corrija as duas consultas abaixo no módulo de
apoio da propensão (o que tem o texto "Propensão a pagamento: chance de pagar em 30 dias…"). Não mude o resto
do 87. Nada de CPF ou nome de devedor.

## 1. Leitura da view propensao_carteira (Matriz, faixa da carteira, prévia e selo Coletando)
Hoje: .from('propensao_carteira').select('faixa_propensao,clientes,saldo,valor_esperado,cluster,persona').
A view não tem "persona"; a coluna é persona_usuario. Troque para
.select('faixa_propensao,clientes,saldo,valor_esperado,cluster,persona_usuario') e, onde o código usar
.persona dessas linhas, use .persona_usuario.

## 2. Contagens da Lista do dia ("Com ação hoje, por propensão")
Hoje as 6 contagens fazem .from('estado_cliente').select('id', { count: 'exact', head: true }). A tabela
estado_cliente não tem coluna "id" (a chave é id_cliente). Troque para
.select('id_cliente', { count: 'exact', head: true }) nas 6 contagens (A, B, C, D, E e sem faixa).
No mesmo bloco, troque .eq('na_carga', true) por .not('na_carga', 'is', false), para não perder quem tem
na_carga vazio (a view propensao_carteira conta esses como na carga).

## 3. Erro de verdade continua tratado
Só o erro de coluna/relação inexistente (banco sem SQL 48) leva ao "Coletando"/bloco escondido. Qualquer
outro erro: mostre o aviso de erro de hoje (o mesmo das outras consultas da tela), não "Coletando".

Aceite: com o SQL 48 rodado e uma carteira com faixas, a Matriz de Personas mostra os números por faixa e por
quadrante, a prévia "≈ N clientes hoje" de um estágio de propensão soma as faixas marcadas, o selo mostra
Prévia/Definida, e a Lista do dia mostra o bloco "Com ação hoje, por propensão" com as 6 contagens e links;
no console do navegador não aparece erro 400 de propensao_carteira nem de estado_cliente. 1440 e 390 px.
```
