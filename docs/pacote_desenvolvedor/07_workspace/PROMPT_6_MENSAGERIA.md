# Prompt Horizons — Workspace 6/6: Mensageria (lotes do dia, descadastros, modelo de e-mail)

Rode depois do SQL 7 (`07_mensageria_envios.sql`) e do 5/5. Referência visual: protótipo do Workspace, Mensageria.

```text
Crie /mensageria no Workspace (mesma barra do topo; o link "Mensageria" só aparece com o módulo mensageria
ativo). Empresa = empresa ativa. O MotorCob monta os lotes sozinho a partir da Lista do dia e envia dentro do
horário do canal: o site NÃO envia nada, só acompanha e decide (aprovar, pausar, retomar, cancelar). Nunca mostre
telefone ou e-mail completo: o banco só tem o destino mascarado. Não mude tabelas, views ou políticas.

FAIXA DE MODO (topo de todas as abas): from('mensageria_config').select('*').eq('empresa_id', empresa)
.maybeSingle(). Sem linha ou modo 'simulado': faixa #FFF8E1, borda #FFE08A, ícone FlaskConical, "Simulação: nenhuma
mensagem sai de verdade e nada é cobrado. Os resultados são de teste." Modo 'real': selo verde "Envio real".

ABAS (segmentado com rota): Hoje (/mensageria) · Lotes (/mensageria/lotes) · Descadastros
(/mensageria/descadastros) · Modelo de e-mail (/mensageria/email) · Configurações (/mensageria/config).

HOJE: from('mensageria_lotes').select('*').eq('empresa_id', empresa).eq('data', hoje em São Paulo). Um card por
lote: pílula do canal (sms SMS #7A4FB0, email E-mail #A2552B), nome do credor se houver, selo da situação
(aguardando_aprovacao "Aguardando aprovação" laranja · agendado "Agendado" cinza · enviando "Enviando" azul #0A60D0 ·
pausado "Pausado" cinza · concluido "Concluído" verde · cancelado "Cancelado" vermelho), "Janela {janela_inicio}–
{janela_fim}". Números (tabular-nums): Total · Enviadas · Entregues · Falhas · Descadastros · Bloqueadas; barra 6px
de progresso = (enviadas + bloqueadas) / total. motivo (se houver) em 13px #6E6E73.
Ações (só com enviar_mensagens; demais veem sem botões): aguardando_aprovacao → "Aprovar envio" (principal) e
"Cancelar"; agendado → "Pausar" e "Cancelar" + "Sai a partir das {janela_inicio}" se ainda for antes; enviando →
"Pausar"; pausado → "Retomar" e "Cancelar". Chamada: supabase.rpc('mudar_lote', {lote: id, acao: 'aprovar' |
'pausar' | 'retomar' | 'cancelar'}). Cancelar pede confirmação na própria tela ("As mensagens que ainda não saíram
não serão enviadas."). Erro do banco em texto ("não dá para aprovar um lote concluido" etc.). Atualize a cada 30 s
com a aba visível. Sem lote: "Nenhum lote hoje. Os lotes nascem da Lista do dia, por volta das 6h."

LOTES: histórico (data desc, 30 por página) com filtros canal e situação; mesma linha resumida do card. Clique →
/mensageria/lotes/{id}: cabeçalho do lote + mensagens de from('mensageria_mensagens').select('id_cliente,
destino_mascara, situacao, motivo, fornecedor, tentativas, enviado_em').eq('lote_id', id).order('id'), 50 por
página, filtro por situação (pendente, enviada, entregue, falhou "Falhou", descadastro "Descadastrou", bloqueada
"Bloqueada"). Colunas: ID do cliente · Destino (mascarado) · Situação · Motivo · Fornecedor · Enviado em. Botão
"Exportar CSV" com essas mesmas colunas (nunca contato completo).

DESCADASTROS: from('mensageria_descadastros').select('*').eq('empresa_id', empresa).order('criado_em',
{ascending:false}). Colunas: Destino (destino_mascara) · Canal · Origem (resposta "Respondeu SAIR", link "Link de
descadastro", manual "Manual", reclamacao "Reclamação") · Data. Botão "Descadastrar contato" (enviar_mensagens):
modal com Canal (SMS, E-mail, RCS, WhatsApp) e Telefone ou E-mail → supabase.rpc('descadastrar_destino', {empresa,
canal, destino}). Sucesso: "Pronto. Esse contato não recebe mais mensagens deste canal." O valor digitado não fica
guardado no site (limpe o campo).

MODELO DE E-MAIL (editar com editar_canais): from('mensageria_modelos_email').select('*').eq('empresa_id', empresa)
.maybeSingle(). Campos: Nome do remetente* (2 a 60), Assunto* (3 a 120), Texto* (10 a 5.000). Variável permitida
(botão que insere no cursor): {empresa} (nome da sua empresa). Nada de nome, CPF ou valor do cliente. Prévia ao lado, no
visual de um e-mail, com o rodapé fixo "Para não receber mais estes e-mails, clique aqui." (o MotorCob coloca o
link). Salvar = upsert (onConflict 'empresa_id'). Sem modelo, os lotes de e-mail ficam bloqueados ("sem modelo de
e-mail"): mostre esse aviso no topo da aba Hoje quando faltar.

CONFIGURAÇÕES: interruptor "Aprovar cada lote antes do envio" (padrão ligado) → rpc('definir_aprovacao_lotes',
{empresa, aprovar}); legenda "Desligado, o lote do dia sai sozinho no horário do canal." Horário de cada canal
(janela_inicio–janela_fim e sábado de canais_empresa) só leitura, com link "Alterar em Canais e frases". Domingo
nunca envia.

EQUIPE MOTORCOB (só admin da equipe), em Empresa › Módulos, no card Mensageria: segmentado "Simulação" / "Envio
real" → upsert mensageria_config {empresa_id, modo} (onConflict 'empresa_id'). Ao escolher "Envio real", confirme:
"Só ligue quando o fornecedor da rota estiver integrado. Envio real entra no consumo e na fatura."

Sem rolagem lateral em 1440, 1024 e 390px. Foco visível; Esc fecha modais.
```
