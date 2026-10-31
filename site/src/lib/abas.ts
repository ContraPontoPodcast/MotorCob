import type { LucideIcon } from 'lucide-react';
import {
	ClipboardList, Wallet, Activity, FileUp, Route, UsersRound, Landmark,
	MessageCircle, Map, ShieldCheck, ChartNoAxesCombined, Megaphone,
	List, FileText, Settings, Gauge, Radar,
	Building, Users, Plug, Receipt, ScrollText,
	HeartPulse, Mail, TrendingUp, Filter,
	CircleDollarSign, MessagesSquare, Phone,
} from 'lucide-react';
import type { AreaRota } from './area-rota';
import { PERM } from './permissoes';

export type Aba = {
	nome: string;
	to: string;
	icon: LucideIcon;
	perm?: string;
	/** Contador dinâmico: 'atendimento' (vermelho) ou 'implantacao' (azul). */
	badge?: 'atendimento' | 'implantacao';
	badgeTone?: 'red' | 'blue';
	/** Link externo (Relatórios ↗). */
	externo?: boolean;
	/** Só a rota exata ativa a aba (ex.: Empresa › Visão geral em /empresa não fica ativa em /empresa/integracoes). */
	exato?: boolean;
	/** Rotas adicionais que ativam esta aba (além do prefixo de `to`). */
	match?: string[];
	/** Não mostra no WhatsApp (ex: Lotes). */
	excetoCanal?: string[];
	/** Query params que, presentes na URL, DESATIVAM esta aba (ex: Canais x Frases). */
	excludeQuery?: Record<string, string>;
	/** Só para a equipe com uma destas permissões do Console (ex.: Empresa › Contratação). */
	permConsole?: string[];
	/** Só aparece com esta área contratada (ex.: Relatórios › Cobrança). */
	requerArea?: 'cobranca' | 'jornada' | 'mensageria';
};

export type GrupoAbas = {
	rotulo?: string;
	abas: Aba[];
};

export type AreaAbas = {
	area: AreaRota;
	grupos: GrupoAbas[];
};

/** Substitui {c} pelo canal atual nas rotas da Mensageria. */
export function rotaCanal(rota: string, canal: string): string {
	return rota.replace('{c}', canal);
}

