// Propensão a pagamento — tipos, cores, texto de ajuda e leituras.
// Nenhuma tabela/view é criada aqui. Só SELECT em propensao_carteira, estado_cliente,
// personas e execucoes. Se a view/coluna não existir (SQL 48 ausente), tudo volta a
// "Coletando" sem quebrar a tela.

import { supabase, type Row } from '@/lib/supabase';
import type { ResumoExecucao } from '@/lib/execucao';

/** Texto de uma linha usado em todo lugar (com o ícone de ajuda de hoje). */
export const PROPENSAO_TEXTO =
	'Propensão a pagamento: chance de pagar em 30 dias. Pagamento = quitação ou 1ª parcela paga; acordo é promessa. Faixas A (muito alta) a E (muito baixa), com cortes refeitos aos domingos.';

/** Dica do "sem faixa". */
export const SEM_FAIXA_DICA =
	'sem faixa: carteira em Coletando ou cliente fora do cálculo (acordo em dia, liquidado, bloqueado)';

export const FAIXAS = ['A', 'B', 'C', 'D', 'E'] as const;
export type Faixa = (typeof FAIXAS)[number];

export function isFaixa(v: unknown): v is Faixa {
	return typeof v === 'string' && (FAIXAS as readonly string[]).includes(v);
}

/** Classes de cor por faixa (lê as variáveis --prop-* do index.css, que mudam no escuro). */
export function faixaStyle(letra: string): { backgroundColor: string; color: string } {
	if (!isFaixa(letra)) return { backgroundColor: 'transparent', color: 'var(--base-texto-3)' };
	const k = letra.toUpperCase();
	return { backgroundColor: `var(--prop-${k}-bg)`, color: `var(--prop-${k}-text)` };
}

export type EvidenciaPropensao = 'coletando' | 'previa' | 'definida';

export function evidenciaLabel(ev?: EvidenciaPropensao | string | null): string {
	if (ev === 'coletando') return 'Coletando';
	if (ev === 'previa') return 'Prévia';
	if (ev === 'definida') return 'Definida';
	return 'Coletando';
}

/** Linha da view propensao_carteira. */
export type LinhaPropensaoCarteira = {
	faixa_propensao: string | null;
	clientes: number;
	saldo: number;
	valor_esperado: number;
	cluster?: string | null;
	persona_usuario?: string | null;
};

/** Códigos de erro que significam "a view/coluna ainda não existe" (banco sem SQL 48).
 *  Só esses viram "Coletando"/bloco escondido; qualquer outro erro é real e sobe. */
const PROPENSAO_MISSING_CODES = new Set([
	'42703', // undefined_column
	'42P01', // undefined_table
	'PGRST204', // schemaCacheMiss (coluna)
	'PGRST205', // schemaCacheMiss (relação/view)
]);
export function isPropensaoMissingError(err: unknown): boolean {
	if (!err || typeof err !== 'object') return false;
	const code = (err as { code?: string }).code;
	return !!code && PROPENSAO_MISSING_CODES.has(code);
}

/** Propensão gravada na persona (personas.propensao). */
export type PropensaoPersona = {
	faixas?: Record<string, number>;
	clientes?: number;
	saldo?: number;
	valor_esperado?: number;
};

/** Lê a view propensao_carteira da carteira. Retorna null se a view não existir
 *  (banco sem SQL 48 → Coletando). Outros erros sobem para a tela mostrar o aviso. */
export async function fetchPropensaoCarteira(
	empresaId: string,
	credorId: string,
): Promise<LinhaPropensaoCarteira[] | null> {
	if (!supabase) return null;
	const { data, error } = await supabase
		.from('propensao_carteira')
		.select('faixa_propensao,clientes,saldo,valor_esperado,cluster,persona_usuario')
		.eq('empresa_id', empresaId)
		.eq('credor_id', credorId);
	if (error) {
		// Só view/coluna inexistente (SQL 48 ausente) vira Coletando.
		if (isPropensaoMissingError(error)) return null;
		throw error;
	}
	return (data ?? []) as LinhaPropensaoCarteira[];
}

/** Soma clientes/saldo/valor_esperado por faixa (ignora linhas sem faixa). */
export function somarPorFaixa(rows: LinhaPropensaoCarteira[] | null): Record<string, { clientes: number; saldo: number; valor: number }> {
	const out: Record<string, { clientes: number; saldo: number; valor: number }> = {};
	for (const f of FAIXAS) out[f] = { clientes: 0, saldo: 0, valor: 0 };
	if (!rows) return out;
	for (const r of rows) {
		const f = r.faixa_propensao;
		if (!isFaixa(f)) continue;
		out[f].clientes += Number(r.clientes) || 0;
		out[f].saldo += Number(r.saldo) || 0;
		out[f].valor += Number(r.valor_esperado) || 0;
	}
	return out;
}

