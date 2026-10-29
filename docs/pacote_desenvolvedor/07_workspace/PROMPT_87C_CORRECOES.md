# Prompt Horizons — 87c: erro da propensão no passo Estágios não pode virar "Coletando" calado

CX, 29/10/2026. Rode depois do 87b. Conferido no bundle de 29/10: na Lista do dia e em Personas o erro de
verdade já aparece como aviso; na Orquestração ele é engolido e a carteira passa a parecer "Coletando".

```text
NÃO crie, altere ou apague tabelas, views ou políticas. Só a tela /orquestracao. Não mude consultas nem
regras. Nada de CPF ou nome de devedor.

Na Orquestração, a leitura da propensão da carteira (a mesma função do módulo de propensão que lê a view
propensao_carteira) está dentro de um try/catch que chama a função de mensagem de erro e descarta o
resultado, deixando a propensão vazia ("Coletando").
- Banco sem SQL 48 (a função já devolve vazio sem lançar erro): continua "Coletando", como hoje.
- Qualquer erro lançado: mostre o aviso de erro de hoje da tela (o mesmo texto que a função de mensagem de
  erro devolve, no lugar onde a tela já mostra os erros de carregamento) e, no estágio com condição de
  propensão, troque a prévia por "prévia indisponível (erro ao ler a propensão)" em vez de "Coletando".

Aceite: com o SQL 48 rodado, se a leitura de propensao_carteira falhar por outro motivo (ex.: rede), a
Orquestração mostra o aviso de erro e a prévia "indisponível", não o selo "Coletando"; sem erro, tudo como
no 87b. 1440 e 390 px.
```
