# Prompt Horizons — 84b: gravar os estágios no formato que o motor lê (e travar o que ele ignora)

CX, 28/10/2026. Rode depois do 84 (já publicado). Conferência do bundle de 28/10: a tela grava o prazo do
estágio dentro de "janela" ({de, ate, contando, ciclo}); o motor só lê de, ate, referencia e ciclo direto na
etapa. Hoje TODO estágio criado é ignorado pelo motor ("janela de dias inválida").

```text
NÃO crie, altere ou apague tabelas, views ou políticas. Só a tela /orquestracao, passo Estágios e Régua. Não
mude o desenho nem as outras gravações. Nada de CPF ou nome de devedor.

## 1. Formato de cada estágio criado (definicao.etapas[i])
Grave assim, direto na etapa (sem o objeto "janela"):
{"id","nome","ativo","condicoes":[{campo,op,valor}],"referencia":{"tipo":"entrada"|"atraso"|"vencimento"|
"coluna","coluna":"<nome, só com tipo coluna>"},"de":<inteiro>,"ate":<inteiro>,"ciclo":{"dias","vezes"}
(só quando repetir),"passos":{"<dia>":[ações]},"saidas":{...}}
- "contando" da tela vira "referencia"; de e ate são números inteiros (não texto).
- Estágio novo já nasce com referencia {"tipo":"entrada"}, de 1 e ate 30.
- Ao abrir uma estratégia que já tem etapas com "janela", converta na hora (janela.de/ate → de/ate,
  janela.contando → referencia, janela.ciclo → ciclo), apague "janela" e marque "Alterações não salvas".

## 2. Validação que bloqueia o Salvar (com a mensagem no próprio estágio)
- Pelo menos uma condição; com > >= < <= o valor é número.
- de ≤ ate e ate − de ≤ 730.
- Ciclo: dias de 2 a 60 e vezes de 1 a 24.
- Dias da régua: sem ciclo, de "de" a "até"; com ciclo, de 1 a "dias". Na régua do estágio, "+ dia" só aceita
  dias nesse intervalo; dia que ficou fora (porque o prazo mudou) aparece em vermelho "fora do prazo".
- id: o de hoje (minúsculas, até 40, diferente das fases); nunca muda ao renomear.
Avisos que NÃO bloqueiam (como hoje): estágio sem régua, clientes sem estágio, estágio abaixo da sua fase.

## 3. Ligar uma fase que não tem régua
Hoje, ligar uma fase sem régua APAGA a chave da fase: ela volta a seguir a régua padrão do motor sem o
cliente ver (e, se todas ficarem assim, o Salvar grava as 5 desligadas). Ligar passa a gravar
{"ativo": true} mantendo o que já existe na fase; se a fase não tem régua, grave também "passos": {} (Cliente
novo, Não CPC, Acordo em dia, Acordo atrasado) e mostre "· sem régua" no estágio. Deu CPC sem canais: mostre
"· sem canais: segue a ordem padrão do motor" (não grave nada a mais).

Aceite: criar um estágio e salvar grava etapas[i] com referencia, de, ate (números) e, se marcado, ciclo, sem
"janela"; estratégia que já tinha "janela" é convertida ao abrir; não dá para salvar com de > até, ciclo fora
de 2–60 × 1–24, ">" com texto ou dia de régua fora do prazo; ligar uma fase sem régua grava ativo true e
passos {} (nunca apaga a chave); nenhuma gravação fica {}. 1440 e 390 px, claro e escuro, Admin e Operação.
```
