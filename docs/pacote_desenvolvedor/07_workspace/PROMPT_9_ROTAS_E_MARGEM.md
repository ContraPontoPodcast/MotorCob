# Prompt Horizons — Workspace 9: rotas por % e por operadora, custos e margem (%MC)

Rode depois do SQL 13 (`13_rotas_margem.sql`). Substitui o bloco "Rotas" de Console › Fornecedores (prompt 5).
Só o Master vê custos e margem; o Atendimento vê os planos sem custo.

```text
Console MotorCob (só admin da equipe): Fornecedores ganha abas e o Console ganha a aba "Margem". Não mude tabelas,
views ou políticas. Abas de Fornecedores (mesmo componente de abas do site, texto #1D1D1F): Fornecedores · Planos
de rota · Custos. Abas do Console: ... · Fornecedores · Margem (/console/margem).

FORNECEDORES: como hoje, mais o interruptor "Consulta operadora" (coluna consulta_operadora; só um ligado; texto
"Fornecedor que valida o número e a operadora antes do SMS").

PLANOS DE ROTA: from('mensageria_planos_rota').select('*, mensageria_plano_fornecedores(*)').order('canal')
.order('nome'). Cards por canal (SMS, E-mail, RCS, WhatsApp); cada plano: nome, selo "Padrão" se padrao, descrição,
barra horizontal empilhada com o % de cada fornecedor (cor fixa por fornecedor; 0% aparece como "reserva" em cinza)
e, no SMS, uma barra por operadora que tiver linha própria (Vivo, Claro, TIM, Oi, Outras) + "Demais operadoras".
"Empresas usando": contagem em mensageria_rota_empresa. Botões: Editar · Duplicar · Tornar padrão · Desativar.
EDITOR (modal): Nome*, Canal (fixo depois de criado), Descrição, "Padrão do canal" (interruptor). Grupos de rota:
"Todas as operadoras" (obrigatório) e, só no SMS, "Adicionar rota por operadora" (escolhe Vivo/Claro/TIM/Oi/Outras).
Em cada grupo: linhas Fornecedor (só os que têm o canal) · % do tráfego (slider + campo, passo 1) · Ordem de
reserva (1 a 10). Soma do grupo em tempo real: "Soma: 100%" verde, senão vermelho e Salvar desabilitado.
Salvar: supabase.rpc('salvar_plano_rota', {plano: id ou null, nome, canal, itens: [{fornecedor, percentual,
ordem_reserva, operadora (null em "Todas")}], padrao, descricao}). Ativar/desativar: rpc('ativar_plano_rota',
{plano, ativo}). Erro do banco em texto. Legenda fixa: "0% = só reserva: entra quando os outros caem."
ROTA DE CADA EMPRESA: em Console › Empresas › (empresa) e em Empresa › Módulos › Mensageria (só Master): para cada
canal liberado, seletor "Plano de rota" com "Padrão ({nome do padrão})" + planos ativos do canal →
rpc('definir_rota_empresa', {empresa, canal, plano: id ou null}).

CUSTOS: from('mensageria_custos').select('*').order('fornecedor').order('item').order('vigente_desde',
{ascending:false}). Tabela Fornecedor × Item (sms "SMS", sms_resposta "Resposta de SMS", consulta_operadora
"Consulta de operadora", email "E-mail", rcs_basic, rcs_single, rcs_conversacional "RCS Conversacional (sessão)",
whatsapp_*): custo vigente (o mais recente com vigente_desde ≤ hoje) e "desde {data}"; "Histórico". "Novo custo"
(modal: fornecedor, item, custo R$ até 5 casas, vale a partir de) → insert em mensageria_custos. Não edita custo
antigo: cria vigência nova. Aviso: "Custos são confidenciais: só o Master vê."

MARGEM (/console/margem): filtros Mês (padrão: atual) e Modo (Real | Simulado, padrão Real; Simulado mostra faixa
amarela "Números de simulação"). Parâmetros no topo (editar abre modal; update em parametros_margem id 1):
"Impostos sobre a receita {impostos_pct}%", "Meta de MC {mc_meta_pct}%", "Mínimo {mc_minimo_pct}%".
Dados: supabase.rpc('margem_mensageria', {competencia: 'AAAA-MM-01', modo}).
KPIs (cards #F5F5F7): Receita · Custo · MC (R$) · %MC geral (soma MC / soma receita) · Clientes abaixo do mínimo.
Tabela (uma linha por empresa e canal): Empresa · Canal (pílula) · Plano (+ "próprio" se plano_proprio) · Envios ·
Respostas (SMS) · Receita · Custo · MC · %MC com selo por situacao (ok verde · abaixo_meta laranja · abaixo_minimo
vermelho · sem_preco cinza "Sem preço" · sem_receita cinza) · aviso "⚠ {sem_custo} sem custo cadastrado" se > 0.
Ordenação padrão: %MC crescente (piores primeiro). Clique na linha → painel lateral:
- receita_itens e custo_itens por item (quantidade, receita, custo); fornecedores (barra com a fatia de cada um,
  quantidade e custo); operadoras (SMS: Vivo/Claro/TIM/Oi/Outras com quantidade e custo).
- "Simular outro plano": seletor com os planos ativos do canal → rpc('simular_plano', {empresa, canal, plano,
  competencia, modo}) e mostra "%MC hoje {mc_atual_pct}% → com este plano {mc_simulado_pct}%" e a diferença em R$
  (custo_atual − custo_simulado); se fornecedores_sem_custo vier, aviso "Sem custo cadastrado: {lista}".
  Botão "Usar este plano para a empresa" → definir_rota_empresa (confirmação: "Vale para os próximos envios.").
Exportar CSV da tabela. Valores em reais; % com 1 casa. Sem rolagem lateral em 1440, 1024 e 390px.
```
