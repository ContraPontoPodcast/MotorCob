// Créditos de IA (SQL 78; SPEC do Especialista §11, telas 11 e 12). O cliente vê só QUANTIDADE e o preço do
// excedente; nunca o custo. O contador lê a view `ia_creditos_ciclo` (ciclo de hoje da empresa) e a tela Empresa ›
// Uso de IA lê `uso_ia_empresa(empresa, competencia)`. Nada aqui grava crédito: a reserva é do servidor/RPC.
import type { SupabaseClient } from '@supabase/supabase-js';

export type ResumoCreditos = {
	competencia: string;
	inicio: string;
	fim: string;
	renova_em: string;
	usados: number;
	franquia: number;
	excedente: number;
	media_7d: number | null;
	projecao: number | null;
	teto: number | null;
	preco_excedente: number | null;
};

export type GrupoUso = { grupo: string; creditos_por_uso: number; usos: number; creditos: number };
export type DiaUso = { dia: string; creditos: number };
export type UsoIA = ResumoCreditos & {
	hoje: string;
	atual: boolean;
	valor_excedente: number;
	por_funcao: GrupoUso[];
	por_dia: DiaUso[];
};

/** ok (< 80%), atencao (80% a 99%), excedente (franquia acabou). Franquia 0 = tudo é excedente. */
export type NivelCreditos = 'ok' | 'atencao' | 'excedente';

export function nivelCreditos(r: Pick<ResumoCreditos, 'usados' | 'franquia'>): NivelCreditos {
	const f = Number(r.franquia ?? 0);
	const u = Number(r.usados ?? 0);
	if (f <= 0) return u > 0 ? 'excedente' : 'ok';
	if (u >= f) return 'excedente';
	return u >= Math.ceil(f * 0.8) ? 'atencao' : 'ok';
}

/** Fração da barra do contador (0 a 1). */
export function fracaoCreditos(r: Pick<ResumoCreditos, 'usados' | 'franquia'>): number {
	const f = Number(r.franquia ?? 0);
	if (f <= 0) return Number(r.usados ?? 0) > 0 ? 1 : 0;
	return Math.max(0, Math.min(1, Number(r.usados ?? 0) / f));
}

/** "01/12" a partir de "2026-12-01". */
export function diaMes(iso: string | null | undefined): string {
	const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso ?? ''));
	return m ? `${m[3]}/${m[2]}` : '—';
}

export function inteiroBR(n: number | null | undefined): string {
	return Number(n ?? 0).toLocaleString('pt-BR', { maximumFractionDigits: 0 });
}

