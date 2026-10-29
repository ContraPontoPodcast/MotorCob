# Prompt Horizons — 84c: coluna obrigatória no prazo do estágio e Salvar que não perde chaves

CX, 29/10/2026. Rode depois do 84b. Conferido no bundle de 29/10 (orquestracao-C1GQsscH).

```text
NÃO crie, altere ou apague tabelas, views ou políticas. Só a tela /orquestracao (passo Estágios e o Salvar).
Não mude o desenho nem as outras regras. Nada de CPF ou nome de devedor.

## 1. "Contando de uma data da carga" sem coluna
Hoje, com "contando" = de uma data da carga (referencia.tipo = 'coluna'), o select "escolha a coluna" (as
colunas de empresas.colunas_base que a tela já carrega) pode ficar vazio e o Salvar passa; o motor ignora
esse estágio.
- Junte às validações do 84b (a mesma lista que mostra "Corrija os estágios antes de salvar: …"): com
  referencia.tipo = 'coluna' e referencia.coluna vazia → "Escolha a coluna da data em “Por quanto tempo”."
- Se a lista de colunas da empresa estiver vazia (empresa sem carga ainda), troque o select por um campo de
  texto obrigatório "Nome da coluna da data na carga", com a mesma validação.
- Ao trocar "contando" para outro tipo, apague referencia.coluna.

## 2. O Salvar não pode perder chaves que a tela não mostra
Hoje o Salvar monta a definição do zero copiando só uma lista fixa (localizacao, cpc, giro, preventivo,
quebra, prioridade_contatos, mensagens, travas, etapas, ordem_etapas, rotulos_fases). Qualquer outra chave
gravada antes (ex.: recencia_horas, whatsapp, calendario ou outra que o motor leia) some no próximo Salvar.
- Passe a partir da definição carregada do banco ao abrir a estratégia (depois da conversão de "janela" do
  84b) e sobrescreva só as chaves que a tela editou: { ...definicaoCarregada, ...chavesEditadas }. Dentro
  de cada fase, mantenha também as subchaves que a tela não mostra (ex.: orcamento, travas, carencia).
- Mantenha a regra de hoje: se o resultado não tiver nenhuma fase nem estágio, use a definição com as 5 fases
  desligadas (nunca grave {}).
- Vale para o Salvar da estratégia própria, para "Separar só para esta carteira" e para "Guardar como
  modelo". "Copiar de outra carteira" continua copiando a definição inteira da origem.

Aceite: estágio com "contando de uma data da carga" e sem coluna não salva e mostra a mensagem no estágio;
sem colunas da empresa aparece o campo de texto obrigatório; uma estratégia com uma chave que a tela não
conhece (ex.: "x_teste": 1 e "recencia_horas": 72 gravadas antes) mantém as duas chaves com os mesmos valores
depois de editar um estágio e salvar; nenhuma gravação fica {}. 1440 e 390 px, claro e escuro, Admin.
```
