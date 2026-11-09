// A rota define a área. Uma função só, usada na lateral de ícones, no tema e na gaveta.
// A lateral NUNCA olha a frente guardada — só a rota.

export type AreaRota =
	| 'cobranca'
	| 'jornada'
	| 'mensageria'
	| 'voz'
	| 'speech'
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
	// Endereços antigos que redirecionam para Agente Voz/CX e Speech Analytics (lib/rotas-voz.ts): já marcam a área
	// nova enquanto o redirecionamento acontece (sem piscar a Cobrança ou a Mensageria).
	if (pathname === '/discagem' || pathname.startsWith('/mensageria/voz/') || pathname.startsWith('/discagem/') || pathname === '/canais/agente-virtual' || pathname.startsWith('/canais/agente-virtual/')) return 'voz';
	if (pathname === '/gravacoes' || pathname.startsWith('/gravacoes/') || pathname === '/insights-voz' || pathname.startsWith('/envios/gravacoes-discador')) return 'speech';
	if (pathname === '/console' || pathname.startsWith('/console/')) return 'console';
	if (pathname === '/empresas' || pathname.startsWith('/empresas/')) return 'console';
	if (pathname === '/mensageria' || pathname.startsWith('/mensageria/')) return 'mensageria';
	// Agente Voz/CX e Speech Analytics: áreas próprias (antes dentro da Cobrança e da Mensageria).
	if (pathname === '/voz' || pathname.startsWith('/voz/')) return 'voz';
	if (pathname === '/speech-analytics' || pathname.startsWith('/speech-analytics/')) return 'speech';
	if (pathname === '/relatorios' || pathname.startsWith('/relatorios/')) return 'relatorios';
	if (pathname === '/jornada' || pathname.startsWith('/jornada/')) return 'jornada';
	if (pathname === '/empresa' || pathname.startsWith('/empresa/')) return 'empresa';
	if (pathname === '/suporte' || pathname.startsWith('/suporte/')) return 'suporte';
	if (
		pathname.startsWith('/conta') ||
		pathname.startsWith('/docs') ||
		pathname === '/documentacao' ||
		pathname.startsWith('/assistente') ||
		pathname === '/implantacao'
	)
		return 'workspace';
	// Cobrança (frente motorcob).
	const cobrancaPrefixes = [
		'/fila', '/clientes', '/acoes', '/envios', '/orquestracao', '/personas',
		'/clusters', '/credores', '/canais', '/mapa', '/comite', '/painel',
		'/estrategias', '/estrategia',
	];
	if (cobrancaPrefixes.some(p => pathname === p || pathname.startsWith(p + '/'))) return 'cobranca';
	// 404, /cliente e qualquer outra → nenhuma (não marca área nem troca a frente).
	return 'nenhuma';
}

/** Área de tema (cor) — workspace, relatorios, inicio, empresa, suporte, nenhuma viram neutro. */
export type AreaTema = 'cobranca' | 'jornada' | 'mensageria' | 'voz' | 'speech' | 'neutro';

export function areaTemaDeRota(pathname: string): AreaTema {
	const a = areaDaRota(pathname);
	if (a === 'cobranca') return 'cobranca';
	if (a === 'jornada') return 'jornada';
	if (a === 'mensageria') return 'mensageria';
	if (a === 'voz') return 'voz';
	if (a === 'speech') return 'speech';
	// Console usa a cor da Mensageria quando a rota é de produtos/fornecedores.
	if (CONSOLE_MENSAGEM.some(p => pathname.startsWith(p))) return 'mensageria';
	return 'neutro';
}

const AREA_LABEL: Record<AreaRota, string> = {
	cobranca: 'Cobrança',
	jornada: 'Jornada do Cliente',
	mensageria: 'Mensageria',
	voz: 'Agente Voz/CX',
	speech: 'Speech Analytics',
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
	voz: '/voz',
	speech: '/speech-analytics',
	relatorios: '/relatorios',
	console: '/console',
	empresa: '/empresa',
	suporte: '/suporte',
	inicio: '/inicio',
	workspace: '/inicio',
	nenhuma: '/inicio',
};

/** Áreas que dependem de um contrato. Agente Voz/CX vem com a Cobrança (a Discagem vale também para quem tem
 *  discador próprio; agente, ligações e telefonia mostram "não contratado" sem o módulo agente_voz). Speech Analytics
 *  é o módulo speech_analytics (Contratação, SQL 87): sem ele, a área mostra "não faz parte do plano". */
export type AreaContrato = 'cobranca' | 'jornada' | 'mensageria' | 'speech';
export function areaDoContrato(area: AreaRota): AreaContrato | null {
	if (area === 'cobranca' || area === 'voz') return 'cobranca';
	if (area === 'jornada' || area === 'mensageria' || area === 'speech') return area;
	return null;
}

/** Gravações (Speech Analytics › Gravações e o antigo /gravacoes): ouvir as ligações do agente e do discador não
 *  depende da análise. Continuam com a Cobrança, como antes do SQL 87. */
function ehGravacoes(pathname: string): boolean {
	return ['/speech-analytics/gravacoes', '/gravacoes'].some(p => pathname === p || pathname.startsWith(p + '/'));
}

/** Contrato que a rota exige (a área da rota, com a exceção das Gravações). Usado pela moldura e pelo Assistente. */
export function contratoDaRota(pathname: string): AreaContrato | null {
	const area = areaDaRota(pathname);
	if (area === 'speech' && ehGravacoes(pathname)) return 'cobranca';
	return areaDoContrato(area);
}

/** Alvo do "Avisar o Admin" de uma área fora do plano (avisar_admin aceita speech_analytics desde o SQL 87). */
export function alvoDoPedido(contrato: AreaContrato): string {
	return contrato === 'speech' ? 'speech_analytics' : contrato;
}
