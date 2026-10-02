# Prompt de ajuste do site: lista na hora em que a carga chega

Para usar com o Mac em modo vigia (`scripts/instalar_mac.sh vigiar`). Não precisa de
migração.

---

```text
Na página Enviar arquivos, mostre o andamento da carga do credor até a lista do dia sair.
NÃO crie, altere ou apague tabelas, views, buckets ou políticas. Tudo filtrado pela empresa
selecionada.

1. Logo depois de enviar uma "Carga do credor" (insert em envios com tipo = 'base'), troque
   o botão por um cartão de andamento com 3 etapas e um ícone para cada (pendente,
   em andamento ✓ feita, ✕ erro):
   - "Carga recebida" (feita assim que o upload termina);
   - "Gerando a lista do dia" (feita quando envios.status desse envio virar 'processado');
   - "Lista pronta" (quando existir execução da empresa com status = 'ok', data_ref = hoje
     e iniciada_em depois do enviado_em da carga).
   Texto: "O MotorCob gera a lista em até 5 minutos. Pode sair desta página: a lista
   aparece em Lista do dia."
2. Enquanto não terminar, consulte envios e execucoes a cada 10 segundos (pare ao concluir
   ou ao sair da página).
3. Pronta: "Lista do dia pronta · N clientes" (N = soma de resumo.fila da execução) e o
   botão "Ver lista do dia" → página Lista do dia.
4. Erro: se o envio virar 'erro', mostre em vermelho relatorio.erro (ex.: colunas que faltam
   na carga) e o botão "Enviar outra carga". Se a execução terminar com status 'erro',
   mostre execucoes.erro.
5. Se depois de 10 minutos o envio continuar 'pendente': aviso âmbar "O MotorCob ainda não
   pegou a carga. O computador da rotina pode estar desligado ou dormindo."
6. Abaixo do botão "Ocorrência", a dica fixa: "Envie a ocorrência de ontem antes da carga
   de hoje: assim a lista já sai com os CPCs atualizados."
7. Na página Lista do dia, no topo, mostre "Gerada às HH:MM" (terminada_em da última
   execução ok de hoje). Se houver carga 'pendente' da empresa, mostre a faixa âmbar
   "Carga nova recebida: a lista será atualizada em instantes."
```
