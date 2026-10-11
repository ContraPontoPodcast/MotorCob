# Prompt Horizons — Workspace 2/5: Empresa (cadastro, contatos, membros, módulos, faturamento)

Rode depois do 1/5. Referência visual: protótipo do Workspace, aba Empresa.

```text
Crie /empresa no Workspace (mesma barra do topo do Workspace). Empresa = a empresa ativa. Não mude tabelas,
views ou políticas. Equipe que edita = admin da equipe MotorCob (perfis.equipe e papel 'admin'); o banco recusa
os demais, então só mostre botões de edição a quem pode.

CABEÇALHO: nome fantasia (28px 700), abaixo "{segmento} · CNPJ {00.000.000/0000-00} · " + selo da situação
(implantacao "Em implantação" laranja, ativa "Ativa" verde, suspensa "Suspensa" vermelho, encerrada cinza).
Equipe: botão "Editar empresa". Abas (controle segmentado, cada uma com rota): Visão geral (/empresa) · Contatos
(/empresa/contatos) · Membros (/empresa/membros) · Módulos (/empresa/modulos) · Faturamento (/empresa/faturamento,
só com ver_faturamento).

VISÃO GERAL: ficha em 2 colunas (rótulo 12px #6E6E73, valor 15px): Razão social, Nome fantasia, CNPJ, Inscrição
estadual, Inscrição municipal, Segmento, Endereço (logradouro, número, complemento, bairro, município/UF, CEP
00000-000), Cliente desde, Responsável pela venda e Gerente da conta (nome do perfil por vendedor_id/gerente_id).
Segmentos: assessoria "Assessoria de cobrança", banco "Banco", financeira "Financeira", fintech "Fintech", varejo
"Varejo", securitizadora "Securitizadora / FIDC", utilities_telecom "Utilities e telecom", educacao "Educação",
outro "Outro". Vazio → "—".
EDITAR (modal, só equipe): mesmos campos; CNPJ e CEP aceitam máscara mas gravam SÓ os dígitos (14 e 8);
valide o CNPJ pelos dígitos verificadores antes de salvar ("CNPJ inválido."); UF em maiúsculas, 2 letras;
inscrição estadual aceita "Isento". update em empresas com .eq('id', empresa). CNPJ repetido (erro 23505):
"Este CNPJ já está cadastrado em outra empresa."

CONTATOS (pessoas com quem a MotorCob fala; não precisam de acesso): from('empresa_contatos').select('*')
.eq('empresa_id', empresa).order('nome'). Visível e editável com gerenciar_usuarios (o banco garante). Lista:
nome + sobrenome, setor, selo do papel (operacional "Operacional", financeiro "Financeiro", legal "Jurídico",
tecnico "Técnico"), telefone, e-mail, observação em 13px cinza. Botão "Novo contato" → modal com Nome*, Sobrenome,
Setor, Papel, Telefone, E-mail, Observação (até 1000). Editar e Excluir (confirmação na própria linha).

MEMBROS: lista dos usuários da empresa (a mesma consulta da página Usuários) com avatar, nome, e-mail, perfil,
último acesso e situação; botão "Convidar membro" e "Gerenciar" levam para a página Usuários que já existe (não refaça o convite).

MÓDULOS: um card por módulo (orquestracao, mensageria, enriquecimento, api) de empresa_modulos: ativo → interruptor
ligado (só a equipe mexe; cliente vê desabilitado) e "desde {data}"; mensageria mostra os canais liberados como
pílulas (sms SMS #7A4FB0, email E-mail #A2552B, rcs RCS #3B5BA9, whatsapp WhatsApp #1F8A4C) que a equipe liga e
desliga (update canais). Equipe liga módulo novo com upsert (empresa_id, modulo, ativo, canais). Orquestração não
desliga. Cliente: texto "Para incluir um módulo, fale com o comercial." + botão "Quero conhecer" (abre chamado).

FATURAMENTO (com ver_faturamento)
- Plano: from('planos_empresa').select('*').eq('empresa_id', empresa).maybeSingle(). Sem plano: "Plano ainda não
  cadastrado." (equipe vê botão "Cadastrar modelo").
- KPIs (3 cards #F5F5F7): "Orquestração · Por contrato" ou "Orquestração · Mensalidade fixa" com o valor da linha
  orquestracao (+ orquestracao_minimo) da prévia; legenda "{n} contratos × R$ {preço}" ou "valor fixo do mês" ·
  "Mensageria · consumo até hoje" (soma das linhas que começam com "Mensageria") · "Próxima fatura estimada" (total).
  Prévia: supabase.rpc('previa_fatura', {empresa, competencia: 1º dia do mês atual}).
- "Consumo do mês": linhas de from('consumo_mes').select('*').eq('empresa_id', empresa).eq('competencia', mês):
  item contratos "Contratos", sms SMS, email E-mail, rcs_basic RCS Basic, rcs_single RCS Single, rcs_conversacional
  RCS Conversacional, whatsapp_* WhatsApp; barra 4px na cor do canal (contratos #1D1D1F) + "quantidade × preço = valor".
- Card "Modelo": "Por contrato · R$ 0,35 por contrato no mês · mínimo R$ 1.000,00" ou "Mensalidade fixa ·
  R$ 4.900,00/mês"; por contrato, explique: "Cada contrato que passou pela Lista do dia no mês conta uma vez, mesmo
  que apareça em vários dias." Linha "Mensageria: por consumo" com os preços de tarifas_mensageria. "Vencimento:
  todo dia {vencimento_dia}".
- Equipe: botão "Alterar modelo" → modal: segmentado Por contrato / Mensalidade fixa; Preço por contrato (R$) ou
  Valor fixo por mês (R$); Mínimo mensal (só por contrato, opcional); Vencimento (1 a 28). Salvar = upsert em
  planos_empresa (onConflict 'empresa_id'; mensalidade grava orquestracao_minimo 0). Aviso: "Vale a partir do próximo
  fechamento e fica na auditoria." Equipe também edita as tarifas (upsert tarifas_mensageria por item).
- Faturas: from('faturas').select('*, fatura_itens(*)').eq('empresa_id', empresa).order('competencia',
  {ascending:false}). Linha: mês por extenso, valor, selo (aberta "Em aberto" laranja, paga "Paga" verde, vencida
  "Vencida" vermelho, cancelada cinza) + "vence em …"/"paga em …", botões "Boleto" (link_boleto) e "Nota fiscal"
  (link_nota_fiscal) abrindo em nova aba (desabilitados sem link). Clique na linha abre os itens.

Valores em reais (R$ 1.234,56; preços unitários com até 3 casas). Sem rolagem lateral em 1440, 1024 e 390px.
```
