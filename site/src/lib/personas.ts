// Tipos e mapas de canal para a página Personas.
// Nenhuma tabela é criada aqui — os dados vêm das tabelas `personas` e `sugestoes`
// que a rotina/popula via migration (rodada pelo usuário no Supabase).

export type RankingCanal = {
	canal: string;
	taxa_cpc: number;
	tentativas: number;
	cpcs: number;
	custo_por_cpc: number;
	/** Selo de evidência: 'pouca' | 'previa' | 'firme'. */
	evidencia?: 'pouca' | 'previa' | 'firme';
	/** 0–1: quanto desta taxa vem dos dados da própria persona (resto = média da carteira). */
	peso_proprio?: number | null;
};

export type CondicaoPersona = { campo: string; valor: string };

export type FaseMaturidade = 'coletando' | 'previa' | 'definida';

export type Maturidade = {
	fase?: FaseMaturidade;
	indice?: number; // 0–100
	indice_anterior?: number | null;
	volume_pct?: number; // 0–100
	confianca?: number | null; // 0–1
	meta_tentativas?: number;
	persona_formada?: boolean;
	proximo_passo?: string | null;
};

export type Persona = {
	empresa_id: string;
	persona: string;
	nome: string;
	clientes: number;
	condicoes: CondicaoPersona[];
	ranking: RankingCanal[];
	caracteristicas: string[];
	atualizado_em: string;
	maturidade?: Maturidade;
	/** Propensão a pagamento da persona (personas.propensao). Pode não existir (SQL 48). */
	propensao?: import('@/lib/propensao').PropensaoPersona | null;
};

export type SugestaoEvidencia = Record<string, { taxa_cpc: number; tentativas: number; custo_por_cpc: number }>;

export type SugestaoDados = {
	nome: string;
	clientes: number;
	condicoes: CondicaoPersona[];
	estrategia_nome: string;
	dia: number;
	de: string;
	para: string;
	evidencia: SugestaoEvidencia;
	ganho_cpc_por_rodada: number;
};

export type Sugestao = {
	id: string;
	empresa_id: string;
	chave: string;
	texto: string;
	dados: SugestaoDados;
	status: 'pendente' | 'aprovada' | 'recusada' | 'aplicada';
	criada_em: string;
	decidida_em: string | null;
	aplicada_em: string | null;
};

/** Cores dos canais — iguais às do Desenho da Esteira. */
export const CANAL_COR: Record<string, string> = {
	whatsapp: '#1F8A4C',
	rcs: '#3B5BA9',
	sms: '#7A4FB0',
	email: '#A2552B',
	agente_voz: '#0E7C86',
	discador: '#475569',
};

/** Nome legível de cada canal. */
export const CANAL_NOME: Record<string, string> = {
	whatsapp: 'WhatsApp',
	rcs: 'RCS',
	sms: 'SMS',
	email: 'E-mail',
	agente_voz: 'Agente virtual',
	discador: 'Discador',
};

export function nomeCanal(canal: string): string {
	return CANAL_NOME[canal] ?? canal;
}

/** Rótulo legível da fase de maturidade. */
export function faseLabel(fase?: FaseMaturidade): string {
	if (fase === 'definida') return 'Definida';
	if (fase === 'previa') return 'Prévia';
	return 'Coletando dados';
}

/** Cor da fase de maturidade (hex). */
export function faseCor(fase?: FaseMaturidade): string {
	if (fase === 'definida') return '#0F4C5C';
	if (fase === 'previa') return '#e9a23b';
	return '#7a96a0';
}

/** Texto de descrição da fase. */
export function faseDescricao(fase?: FaseMaturidade): string {
	if (fase === 'definida') return 'Volume suficiente e o 1º canal à frente com folga.';
	if (fase === 'previa') return 'Já há sinal, mas ainda não é decisão firme.';
	return 'O motor está juntando tentativas. O ★/☆ ainda segue quase só a média da carteira.';
}

/** Resumo de uma persona para o popover ★/☆ da Orquestração. */
export type PersonaResumo = {
	nome: string;
	clientes: number;
	canal1: string | null;
	canal2: string | null;
	fase: FaseMaturidade;
};

/** Calcula o resumo (★ e ☆ + fase) de uma persona a partir do ranking e maturidade. */
export function resumoDePersona(p: Persona): PersonaResumo {
	const ranking = (p.ranking ?? []).filter(r => r.tentativas > 0).sort((a, b) => b.taxa_cpc - a.taxa_cpc);
	return {
		nome: p.nome,
		clientes: p.clientes,
		canal1: ranking[0]?.canal ?? null,
		canal2: ranking[1]?.canal ?? null,
		fase: p.maturidade?.fase ?? 'coletando',
	};
}