/** Todas as abas por área. A ativa vem da rota atual. */
export const ABAS: Partial<Record<AreaRota, AreaAbas>> = {
	cobranca: {
		area: 'cobranca',
		grupos: [
			{
				abas: [
					{ nome: 'Lista do dia', to: '/fila', icon: ClipboardList },
					{ nome: 'Clientes', to: '/clientes', icon: Wallet, perm: PERM.verClientes },
					{ nome: 'Ações', to: '/acoes', icon: Activity },
					{ nome: 'Cargas', to: '/envios', icon: FileUp, perm: PERM.enviarArquivos },
				],
			},
			{
				rotulo: 'Estratégia',
				abas: [
					{ nome: 'Orquestração', to: '/orquestracao', icon: Route },
					{ nome: 'Personas', to: '/personas', icon: UsersRound, perm: PERM.verClientes },
					{ nome: 'Frases', to: '/canais?secao=frases', icon: MessageCircle, perm: PERM.editarCanais },
				{ nome: 'Discagem', to: '/discagem', icon: Phone },
				],
			},
			{
				rotulo: 'Resultados',
				abas: [
					{ nome: 'Painel', to: '/painel', icon: ChartNoAxesCombined, perm: PERM.verPainel },
					{ nome: 'Mapa da esteira', to: '/mapa', icon: Map },
					{ nome: 'Comitê', to: '/comite', icon: ShieldCheck, perm: PERM.baixarComite },
				],
			},
			{
				rotulo: 'Configurações',
				abas: [
					{ nome: 'Carteiras', to: '/credores', icon: Landmark, match: ['/credores/'] },
					{ nome: 'Canais', to: '/canais', icon: Settings, perm: PERM.editarCanais, excludeQuery: { secao: 'frases' } },
				],
			},
		],
	},
	jornada: {
		area: 'jornada',
		grupos: [
			{
				abas: [
					{ nome: 'Visão geral', to: '/jornada', icon: Map, exato: true },
					{ nome: 'Lista do dia', to: '/jornada/lista', icon: ClipboardList },
					{ nome: 'Clientes', to: '/jornada/clientes', icon: UsersRound, perm: PERM.verClientes },
					{ nome: 'Cargas', to: '/jornada/cargas', icon: FileUp, perm: PERM.enviarArquivos },
				],
			},
			{
				rotulo: 'Estratégia',
				abas: [
					{ nome: 'Momentos e fases', to: '/jornada/momentos', icon: Route },
					{ nome: 'Mensagens', to: '/jornada/mensagens', icon: MessageCircle },
					{ nome: 'Carteiras', to: '/jornada/carteiras', icon: Landmark },
				],
			},
			{
				// Ações da Jornada moram aqui (tabela "Ações por canal"): a Jornada não tem aba Ações (Onda 3).
				rotulo: 'Resultados',
				abas: [
					{ nome: 'Painel', to: '/jornada/painel', icon: ChartNoAxesCombined, perm: PERM.verPainel },
				],
			},
		],
	},
	mensageria: {
		area: 'mensageria',
		grupos: [
			{
				abas: [
					{ nome: 'Campanhas', to: '/mensageria/{c}/campanhas', icon: Megaphone, match: ['/mensageria/{c}/campanhas/'] },
					{ nome: 'Lotes', to: '/mensageria/{c}/lotes', icon: ClipboardList, match: ['/mensageria/{c}/lotes/'], excetoCanal: ['whatsapp'] },
				],
			},
			{
				rotulo: 'Respostas',
				abas: [
					{ nome: 'Caixa', to: '/mensageria/atendimento', icon: MessageCircle },
					{ nome: 'Radar', to: '/mensageria/radar', icon: Radar },
				],
			},
			{
				abas: [
					{ nome: 'Templates', to: '/mensageria/{c}/templates', icon: FileText },
					{ nome: 'Listas', to: '/mensageria/{c}/listas', icon: List },
				],
			},
			{
				rotulo: 'Resultados',
				abas: [
					{ nome: 'Painel do canal', to: '/mensageria/{c}', icon: ChartNoAxesCombined, exato: true },
					{ nome: 'Score', to: '/mensageria/{c}/score', icon: Gauge },
				],
			},
			{
				rotulo: 'Configurações',
				abas: [
					{ nome: 'Do canal', to: '/mensageria/{c}/config', icon: Settings },
					{ nome: 'Atendimento', to: '/mensageria/config/atendimento', icon: Settings },
				],
			},
		],
	},
	relatorios: {
		area: 'relatorios',
		grupos: [
			{
				abas: [
					{ nome: 'Cobrança', to: '/relatorios?produto=orquestracao', icon: CircleDollarSign, requerArea: 'cobranca' },
					{ nome: 'Jornada', to: '/relatorios?produto=jornada', icon: Route, requerArea: 'jornada' },
					{ nome: 'Mensageria', to: '/relatorios?produto=mensageria', icon: MessagesSquare, requerArea: 'mensageria' },
					{ nome: 'Meus arquivos', to: '/relatorios?exportacao=1', icon: FileText },
				],
			},
		],
	},
	empresa: {
		area: 'empresa',
		grupos: [
			{
				abas: [
					{ nome: 'Visão geral', to: '/empresa', icon: Building, exato: true },
					{ nome: 'Contatos', to: '/empresa/contatos', icon: MessageCircle },
					{ nome: 'Pessoas e perfis', to: '/empresa/pessoas', icon: Users },
					{ nome: 'Integrações', to: '/empresa/integracoes', icon: Plug, match: ['/empresa/modulos'] },
					{ nome: 'Faturas', to: '/empresa/faturamento', icon: Receipt, perm: PERM.verFaturamento },
					{ nome: 'Contratação', to: '/empresa/contratacao', icon: Receipt, permConsole: ['editar_contratacao', 'editar_precos'] },
					{ nome: 'Auditoria', to: '/empresa/auditoria', icon: ScrollText, perm: PERM.verAuditoria },
					{ nome: 'Privacidade e gravações', to: '/empresa/privacidade', icon: ShieldCheck },
				],
			},
		],
	},
	console: {
		area: 'console',
		grupos: [
			{
				rotulo: 'Clientes',
				abas: [
					{ nome: 'Empresas', to: '/console', icon: Building, match: ['/empresas'], exato: true },
					{ nome: 'Saúde', to: '/console/saude', icon: HeartPulse },
					{ nome: 'Implantação', to: '/console/implantacao', icon: Route, badge: 'implantacao', badgeTone: 'blue' },
					{ nome: 'Carteiras', to: '/console/carteiras', icon: UsersRound },
					{ nome: 'Contatos do site', to: '/console/contatos-site', icon: Mail },
					{ nome: 'Integrações', to: '/console/integracoes', icon: Plug },
				],
			},
			{
				rotulo: 'Suporte',
				abas: [
					{ nome: 'Atendimento', to: '/console/atendimento', icon: MessageCircle, badge: 'atendimento', badgeTone: 'red' },
					{ nome: 'Assistente', to: '/console/assistente', icon: ChartNoAxesCombined },
				],
			},
			{
				rotulo: 'Financeiro',
				abas: [
					{ nome: 'Faturamento', to: '/console/faturamento', icon: Receipt },
					{ nome: 'Margem', to: '/console/margem', icon: TrendingUp },
				],
			},
			{
				rotulo: 'Mensageria',
				abas: [
					{ nome: 'Produtos e preços', to: '/console/produtos', icon: Megaphone },
					{ nome: 'Fornecedores e rotas', to: '/console/fornecedores', icon: Landmark },
					{ nome: 'Qualidade', to: '/console/qualidade', icon: Gauge },
					{ nome: 'Filtro de inteligência', to: '/console/filtro-inteligencia', icon: Filter },
				],
			},
			{
				rotulo: 'Administração',
				abas: [
					{ nome: 'Equipe', to: '/console/equipe', icon: Users },
					{ nome: 'Auditoria', to: '/empresa/auditoria', icon: ScrollText },
				],
			},
			{
				rotulo: 'Sistema',
				abas: [
					{ nome: 'E-mails', to: '/console/emails', icon: Mail },
				],
			},
		],
	},
};

/** Verifica se uma aba está ativa dado o pathname atual. */
export function abaAtiva(aba: Aba, pathname: string, canal: string, search = ''): boolean {
	const to = rotaCanal(aba.to, canal);
	// Remove query string para comparação.
	const path = pathname.split('?')[0];
	const toPath = to.split('?')[0];
	const toQuery = new URLSearchParams(to.split('?')[1] ?? '');
	const locQuery = new URLSearchParams(search);
	// Query params do próprio `to` (ex: ?secao=frases) são exigidos.
	for (const [k, v] of toQuery) {
		if (locQuery.get(k) !== v) return false;
	}
	// excludeQuery: se presente na URL, desativa esta aba.
	if (aba.excludeQuery) {
		for (const [k, v] of Object.entries(aba.excludeQuery)) {
			if (locQuery.get(k) === v) return false;
		}
	}
	if (path === toPath) return true;
	// Match por rotas adicionais.
	for (const m of aba.match ?? []) {
		const mm = rotaCanal(m, canal);
		if (path.startsWith(mm)) return true;
	}
	// Match por prefixo (ex: /credores/... ativa Carteiras), salvo aba exata.
	if (!aba.exato && toPath !== '/' && path.startsWith(toPath + '/')) return true;
	return false;
}
