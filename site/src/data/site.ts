/** Dados fictícios fixos do site público MotorCob. */

export const heroSteps: { label: string; value: string; positive?: boolean; nowrap?: boolean }[] = [
	{ label: 'Cliente', value: '100004817' },
	{ label: 'Momento', value: 'Atraso recente' },
	{ label: 'Dia na régua', value: 'D+3' },
	{ label: 'Canal escolhido', value: 'WhatsApp' },
	{ label: 'Telefone Hot', value: '(11) 9••••-••17', nowrap: true },
	{ label: 'Resultado', value: 'CPC · vira Hot', positive: true },
];

export const listaKpis: { label: string; value: string; pct?: string; dot?: string; pctColor?: string }[] = [
	{ label: 'Carteira avaliada', value: '2.600' },
	{ label: 'Com ação', value: '1.869', pct: '71,9%', dot: '#34C759', pctColor: '#248A3D' },
	{ label: 'Fora pela esteira', value: '545', pct: '21,0%', dot: '#FF9500' },
	{ label: 'Sem contato', value: '107', pct: '4,1%', dot: '#FF3B30' },
];

export const listaLinhas: { titulo: string; legenda: string; qtd: number; cor: string }[] = [
	{ titulo: 'Com ação hoje', legenda: 'Liberados para todos os canais', qtd: 1869, cor: '#34C759' },
	{ titulo: 'Esteira sem passo no D+5', legenda: 'Regra da esteira', qtd: 324, cor: '#FF9500' },
	{ titulo: 'Esteira sem passo hoje (D+2)', legenda: 'Regra da esteira', qtd: 221, cor: '#FF9500' },
	{ titulo: 'Sem telefone válido', legenda: 'Agente virtual · Discador', qtd: 92, cor: '#FF3B30' },
];

export type PersonaSite = {
	nome: string;
	cor: string;
	maturidade: number;
	criterio: string;
	selo: string;
	ranking: { canal: string; taxa: number; pos: 'melhor' | 'segundo' | null }[];
};

export const CANAL_COR_SITE: Record<string, string> = {
	'WhatsApp': '#1F8A4C',
	'RCS': '#3B5BA9',
	'SMS': '#7A4FB0',
	'E-mail': '#A2552B',
	'Agente virtual': '#0E7C86',
	'Discador': '#475569',
};

export const personasSite: PersonaSite[] = [
	{
		nome: 'Digital nativo', cor: '#1F8A4C', maturidade: 76,
		criterio: 'idade até 32 · tem WhatsApp · 549 clientes', selo: 'Evidência firme',
		ranking: [
			{ canal: 'RCS', taxa: 29.1, pos: 'melhor' },
			{ canal: 'WhatsApp', taxa: 23.4, pos: 'segundo' },
			{ canal: 'SMS', taxa: 10.4, pos: null },
			{ canal: 'E-mail', taxa: 2.6, pos: null },
		],
	},
	{
		nome: 'Sênior (60+)', cor: '#A2552B', maturidade: 58,
		criterio: 'idade a partir de 60 · 481 clientes', selo: 'Prévia',
		ranking: [
			{ canal: 'Discador', taxa: 18.2, pos: 'melhor' },
			{ canal: 'Agente virtual', taxa: 12.9, pos: 'segundo' },
			{ canal: 'SMS', taxa: 6.1, pos: null },
			{ canal: 'WhatsApp', taxa: 4.0, pos: null },
		],
	},
	{
		nome: 'Ticket alto', cor: '#C62828', maturidade: 41,
		criterio: 'saldo acima de R$ 10 mil · 153 clientes', selo: 'Em formação',
		ranking: [
			{ canal: 'Agente virtual', taxa: 14.7, pos: 'melhor' },
			{ canal: 'Discador', taxa: 11.3, pos: 'segundo' },
			{ canal: 'WhatsApp', taxa: 9.8, pos: null },
			{ canal: 'E-mail', taxa: 1.2, pos: null },
		],
	},
];

export const agentesSite: { titulo: string; texto: string }[] = [
	{ titulo: 'Ingestão', texto: 'Lê o arquivo de cada credor, reconhece o layout e separa o que é novo, o que saiu e o que fez acordo.' },
	{ titulo: 'Contato', texto: 'Dá uma nota a cada telefone pelas evidências e escolhe o Hot. Número inválido sai sozinho.' },
	{ titulo: 'Analista', texto: 'Descobre o melhor canal de cada perfil pelo CPC por real gasto, e continua testando.' },
	{ titulo: 'Estrategista', texto: 'Propõe mudanças na régua com evidência e grau de certeza. Nada entra sem a sua aprovação.' },
];

/** Provocações: parte principal (escurece no scroll) + segunda parte (sempre #6E6E73). */
export const provocacoes: { main: string; sub?: string }[] = [
	{ main: 'Sua operação ainda começa com PROCV.' },
	{ main: 'O telefone certo existe.', sub: 'Você só não sabe qual é.' },
	{ main: 'Resultado no fim do mês é tarde demais.' },
];
