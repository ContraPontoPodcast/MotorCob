// "← Voltar" das telas que se abrem a partir de outra (detalhe, assistente, página de ajuda) e não estão nas abas
// da área. O destino é sempre a tela-mãe lógica, nunca o histórico do navegador: um link aberto numa aba nova
// também tem para onde voltar. O componente que desenha o link é o <Voltar /> (components/comuns/voltar.tsx);
// o PageHeading e o WorkspaceHeading já o mostram sozinhos quando a rota está aqui.
//
// Rota nova que abre "para dentro" de outra: acrescente aqui (o teste confere que a rota e o destino existem).

export type RotaPai = { to: string; rotulo: string };
export type ContextoRota = { /** Usuário da equipe MotorCX (Console). */ equipe?: boolean };

const INICIO: RotaPai = { to: '/inicio', rotulo: 'Início' };
const INTEGRACOES: RotaPai = { to: '/empresa/integracoes', rotulo: 'Integrações' };

/** Rota exata (sem query) → tela-mãe. Função quando o destino depende de quem está logado. */
export const ROTAS_PAI: Record<string, RotaPai | ((ctx: ContextoRota) => RotaPai | null)> = {
	// Extrato do cliente: aberto pela lista de Clientes, pela busca do topo e pelos alertas do Speech Analytics.
	'/cliente': { to: '/clientes', rotulo: 'Clientes' },
	// Suporte
	'/suporte/novo': { to: '/suporte', rotulo: 'Meus chamados' },
	// Documentação da API: aberta em Empresa › Integrações (tokens e módulos).
	'/docs/api': INTEGRACOES,
	'/documentacao': INTEGRACOES,
	// Ajuda e assistente: abertos de qualquer tela (ícone "?", "Ver no glossário", gaveta do Assistente).
	'/ajuda/o-que-significa': INICIO,
	'/assistente/minhas': INICIO,
	// Assistente de implantação: a equipe abre pelo Console › Implantação; o cliente, pelos Primeiros passos do Início.
	'/implantacao': ctx => (ctx.equipe ? { to: '/console/implantacao', rotulo: 'Console › Implantação' } : INICIO),
	// A equipe entra na empresa pelo Console › Empresas; para o cliente, Empresa é uma área do menu.
	'/empresa': ctx => (ctx.equipe ? { to: '/console', rotulo: 'Console › Empresas' } : null),
};

/** Tela-mãe da rota, ou null quando a tela já é o topo da área (abas, menu lateral). */
export function rotaPai(pathname: string, ctx: ContextoRota = {}): RotaPai | null {
	const caminho = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
	const regra = ROTAS_PAI[caminho];
	if (!regra) return null;
	return typeof regra === 'function' ? regra(ctx) : regra;
}
