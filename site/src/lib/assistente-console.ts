// Rótulos das ações do Assistente (prompt 17) e lista de telas (rotas) para os
// campos "Tela relacionada" (respostas) e "Tela" (sugestões).
// Não muda tabelas, views ou políticas: só mapeia ids/rotas para rótulos legíveis.

/** id da ação → rótulo legível (select "Tela relacionada" das respostas). */
export const ACAO_LABEL: Record<string, string> = {
	abrir_lista_dia: 'Lista do dia',
	abrir_inicio_orquestracao: 'Início',
	abrir_painel_orquestracao: 'Painel',
	abrir_acoes: 'Ações',
	abrir_clientes: 'Clientes',
	abrir_personas: 'Personas',
	abrir_credores: 'Carteiras',
	abrir_mapa_esteira: 'Mapa da Esteira',
	abrir_orquestracao: 'Orquestração',
	abrir_comite: 'Comitê',
	abrir_enviar_arquivos: 'Enviar arquivos',
	abrir_canais_frases: 'Canais e mensagens',
	abrir_mensageria_painel: 'Mensageria · Painel',
	abrir_campanhas: 'Mensageria · Campanhas',
	abrir_lotes: 'Mensageria · Lotes do dia',
	abrir_respostas: 'Mensageria · Respostas',
	abrir_templates: 'Mensageria · Modelos',
	abrir_listas: 'Mensageria · Listas',
	abrir_config_mensageria: 'Mensageria · Configurações',
	abrir_relatorios: 'Relatórios',
	abrir_empresa: 'Empresa',
	abrir_faturamento: 'Faturamento',
	abrir_membros: 'Membros',
	abrir_modulos: 'Módulos',
	abrir_minha_conta: 'Minha conta',
	abrir_seguranca_conta: 'Segurança',
	abrir_tokens_api: 'Tokens de API',
	abrir_documentacao: 'Documentação',
	abrir_permissoes: 'Permissões',
	abrir_auditoria: 'Auditoria',
	abrir_chamado: 'Abrir chamado',
	abrir_jornada: 'Jornada · Início',
	abrir_jornada_lista: 'Jornada · Lista do dia',
	abrir_jornada_cargas: 'Jornada · Enviar arquivos',
	abrir_jornada_carteiras: 'Jornada · Carteiras',
	abrir_jornada_momentos: 'Jornada · Momentos',
	abrir_jornada_mensagens: 'Jornada · Mensagens',
	abrir_caixa_atendimento: 'Mensageria · Caixa de atendimento',
	abrir_radar: 'Mensageria · Painel do Radar',
	abrir_console_empresas: 'Console · Empresas',
	abrir_console_saude: 'Console · Saúde',
	abrir_console_implantacao: 'Console · Implantação',
	abrir_console_faturamento: 'Console · Faturamento',
	abrir_console_equipe: 'Console · Equipe',
	abrir_minhas_perguntas: 'Assistente · Minhas perguntas',
};

/** Lista ordenada de ações para o select. */
export const ACOES_OPCOES: { id: string; label: string }[] = Object.entries(ACAO_LABEL)
	.map(([id, label]) => ({ id, label }))
	.sort((a, b) => a.label.localeCompare(b.label, 'pt-BR'));

/** Lista de telas (rota → nome) para o select de sugestões. */
export const TELAS_OPCOES: { rota: string; nome: string }[] = [
	{ rota: '/inicio', nome: 'Orquestração · Início' },
	{ rota: '/fila', nome: 'Orquestração · Lista do dia' },
	{ rota: '/mapa', nome: 'Orquestração · Mapa da Esteira' },
	{ rota: '/clientes', nome: 'Orquestração · Clientes' },
	{ rota: '/envios', nome: 'Orquestração · Enviar arquivos' },
	{ rota: '/acoes', nome: 'Orquestração · Ações' },
	{ rota: '/cliente', nome: 'Orquestração · Buscar cliente' },
	{ rota: '/orquestracao', nome: 'Estratégia · Orquestração' },
	{ rota: '/orquestracao?passo=segmentos', nome: 'Estratégia · Segmentos' },
	{ rota: '/personas', nome: 'Estratégia · Personas' },
	{ rota: '/canais', nome: 'Estratégia · Canais e mensagens' },
	{ rota: '/orquestracao', nome: 'Estratégia · Estratégias' },
	{ rota: '/credores', nome: 'Estratégia · Carteiras' },
	{ rota: '/painel', nome: 'Resultados · Indicadores' },
	{ rota: '/comite', nome: 'Resultados · Comitê' },
	{ rota: '/relatorios', nome: 'Resultados · Relatórios' },
	{ rota: '/empresa', nome: 'Empresa · Dados e contatos' },
	{ rota: '/empresa/contatos', nome: 'Empresa · Contatos' },
	{ rota: '/empresa/pessoas?aba=pessoas', nome: 'Empresa · Pessoas e perfis' },
	{ rota: '/empresa/modulos', nome: 'Empresa · Módulos' },
	{ rota: '/empresa/faturamento', nome: 'Empresa · Faturas' },
	{ rota: '/conta', nome: 'Minha conta' },
	{ rota: '/conta?aba=seguranca', nome: 'Minha conta · Segurança' },
	{ rota: '/empresa/modulos', nome: 'Empresa · Módulos' },
	{ rota: '/conta?aba=notificacoes', nome: 'Minha conta · Notificações' },
	{ rota: '/suporte', nome: 'Suporte' },
	{ rota: '/docs', nome: 'Documentação' },
	{ rota: '/jornada', nome: 'Jornada · Início' },
	{ rota: '/jornada/lista', nome: 'Jornada · Lista do dia' },
	{ rota: '/jornada/clientes', nome: 'Jornada · Clientes' },
	{ rota: '/jornada/painel', nome: 'Jornada · Painel' },
	{ rota: '/jornada/cargas', nome: 'Jornada · Enviar arquivos' },
	{ rota: '/jornada/carteiras', nome: 'Jornada · Carteiras' },
	{ rota: '/jornada/momentos', nome: 'Jornada · Momentos da jornada' },
	{ rota: '/jornada/mensagens', nome: 'Jornada · Mensagens por momento' },
	{ rota: '/mensageria/atendimento', nome: 'Mensageria · Caixa de atendimento' },
	{ rota: '/mensageria/radar', nome: 'Mensageria · Painel do Radar' },
];

/** Nome legível de uma rota (tela) — usa TELAS_OPCOES e cai em telaNome se faltar. */
export function nomeTela(rota: string): string {
	const exata = TELAS_OPCOES.find(t => t.rota === rota);
	if (exata) return exata.nome;
	return rota || '—';
}

/** Detecta dado pessoal ou preço em um texto (CPF, e-mail, telefone, números longos, "R$"). */
export function temDadoPessoal(texto: string): boolean {
	const t = texto ?? '';
	// E-mail.
	if (/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/.test(t)) return true;
	// "R$" (preço).
	if (/r\$\s*\d/i.test(t)) return true;
	// CPF (11 dígitos) ou CPF formatado.
	if (/\d{3}\.?\d{3}\.?\d{3}-?\d{2}/.test(t)) return true;
	// Telefone: 10-11 dígitos com ou sem formatação (DD + número).
	if (/(?:\+?55\s?)?\(?\d{2}\)?\s?9?\d{4}-?\d{4}/.test(t)) return true;
	// Número longo (6+ dígitos seguidos) — contratos, contas, valores.
	if (/\d{6,}/.test(t)) return true;
	return false;
}
