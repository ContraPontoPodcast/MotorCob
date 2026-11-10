// "← Voltar" das telas que se abrem a partir de outra (detalhe, assistente, página de ajuda) e não estão nas abas
// da área. O destino é sempre a tela-mãe lógica, nunca o histórico do navegador: um link aberto numa aba nova
// também tem para onde voltar. O componente que desenha o link é o <Voltar /> (components/comuns/voltar.tsx);
// o PageHeading e o WorkspaceHeading já o mostram sozinhos quando a rota está aqui.
//
// Rota nova que abre "para dentro" de outra: acrescente aqui (o teste confere que a rota e o destino existem).
// A chave é a rota como está no routes.ts: exata ("/suporte/novo") ou com parâmetros ("/voz/ligacoes/:id",
// "/speech-analytics/:aba?"). A rota exata ganha da com parâmetro.

import { ROTA_AGENTE, ROTA_ENTRADA_GRAVACOES, ROTA_LIGACOES, ROTA_SPEECH, ROTA_VOZ } from './rotas-voz';
import { ROTA_RP, ROTA_RP_CADASTRO, ROTA_RP_CENARIOS } from './roleplay';

export type RotaPai = { to: string; rotulo: string };
export type ContextoRota = { /** Usuário da equipe MotorCX (Console). */ equipe?: boolean; /** Query da rota ("?assunto=robos"). */ busca?: string };

const INICIO: RotaPai = { to: '/inicio', rotulo: 'Início' };
const INTEGRACOES: RotaPai = { to: '/empresa/integracoes', rotulo: 'Integrações' };
const VISAO_GERAL_VOZ: RotaPai = { to: ROTA_VOZ, rotulo: 'Visão geral do Agente Voz/CX' };
const AGENTE_DE_VOZ: RotaPai = { to: ROTA_AGENTE, rotulo: 'Agente de voz' };

/** Rota exata (sem query) → tela-mãe. Função quando o destino depende de quem está logado. */
export const ROTAS_PAI: Record<string, RotaPai | ((ctx: ContextoRota) => RotaPai | null)> = {
	// Extrato do cliente: aberto pela lista de Clientes, pela busca do topo e pelos alertas do Speech Analytics.
	'/cliente': { to: '/clientes', rotulo: 'Clientes' },
	// Suporte
	// "Pedir mais robôs" (Agente Voz/CX › Discagem, ?assunto=robos) volta para a Discagem.
	'/suporte/novo': ctx => (new URLSearchParams(ctx.busca ?? '').get('assunto') === 'robos'
		? { to: '/voz/discagem', rotulo: 'Discagem' } : { to: '/suporte', rotulo: 'Meus chamados' }),
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
	// Empresa › Contratação › Agente de voz: editar os robôs contratados (licenças) e o histórico voltam à Contratação.
	'/empresa/contratacao/robos': { to: '/empresa/contratacao', rotulo: 'Contratação' },
	'/empresa/contratacao/robos/historico': { to: '/empresa/contratacao', rotulo: 'Contratação' },
	// Cobrança › Configurações › Canais: a configuração de um canal volta para a visão geral.
	'/canais/:canal': { to: '/canais', rotulo: 'Canais' },
	// Agente Voz/CX, como o Speech Analytics: cada seção do menu da área (Agente de voz, Discagem, Ligações e Telefonia)
	// volta para a Visão geral da área, que é o topo (sem voltar).
	'/voz/agente': VISAO_GERAL_VOZ,
	'/voz/discagem': VISAO_GERAL_VOZ,
	'/voz/ligacoes': VISAO_GERAL_VOZ,
	'/voz/telefonia': VISAO_GERAL_VOZ,
	// Agente Voz/CX › Agente de voz: fluxo (editor), Confirmar identidade, testes, desempenho, personas, rascunho gerado
	// e roteiro antigo voltam à lista de fluxos.
	'/voz/agente/editor/:versao': AGENTE_DE_VOZ,
	'/voz/agente/identidade': AGENTE_DE_VOZ,
	'/voz/agente/testar': AGENTE_DE_VOZ,
	'/voz/agente/desempenho': AGENTE_DE_VOZ,
	'/voz/agente/personas': AGENTE_DE_VOZ,
	'/voz/agente/pedido/:id': AGENTE_DE_VOZ,
	'/voz/agente/roteiro': AGENTE_DE_VOZ,
	// Ligações de um lote → lotes de hoje.
	'/voz/ligacoes/:id': { to: ROTA_LIGACOES, rotulo: 'Ligações' },
	// Speech Analytics: toda aba (Qualidade, Operadores, Alertas, Recomendações, Curadoria, Buscar, Gravações e Entrada
	// de gravações) volta para a Visão geral; o envio volta para a Entrada.
	'/speech-analytics/:aba?': { to: ROTA_SPEECH, rotulo: 'Visão geral do Speech Analytics' },
	'/speech-analytics/entrada/enviar': { to: ROTA_ENTRADA_GRAVACOES, rotulo: 'Entrada de gravações' },
	// Roleplay (a aba /speech-analytics/roleplay é o Painel e volta para a Visão geral, como as outras abas): cada seção
	// volta para o Painel; o cenário, para a biblioteca; a pessoa, para o Cadastro para treino.
	'/speech-analytics/roleplay/cenarios': { to: ROTA_RP, rotulo: 'Painel do Roleplay' },
	'/speech-analytics/roleplay/cenarios/:id': { to: ROTA_RP_CENARIOS, rotulo: 'Cenários' },
	'/speech-analytics/roleplay/operadores': { to: ROTA_RP, rotulo: 'Painel do Roleplay' },
	'/speech-analytics/roleplay/operadores/:op': { to: ROTA_RP_CADASTRO, rotulo: 'Cadastro para treino' },
};

/** "/voz/ligacoes/:id" → /^\/voz\/ligacoes\/[^/]+$/ ("/x/:p?" também casa "/x"). */
function padrao(rota: string): RegExp {
	const corpo = rota.split('/').filter(Boolean).map(seg => {
		if (seg.startsWith(':')) return seg.endsWith('?') ? '(?:/[^/]+)?' : '/[^/]+';
		return '/' + seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	}).join('');
	return new RegExp(`^${corpo}$`);
}
const COM_PARAMETRO = Object.keys(ROTAS_PAI).filter(r => r.includes('/:')).map(r => [r, padrao(r)] as const);

/** Tela-mãe da rota, ou null quando a tela já é o topo da área (abas, menu lateral). */
export function rotaPai(pathname: string, ctx: ContextoRota = {}): RotaPai | null {
	const caminho = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
	const chave = Object.hasOwn(ROTAS_PAI, caminho) ? caminho : COM_PARAMETRO.find(([, re]) => re.test(caminho))?.[0];
	const regra = chave ? ROTAS_PAI[chave] : undefined;
	if (!regra) return null;
	const pai = typeof regra === 'function' ? regra(ctx) : regra;
	// "/x/:p?" também casa "/x", que é a própria tela-mãe: não volta para ela mesma.
	return pai && pai.to.split('?')[0] !== caminho ? pai : null;
}
