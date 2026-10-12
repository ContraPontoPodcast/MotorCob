# Prompt Horizons — Workspace 12: templates de SMS e RCS, listas de bloqueio e favoritos, centro de custo

Rode depois do prompt 11. As abas Templates, Listas e Configurações de cada produto da Mensageria.

```text
Telas dentro de /mensageria/{canal}. Não mude tabelas, views ou políticas. Quem edita: permissão editar_canais
(os outros veem sem botões).

1. TEMPLATES (SMS e RCS): from('mensageria_templates').select('*').eq('empresa_id', empresa).eq('canal', canal)
   .neq('situacao','arquivado').order('nome'). Lista: Nome · (RCS) Categoria · Tipo de mídia · Variáveis (pílulas) ·
   Atualizado em. Botões: Novo template · Editar · Duplicar · Arquivar (update situacao 'arquivado').
   Variáveis: botão "Inserir variável" pede o nome (letras, números e _) e insere {{nome}} no cursor. Erros do
   banco em texto. Salvar = insert/update em mensageria_templates {empresa_id, canal, nome, categoria, tipo_midia,
   conteudo, rastrear_links, situacao:'ativo'} (o banco calcula as variáveis).
   SMS: campo Texto com contador "{n}/160 sem as variáveis" e o aviso "Depois de preencher as variáveis, o SMS
   acima de 160 caracteres não é enviado." conteudo = {texto}. Prévia num balão de SMS.
   RCS: Categoria (segmentado) Autenticação / Transacional / Marketing → 'autenticacao' | 'transacional' |
   'marketing'. Tipo de mídia (segmentado) com o formulário de cada um:
   - Simples: Texto → {texto}. Até 160 caracteres "RCS Basic"; acima "RCS Single".
   - Botões: Texto + 1 a 4 botões {tipo: 'url' "Abrir link" | 'resposta' "Resposta rápida" | 'ligar' "Ligar",
     rotulo (até 25), valor (link, texto ou telefone)} → {texto, botoes}.
   - Arquivo: Texto opcional + arquivo (PDF ou imagem até 10 MB) enviado para storage.from('entradas')
     .upload(`${slug}/midia/${crypto.randomUUID()}/${nome}`) → {texto, arquivo: {caminho, nome}}.
   - Rich card: Imagem (mesmo upload), Título*, Descrição, botões (como acima) → {card: {titulo, descricao,
     midia, botoes}}.
   - Carrossel: 2 a 10 cards (mesmo formulário do rich card, com reordenar) → {cards: [...]}.
   Prévia ao lado num celular (balão, card ou carrossel deslizável). Selo "RCS Basic" ou "RCS Single".
   "Rastrear links" (interruptor) com a legenda "Os links viram endereços curtos do MotorCob para saber quem clicou."

2. LISTAS (em todos os produtos): abas Bloqueio · Favoritos. from('mensageria_listas_contato').select('*')
   .eq('empresa_id', empresa).eq('tipo', aba).order('criado_em', {ascending:false}), 50 por página.
   Colunas: Destino (máscara) · Canal (todos "Todos os canais") · Motivo · Incluído em · Remover
   (rpc('remover_lista_contato', {empresa, tipo, canal, destino_hash})).
   "Adicionar": modal com Canal (Todos, SMS, E-mail, RCS, WhatsApp), Motivo (até 120), e colar telefones ou
   e-mails (um por linha) OU escolher um CSV (use só a primeira coluna). Envie em blocos de 5.000 por
   rpc('adicionar_lista_contato', {empresa, tipo, canal, destinos, motivo}) e mostre "{n} incluídos". Limpe os
   campos depois. Textos: Bloqueio "Suspeitos e números que nunca devem receber mensagem." · Favoritos "Passam
   direto pela validação de formato e de operadora (descadastro e bloqueio continuam valendo). Use para números
   da sua equipe e de teste."

3. CONFIGURAÇÕES (em cada produto):
   - Centros de custo: from('mensageria_centros_custo').select('*').eq('empresa_id', empresa).order('nome').
     Card por centro: Nome · Orçamento do mês (R$, vazio = sem limite) · barra do gasto (rpc('orcamento_centro',
     {centro: id}) → gasto, restante, alerta) em verde, laranja com alerta, vermelho sem saldo · "Ao acabar o
     orçamento": Bloquear envios / Enviar mesmo assim · Alerta em {alerta_pct}%. Novo/Editar = insert/update em
     mensageria_centros_custo. Legenda: "Gasto estimado pelos preços do seu contrato."
   - Lista do dia: "Centro de custo da Lista do dia" (seletor) e, no RCS, "Se o aparelho não tiver RCS": Enviar
     por SMS / Enviar por WhatsApp / Não enviar + "Template do SMS de fallback" (templates de SMS; vazio = o texto
     do RCS, se couber em 160) → rpc('configurar_mensageria', {empresa, centro_custo, rcs_fallback,
     rcs_fallback_template}).
   - RCS: "Agente RCS" (só leitura para o cliente; a equipe muda em Empresa › Módulos).

Sem rolagem lateral em 1440, 1024 e 390px. Foco visível; Esc fecha modais. Nunca mostre telefone ou e-mail completo.
```
