# Prompt Horizons — Workspace 5/5: Console MotorCob (só a equipe)

Rode depois do 4/5. Referência visual: protótipo do Workspace, "Console MotorCob".

```text
Crie /console no Workspace, visível só para a equipe MotorCob (perfis.equipe = true; quem não é recebe /workspace).
Atendimento: qualquer pessoa da equipe responde. Empresas, Faturamento e Fornecedores: só o admin da equipe
(perfis.equipe e papel 'admin') grava; os demais da equipe só leem.
O banco garante as regras; o site só esconde. Não mude tabelas, views ou políticas.
Título "Console MotorCob" + contexto "Só a equipe MotorCob vê esta área". Abas segmentadas com rota: Empresas
(/console) · Atendimento (/console/atendimento, com contador de chamados não resolvidos) · Faturamento
(/console/faturamento) · Fornecedores (/console/fornecedores).

EMPRESAS: KPIs #F5F5F7: Empresas ativas · Em implantação · Chamados abertos · Faturas em aberto (valor).
Lista de from('empresas').select('id,nome,razao_social,cnpj,situacao,segmento,cliente_desde').order('nome') com
busca por nome, razão social ou CNPJ; colunas Empresa (nome + razão social), CNPJ formatado, Segmento, Situação
(selo), Cliente desde. Clique: torna a empresa ativa e abre /empresa.
"Nova empresa" (modal): CNPJ* (valide os dígitos verificadores; grave só os 14 dígitos), Razão social*, Nome
fantasia*, Segmento, Inscrição estadual, Inscrição municipal, CEP, Logradouro, Número, Complemento, Bairro,
Município, UF, Responsável pela venda (perfis da equipe), Situação (implantacao padrão), módulos (Orquestração
marcada e travada; Mensageria com canais SMS/E-mail/RCS/WhatsApp; Enriquecimento; API), modelo da Orquestração
(o mesmo bloco do "Alterar modelo" da aba Faturamento da empresa) e Admin da empresa (nome*, e-mail*).
Salvar, nesta ordem: insert em empresas {slug (nome fantasia sem acento, minúsculas, hífens; se já existir,
acrescente -2, -3…), nome, razao_social, cnpj, …} .select('id').single() → upsert em empresa_modulos dos módulos
marcados → upsert em planos_empresa → supabase.functions.invoke('admin-usuarios', {body: {acao: 'convidar',
email, nome, papel: 'admin', empresa_id: id}}). Mostre o progresso de cada passo; se um passo falhar, diga qual
e deixe repetir só ele. Sucesso: "Empresa criada. Convite enviado ao Admin."

ATENDIMENTO (caixa de entrada em 3 colunas; no celular, uma de cada vez)
- Filas (esquerda, com contagem): Minha fila (responsavel = eu e não resolvido) · Sem responsável (situacao
  'aberto' e responsavel nulo) · Aguardando cliente · Resolvidos (últimos 30 dias). from('chamados')
  .select('*, empresas(nome)') — a equipe vê todas as empresas.
- Lista (meio): protocolo, assunto, empresa, "há quanto tempo" e prazo: alta = 4 horas úteis, normal = 1 dia útil
  (seg–sex, 9h–18h, São Paulo) contados de criado_em; vencido = selo vermelho "atrasado", até 2 h do fim = laranja
  "vence em {x}", resolvido = verde.
- Conversa (direita): mesmos balões do cliente + notas internas em amarelo claro (#FFF8E1, borda #FFE08A, "nota
  interna · o cliente não vê"). Resposta com segmentado "Responder ao cliente" (tipo 'equipe') / "Nota interna"
  (tipo 'nota'); respostas prontas (select): "Reenvie o arquivo, por favor, e nos avise quando subir." · "Ajustamos
  o mapeamento. Pode reenviar a carga?" · "Encaminhamos ao time técnico. Retornamos em até 4 horas úteis.";
  anexos como no cliente; ao enviar, escolher a situação: Enviar e aguardar cliente (aguardando_cliente) · Enviar e
  manter em atendimento (em_atendimento) · Enviar e resolver (resolvido) → update em chamados {situacao,
  responsavel: eu}. Botão "Assumir" quando sem responsável. Ficha da empresa abaixo: nome, modelo da Orquestração,
  chamados nos últimos 90 dias.

FATURAMENTO (competência = mês anterior, com seletor de mês). Fluxo: gerar rascunhos → revisar ajustes → emitir.
- Passos no topo (1 Medir · 2 Gerar rascunhos · 3 Revisar ajustes · 4 Emitir), o atual em destaque.
- Botão "Gerar rascunhos de {mês}" → rpc('gerar_rascunhos', {competencia}) (cria só para quem tem plano e ainda
  não tem fatura; o cliente NÃO vê rascunho). Mês corrente não fecha ("Só dá para fechar mês que já terminou.").
- Tabela de from('faturas_painel').select('*, empresas(nome), fatura_itens(*), fatura_ajustes(*)')
  .eq('competencia', mês): Empresa · Orquestração (valor do item + "por contrato · 14.230 × R$ 0,35" ou "mensalidade
  fixa") · Mensageria · Ajustes (ajustes_total, com sinal) · Total (valor_total) · Vencimento · Situação
  (situacao_atual: rascunho "Rascunho" cinza, aberta "Em aberto" laranja, vencida "Vencida" vermelho, paga "Paga"
  verde, cancelada cinza) · "Abrir". Empresas com plano e sem fatura aparecem como "Prévia" (rpc previa_fatura).
- Abrir (rascunho): itens + ajustes; formulário "Novo ajuste": Tipo (desconto "Desconto", credito "Crédito",
  cobranca_extra "Cobrança extra"), Valor (R$), Motivo* (aparece na fatura do cliente) → rpc('ajustar_fatura',
  {fatura, tipo, valor, motivo}) devolve o total novo; cada ajuste com "Remover" → rpc('remover_ajuste', {ajuste}).
  Botões "Emitir fatura" (confirmação: "O cliente passa a ver esta fatura.") → rpc('emitir_fatura', {fatura}) e
  "Cancelar rascunho" (update situacao 'cancelada'). Botão no topo "Emitir todos os rascunhos" (um rpc por fatura).
- Abrir (emitida): itens e ajustes só leitura; atualizar situacao (paga, cancelada), paga_em, id_externo,
  link_boleto e link_nota_fiscal (começam com https://). Valor, itens e ajustes não mudam depois de emitida.
- Nota: "Boleto e nota fiscal são emitidos na ferramenta de cobrança; cole aqui o link e o código."

FORNECEDORES
- Tabela de from('mensageria_fornecedores').select('*').order('nome'): Fornecedor, Canais (pílulas), Credencial
  (segredo_ref preenchido → selo verde "configurado", vazio → laranja "falta credencial"), Situação (ativo).
  Editar: nome, canais, ativo e segredo_ref (o NOME do segredo no cofre do servidor, ex.: "sms/zenvia"). Aviso fixo:
  "Nunca cole a senha ou a chave do fornecedor aqui. Ela fica no cofre de segredos do servidor."
- Rotas de from('mensageria_rotas').select('*, empresas(nome)'): Para (empresa ou "Padrão (todas as empresas)"),
  Canal, Prioridade (1 = principal, 2+ = reserva), Fornecedor, Custo unitário, Ativa. "Nova rota" (modal: empresa
  opcional, canal, prioridade, fornecedor só entre os que têm o canal, custo). Erro de prioridade repetida:
  "Já existe uma rota com essa prioridade para este canal."

Valores em reais. Sem rolagem lateral em 1440, 1024 e 390px. Foco visível; Esc fecha modais.
```
