# Prompt Horizons — Workspace 11: Mensageria por produto (mesmo UX da Orquestração), painel e campanhas

Rode depois do SQL 14 (`14_mensageria_produtos.sql`) e dos prompts 6 e 10. Reorganiza a /mensageria; o que já
existe (lotes, descadastros, modelo de e-mail) passa para dentro de cada produto.

```text
Reorganize a Mensageria por produto, com o MESMO padrão visual e de navegação da Orquestração (mesmo menu
lateral, mesmas abas, mesmos cards de número, mesma tabela, mesmos botões). Não mude tabelas, views ou políticas.

1. SELETOR DE PRODUTO: /mensageria abre a escolha do produto: cards SMS (#7A4FB0), RCS (#3B5BA9), E-mail
   (#A2552B) e WhatsApp (#1F8A4C), com ícone, uma linha do que faz e "Abrir". Canais liberados vêm de
   empresa_modulos (modulo 'mensageria', coluna canais); os outros aparecem esmaecidos com "Quero conhecer" (a
   janela de interesse comercial que já existe). No topo de todas as telas da Mensageria, o produto atual fica num
   seletor (pílula com a cor do canal + seta) para trocar de produto sem voltar. Lembre o último produto usado.
2. DENTRO DE CADA PRODUTO (/mensageria/{canal}/...): abas Painel · Campanhas · Lotes do dia · Templates (só SMS e
   RCS; no E-mail, "Modelo de e-mail") · Listas · Respostas · Configurações. Lotes do dia, Descadastros e Modelo de
   e-mail são as telas que já existem, filtradas pelo canal.

3. PAINEL: período (Hoje, 7 dias, 30 dias, Mês atual, Personalizado) e origem (Todas, Lista do dia, uma campanha).
   from('mensageria_funil').select('*').eq('empresa_id', empresa).eq('canal', canal).gte('data', ini).lte('data', fim).
   Cards (tabular-nums): Carregados · Higienizados (válidos para envio) · Enviados · Entregues · Não entregues
   (+ no RCS: Fallback). Abaixo de cada card, % sobre o card anterior. Funil horizontal com as 5 etapas (barra da
   cor do canal, rótulo e número). Legenda da higienização: "Inválidos {invalidos} · Bloqueados (lista de bloqueio,
   descadastro, sem texto) {bloqueados}". Gráfico de linhas por dia: enviados, entregues, não entregues. Tabela
   por origem: Origem · Carregados · Enviados · Entregues · % entrega · Não entregues · Fallback · Respostas.
   No RCS, card "Fallback" com o texto: "Aparelhos sem RCS receberam por SMS ou WhatsApp, conforme a configuração."

4. CAMPANHAS: lista (from('mensageria_campanhas').select('*, mensageria_templates(nome),
   mensageria_centros_custo(nome)').eq('empresa_id', empresa).eq('canal', canal).order('criado_em',
   {ascending:false})): Nome · Situação (analisando "Lendo a lista" azul, aguardando_layout "Confirme o layout"
   laranja, pronta "Pronta", agendada "Agendada {data}", em_andamento "Enviando", concluida verde, cancelada
   cinza, erro vermelho com o texto de erro) · Carregados · Template · Centro de custo · Criada em. Botão "Nova
   campanha" (com enviar_mensagens). Clique abre o detalhe com o funil da campanha (mesmo do Painel, origem fixa).

5. NOVA CAMPANHA (assistente em 4 passos, na mesma página):
   a) Dados: Nome*, Template* (templates ativos do canal; no E-mail usa o modelo de e-mail), Centro de custo
      (opcional), no RCS "Se o aparelho não tiver RCS": Usar a configuração da empresa / Enviar por SMS / Enviar por
      WhatsApp / Não enviar (+ template de SMS do fallback opcional), "Rastrear links" (interruptor).
   b) Lista: arraste ou escolha o arquivo (.csv, .txt, .xlsx; até 20 MB). Texto: "Qualquer layout: o MotorCob
      identifica as colunas e você confirma." Suba em storage.from('entradas').upload(`${slug}/mensageria/
      ${crypto.randomUUID()}/${nomeSeguro}`) e DEPOIS insira a campanha com arquivo_caminho e arquivo_nome
      (situacao fica 'analisando'). Mostre "Lendo a lista…" e consulte a campanha a cada 3 s até mudar.
   c) Layout (situacao 'aguardando_layout'): "{carregados} linhas". Tabela das colunas de layout_sugerido.colunas:
      Coluna · Tipo identificado (telefone, email, cpf "CPF", data, valor, numero, texto, vazia) · % preenchida ·
      Uso: seletor (Telefone / E-mail / ID do cliente / Variável {{nome}} / Ignorar), já preenchido pela
      sugestao. Variáveis do template sem coluna ficam em vermelho. layout_sugerido.avisos em faixa amarela.
      "Confirmar layout" → rpc('confirmar_layout', {campanha, layout: {telefone, email, id_cliente, variaveis:
      {variavel: coluna}}}).
   d) Envio: prévia do template com as variáveis como etiquetas ({{nome}}), nunca com dados da lista. "Enviar
      agora" ou "Agendar" (data e hora) → rpc('agendar_campanha', {campanha, quando}). Aviso: "Os envios respeitam
      o horário do canal, o orçamento do centro de custo e as listas de bloqueio."
   Cancelar (antes de concluir): rpc('cancelar_campanha', {campanha}) com confirmação.

Sem rolagem lateral em 1440, 1024 e 390px. Foco visível; Esc fecha modais. Nunca mostre telefone ou e-mail completo.
```