/** Linhas "Sem faixa" (faixa_propensao nula). */
export function somarSemFaixa(rows: LinhaPropensaoCarteira[] | null): { clientes: number; saldo: number; valor: number } {
	const out = { clientes: 0, saldo: 0, valor: 0 };
	if (!rows) return out;
	for (const r of rows) {
		if (isFaixa(r.faixa_propensao)) continue;
		out.clientes += Number(r.clientes) || 0;
		out.saldo += Number(r.saldo) || 0;
		out.valor += Number(r.valor_esperado) || 0;
	}
	return out;
}

/** A carteira está em Coletando? Usa execucoes.resumo.propensao.evidencia; sem esse
 *  dado, Coletando quando propensao_carteira não tem nenhuma linha com faixa. */
export function carteiraColetando(resumo: ResumoExecucao | null, rows: LinhaPropensaoCarteira[] | null): boolean {
	const ev = (resumo as unknown as { propensao?: { evidencia?: string } } | null)?.propensao?.evidencia;
	if (ev === 'coletando' || ev === 'previa' || ev === 'definida') return ev === 'coletando';
	return !(rows && rows.some(r => isFaixa(r.faixa_propensao)));
}

/** Rótulo da evidência da carteira (Coletando/Prévia/Definida). */
export function evidenciaCarteira(resumo: ResumoExecucao | null, rows: LinhaPropensaoCarteira[] | null): string {
	const ev = (resumo as unknown as { propensao?: { evidencia?: string } } | null)?.propensao?.evidencia;
	if (ev === 'coletando') return 'Coletando';
	if (ev === 'previa') return 'Prévia';
	if (ev === 'definida') return 'Definida';
	if (rows && rows.some(r => isFaixa(r.faixa_propensao))) return 'Definida';
	return 'Coletando';
}

/** Conta clientes com ação hoje por faixa de propensão (estado_cliente).
 *  Retorna null se a coluna faixa_propensao não existir. */
export async function contarAcaoHojePorFaixa(
	empresaId: string,
	credorId: string,
): Promise<Record<string, number> | null> {
	if (!supabase) return null;
	const out: Record<string, number> = { A: 0, B: 0, C: 0, D: 0, E: 0, sem: 0 };
	// Sonda a coluna faixa_propensao; se não existir (SQL 48 ausente), devolve null
	// (Coletando/bloco escondido). Outros erros sobem para a tela mostrar o aviso.
	const probe = await supabase
		.from('estado_cliente')
		.select('faixa_propensao')
		.eq('empresa_id', empresaId)
		.eq('credor_id', credorId)
		.not('na_carga', 'is', false)
		.not('acao_hoje', 'is', null)
		.neq('acao_hoje', '')
		.limit(1);
	if (probe.error) {
		if (isPropensaoMissingError(probe.error)) return null;
		throw probe.error;
	}
	// Conta por faixa. Sem faixa = faixa_propensao nula.
	for (const f of FAIXAS) {
		const { count, error } = await supabase
			.from('estado_cliente')
			.select('id_cliente', { count: 'exact', head: true })
			.eq('empresa_id', empresaId)
			.eq('credor_id', credorId)
			.not('na_carga', 'is', false)
			.not('acao_hoje', 'is', null)
			.neq('acao_hoje', '')
			.eq('faixa_propensao', f);
		if (error) {
			if (isPropensaoMissingError(error)) return null;
			throw error;
		}
		out[f] = count ?? 0;
	}
	const { count: semCount, error: semErr } = await supabase
		.from('estado_cliente')
		.select('id_cliente', { count: 'exact', head: true })
		.eq('empresa_id', empresaId)
		.eq('credor_id', credorId)
		.not('na_carga', 'is', false)
		.not('acao_hoje', 'is', null)
		.neq('acao_hoje', '')
		.is('faixa_propensao', null);
	if (semErr) {
		if (isPropensaoMissingError(semErr)) return null;
		throw semErr;
	}
	out.sem = semCount ?? 0;
	return out;
}

/** Faixa da persona: alta se A+B+C >= D+E, senão baixa. Sem faixas → null. */
export function faixaPersona(prop?: PropensaoPersona | null): 'alta' | 'baixa' | null {
	if (!prop || !prop.faixas) return null;
	const faixas = prop.faixas as Record<string, number>;
	const alta = Number(faixas.A ?? 0) + Number(faixas.B ?? 0) + Number(faixas.C ?? 0);
	const baixa = Number(faixas.D ?? 0) + Number(faixas.E ?? 0);
	if (alta + baixa === 0) return null;
	return alta >= baixa ? 'alta' : 'baixa';
}

/** Abordagem da persona: definida se maturidade.fase === 'definida'; senão aprendendo. */
export function abordagemPersona(maturidade?: { fase?: string } | null): 'definida' | 'aprendendo' {
	return maturidade?.fase === 'definida' ? 'definida' : 'aprendendo';
}

/** Helper: lê propensao de uma Row de persona (já vem do select *). */
export function propensaoDePersona(r: Row): PropensaoPersona | null {
	const p = r.propensao as PropensaoPersona | null | undefined;
	if (!p || typeof p !== 'object') return null;
	return p;
}
