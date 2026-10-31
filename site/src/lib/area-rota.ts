// A rota define a área. Uma função só, usada na lateral de ícones, no tema e na gaveta.
// A lateral NUNCA olha a frente guardada — só a rota.

export type AreaRota =
	| 'cobranca'
	| 'jornada'
	| 'mensageria'
	| 'relatorios'
	| 'console'
	| 'empresa'
	| 'suporte'
	| 'inicio'
	| 'workspace'
	| 'nenhuma';

/** Telas da Mensageria dentro do Console (continuam com a cor da Mensageria). */
const CONSOLE_MENSAGEM = [
	'/console/produtos',
	'/console/fornecedores',
	'/console/qualidade',
	'/console/filtro-inteligencia',
];

/** Determina a área ativa pela rota (pathname). */
export function areaDaRota(pathname: string): AreaRota {
	if (pathname === '/inicio') return 'inicio';
	if (pathname === '/console' || pathname.startsWith('/console/')) return 'console';
	if (pathname === '/empresas' || pathname.startsWith('/empresas/')) return 'console';
	if (pathname === '/mensageria' || pathname.startsWith('/mensageria/')) return 'mensageria';
	if (pathname === '/relatorios' || pathname.startsWith('/relatorios/')) return 'relatorios';
	if (pathname === '/jornada' || pathname.startsWith('/jornada/')) return 'jornada';
	if (pathname === '/empresa' || pathname.startsWith('/empresa/')) return 'empresa';
	if (pathname === '/suporte' || pathname.startsWith('/suporte/')) return 'suporte';
	if (
		pathname.startsWith('/conta') ||
		pathname.startsWith('/docs') ||
		pathname === '/documentacao' ||
		pathname.startsWith('/assistente')
	)
		return 'workspace';
	// Cobrança (frente motorcob).
	const cobrancaPrefixes = [
		'/fila', '/clientes', '/acoes', '/envios', '/orquestracao', '/personas',
		'/clusters', '/credores', '/canais', '/discagem', '/mapa', '/comite', '/painel',
		'/estrategias', '/estrategia',
		'/gravacoes', '/insights-voz',
	];
	if (cobrancaPrefixes.some(p => pathname === p || pathname.startsWith(p + '/'))) return 'cobranca';
	// 404, /cliente e qualquer outra → nenhuma (não marca área nem troca a frente).
	return 'nenhuma';
}

/** Área de tema (cor) — workspace, relatorios, inicio, empresa, suporte, nenhuma viram neutro. */
export type AreaTema = 'cobranca' | 'jornada' | 'mensageria' | 'neutro';

export function areaTemaDeRota(pathname: string): AreaTema {
	const a = areaDaRota(pathname);
	if (a === 'cobranca') return 'cobranca';
	if (a === 'jornada') return 'jornada';
	if (a === 'mensageria') return 'mensageria';
	// Console usa a cor da Mensageria quando a rota é de produtos/fornecedores.
	if (CONSOLE_MENSAGEM.some(p => pathname.startsWith(p))) return 'mensageria';
	return 'neutro';
}

const AREA_LABEL: Record<AreaRota, string> = {
	cobranca: 'Cobrança',
	jornada: 'Jornada do Cliente',
	mensageria: 'Mensageria',
	relatorios: 'Relatórios',
	console: 'Console MotorCX',
	empresa: 'Empresa',
	suporte: 'Suporte',
	inicio: 'Início',
	workspace: 'MotorCX',
	nenhuma: 'MotorCX',
};

export function areaLabel(pathname: string): string {
	return AREA_LABEL[areaDaRota(pathname)];
}

/** Destino padrão de cada área (para a lateral, Início, troca de área, gaveta). */
export const AREA_DESTINO: Record<AreaRota, string> = {
	cobranca: '/fila',
	jornada: '/jornada',
	mensageria: '/mensageria',
	relatorios: '/relatorios',
	console: '/console',
	empresa: '/empresa',
	suporte: '/suporte',
	inicio: '/inicio',
	workspace: '/inicio',
	nenhuma: '/inicio',
};