/** R$ 1,90 (o preço do excedente; nunca custo). */
export function precoCredito(v: number | string | null | undefined): string {
	if (v == null || v === '') return '—';
	return Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** "87 de 100 no mês · excedente 0 · renova em 01/12" (tela 11, cabeçalho do painel). */
export function textoContador(r: ResumoCreditos): string {
	return `${inteiroBR(r.usados)} de ${inteiroBR(r.franquia)} no mês · excedente ${inteiroBR(r.excedente)} · renova em ${diaMes(r.renova_em)}`;
}

/**
 * Rótulo de consumo no botão (tela 11): "Perguntar · 1 crédito (excedente)", "Analisar de novo · 2 créditos".
 * Peso 0 → "sem crédito". `(excedente)` quando o uso cai acima da franquia (usados + peso > franquia).
 */
export function rotuloCreditos(peso: number, r?: Pick<ResumoCreditos, 'usados' | 'franquia'> | null): string {
	if (!peso) return 'sem crédito';
	const base = `${peso} ${peso === 1 ? 'crédito' : 'créditos'}`;
	if (r && Number(r.usados ?? 0) + peso > Number(r.franquia ?? 0)) return `${base} (excedente)`;
	return base;
}

/** Projeção do ciclo e o excedente previsto: "~373" e "excedente ~273 × R$ 1,90". */
export function textoProjecao(r: ResumoCreditos): { valor: string; detalhe: string } {
	if (r.projecao == null) return { valor: '—', detalhe: 'ciclo encerrado' };
	const exc = Math.max(0, Number(r.projecao) - Number(r.franquia ?? 0));
	return {
		valor: `~${inteiroBR(r.projecao)}`,
		detalhe: `no ritmo dos últimos 7 dias · excedente ${exc > 0 ? '~' : ''}${inteiroBR(exc)} × ${precoCredito(r.preco_excedente)}`,
	};
}

/**
 * Aviso da tela (um por seção): 80% e 100% com as frases do protótipo. Nada é bloqueado; com teto, diz o teto.
 * `null` = sem aviso.
 */
export function avisoCreditos(r: ResumoCreditos, diaPico?: DiaUso | null): { tom: 'atencao' | 'erro'; titulo: string; texto: string } | null {
	const n = nivelCreditos(r);
	const preco = precoCredito(r.preco_excedente);
	const teto = r.teto != null && Number(r.usados) >= Number(r.teto);
	if (teto) {
		return { tom: 'erro', titulo: 'Limite de IA da sua empresa atingido neste mês.', texto: `O limite combinado é de ${inteiroBR(r.teto)} créditos por ciclo; fale com o suporte. Renova em ${diaMes(r.renova_em)}.` };
	}
	if (n === 'excedente') {
		return { tom: 'atencao', titulo: `A franquia de ${inteiroBR(r.franquia)} créditos deste mês acabou.`, texto: `A partir de agora, cada crédito é cobrado como excedente: ${preco}. Neste mês: ${inteiroBR(r.excedente)} ${Number(r.excedente) === 1 ? 'excedente' : 'excedentes'}. Nada fica bloqueado. A franquia renova em ${diaMes(r.renova_em)}.` };
	}
	if (n === 'atencao') {
		const pico = diaPico && diaPico.creditos > 0 ? ` O dia ${diaMes(diaPico.dia)} teve ${inteiroBR(diaPico.creditos)} créditos.` : '';
		return { tom: 'atencao', titulo: '', texto: `Vocês já usaram ${inteiroBR(r.usados)} dos ${inteiroBR(r.franquia)} créditos do mês (aviso de 80%). Nada é bloqueado: acima de ${inteiroBR(r.franquia)}, cada crédito vai para a fatura como excedente.${pico}` };
	}
	return null;
}

/** Dia de maior uso (para o aviso). */
export function diaDePico(dias: DiaUso[]): DiaUso | null {
	return dias.reduce<DiaUso | null>((m, d) => (!m || Number(d.creditos) > Number(m.creditos) ? d : m), null);
}

function numero(v: unknown): number { return Number(v ?? 0); }
function numOuNulo(v: unknown): number | null { return v == null ? null : Number(v); }

export function normalizarResumo(x: Record<string, unknown>): ResumoCreditos {
	return {
		competencia: String(x.competencia ?? ''), inicio: String(x.inicio ?? ''), fim: String(x.fim ?? ''),
		renova_em: String(x.renova_em ?? ''), usados: numero(x.usados), franquia: numero(x.franquia),
		excedente: numero(x.excedente), media_7d: numOuNulo(x.media_7d), projecao: numOuNulo(x.projecao),
		teto: numOuNulo(x.teto), preco_excedente: numOuNulo(x.preco_excedente),
	};
}

export function normalizarUso(x: Record<string, unknown>): UsoIA {
	return {
		...normalizarResumo(x), hoje: String(x.hoje ?? ''), atual: !!x.atual, valor_excedente: numero(x.valor_excedente),
		por_funcao: ((x.por_funcao ?? []) as Record<string, unknown>[]).map(g => ({ grupo: String(g.grupo ?? ''), creditos_por_uso: numero(g.creditos_por_uso), usos: numero(g.usos), creditos: numero(g.creditos) })),
		por_dia: ((x.por_dia ?? []) as Record<string, unknown>[]).map(d => ({ dia: String(d.dia ?? ''), creditos: numero(d.creditos) })),
	};
}

/** Contador do ciclo de hoje (view; RLS: só quem vê a empresa). `null` = banco sem o SQL 78 ou sem acesso. */
export async function carregarResumoCreditos(sb: SupabaseClient, empresa: number | string): Promise<ResumoCreditos | null> {
	const { data, error } = await sb.from('ia_creditos_ciclo')
		.select('competencia,inicio,fim,renova_em,usados,franquia,excedente,media_7d,projecao,teto,preco_excedente')
		.eq('empresa_id', Number(empresa)).maybeSingle();
	if (error || !data) return null;
	return normalizarResumo(data as Record<string, unknown>);
}

export async function carregarUsoIA(sb: SupabaseClient, empresa: number | string, competencia?: string | null): Promise<UsoIA> {
	const { data, error } = await sb.rpc('uso_ia_empresa', { empresa: Number(empresa), competencia: competencia ?? null });
	if (error) throw error;
	return normalizarUso((data ?? {}) as Record<string, unknown>);
}
