# Prompt Horizons — 50: Aplicar os padrões comuns nas telas que já existem

Rode depois do prompt 49. Protótipo aprovado em 15/10/2026: `docs/homologacao/padroes-comuns-prototipo.html`.
Não muda regra de negócio: só troca o jeito de editar, confirmar, avisar e mostrar.

```text
MotorCX (motorcob.online), plataforma e Console. NÃO crie, altere ou apague tabelas, views ou políticas.
Use os componentes do prompt 49.

## 1. Processo demorado (ProcessoLongo)
- Nova campanha: situações 'analisando' (etapas Recebendo o arquivo · Lendo as colunas) e 'calculando_previa'
  (Limpando telefones e repetidos · Calculando a prévia do Score). Substitui o texto "Leva alguns minutos" do
  prompt 48. Linhas: carregados da campanha.
- Jornada › Cargas (enriquecimento) e Console › Saúde (sincronização): mesma régua, só com as etapas.

## 2. Salvar com revisão (PainelEdicao)
- Console › Produtos e preços (mínimo e tabela) · Fornecedores e rotas (rota padrão do canal, rota do produto e
  mistura de operadoras) · Filtro de inteligência (configuração do Score e nomes devolvidos) · Contratação
  (forma de cobrança e preços do Score) · Margem.
- Plataforma: orçamento do centro de custo e recarga automática.
Cada tela continua chamando a rpc que já usa; o painel só junta as mudanças e salva no final.

## 3. Confirmação (ConfirmaAcao) — texto do quadro e do botão
- Agendar campanha: "{enviados} {canal} serão enviados em {data} às {hora}, pela rota {rota}. Custo previsto de
  {valor}. Até o horário você ainda pode cancelar." → "Agendar {enviados} {canal}".
- Cancelar campanha: "A campanha não será enviada. A prévia e o agendamento são descartados." → "Cancelar a campanha".
- Trocar a função de um usuário: o que passa a ver e o que deixa de ver → "Mudar para {função}".
- Tirar fornecedor do Score: "O histórico dele deixa de contar a partir de agora." → "Tirar do Score".
- Suspender ou encerrar empresa: envios param e quem perde o acesso → "Suspender a empresa".
- Emitir fatura: valor, vencimento e o e-mail de destino → "Emitir {valor}".

## 4. Somente leitura com o motivo
Todas as telas com permissão por função (Console › Equipe, Produtos e preços, Rotas, Filtro de inteligência,
Contratação; plataforma › Empresa e Faturamento). Use pode_equipe / tem_papel como hoje, mas mostre a tela
travada com a frase do papel que pode, em vez de esconder.

## 5. Tabela no celular — campos principais
Campanhas: nome, situação, data e enviados · Faturas: competência, valor e situação · Lotes: data, canal e
situação · Qualidade dos fornecedores: fornecedor, entrega no lote e alerta · Chamados: assunto, situação, data.

## 6. Score de Entrega
- Faixas na prévia, na campanha, na Economia do Score e no Console: cores do prompt 49, item 7.
- Histórico em formação: rpc score_formacao() → inicio, janela_dias, completa_em, completa. Enquanto completa =
  false, na prévia e no topo da Economia do Score, quadro tracejado: "O Score está formando o histórico ·
  {dias desde inicio}º dia de {janela_dias}". Texto: "O histórico de entrega da Mensageria começou em {inicio}.
  Até {completa_em} muitos números ainda não passaram pela Mensageria e aparecem como Sem histórico: nesta lista
  são {n} ({x}%). Eles saem normalmente se a faixa estiver marcada." Linha do tempo {inicio} → {completa_em}.
  Na Economia: "A economia cresce conforme o histórico se forma." Nunca estimar a faixa de quem não tem histórico.

## 7. Nomes (um por conceito)
- Cliente vê "Não enviados"; o Console vê "Represados". Troque nas telas do cliente (prévia, campanha, Economia
  do Score, retorno) e mantenha "Represados" no Console.
- Lista da campanha (cliente) · Lista (Console). Carga só na Cobrança e na Jornada. Nunca "mailing" nem "base".
- Preço unitário abaixo de R$ 0,10 para o cliente aparece por mil: "R$ 4,20 por mil números", "R$ 54,00 por mil
  SMS" (valor × 1000, 2 casas). Console e banco continuam com 4 casas.
- Custo unitário efetivo para o cliente também por mil.

Confira em 1440 e 390 px, claro e escuro.
```
