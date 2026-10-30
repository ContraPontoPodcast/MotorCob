// Constantes e helpers da página Ações — tabela acoes_dia (só totais, sem cliente).
import { supabase, today } from '@/lib/supabase';

export { today };

export type AcaoRow = {
	empresa_id: string;
	credor_id?: string | null;
	data: string;
	canal: string;
	regua: string;
	cluster: string | null;
	persona: string | null;
	enviadas: number;
	reservas: number;
	com_retorno: number;
	retornos: number;
	cpcs: number;
	custo: number;
	primeiros_cpc: number;
	acoes_ate_primeiro_cpc: number;
	atualizado_em?: string;
};

export type Totais = {
	enviadas: number;
	reservas: number;
	com_retorno: number;
	retornos: number;
	cpcs: number;
	custo: number;
	primeiros_cpc: number;
	acoes_ate_primeiro_cpc: number;
};

/** Canal → nome e cor (paleta definida no briefing). */
export const canalMeta: Record<string, { nome: string; cor: string }> = {
	whatsapp: { nome: 'WhatsApp', cor: '#1F8A4C' },
	rcs: { nome: 'RCS', cor: '#3B5BA9' },
	sms: { nome: 'SMS', cor: '#7A4FB0' },
	email: { nome: 'E-mail', cor: '#A2552B' },
	agente_voz: { nome: 'Agente virtual', cor: '#0E7C86' },
	discador: { nome: 'Discador', cor: '#475569' },
};

/** Ordem canônica dos canais. */
export const canalOrdem = ['whatsapp', 'rcs', 'sms', 'email', 'agente_voz', 'discador'];

/** regua (momento) → nome na tela. */
export const reguaMeta: Record<string, string> = {
	localizacao: 'Cliente novo',
	cpc: 'CPC A / B',
	giro: 'Não CPC',
	preventivo: 'Preventivo',
	quebra: 'Quebra',
	fora_da_lista: 'Fora da lista',
};

/** Ordem canônica dos momentos. */
export const reguaOrdem = ['localizacao', 'cpc', 'giro', 'preventivo', 'quebra', 'fora_da_lista'];

export const canalNome = (c: string) => canalMeta[c]?.nome ?? c;
export const clusterNome = (c: string | null) => (c && c.trim() ? c : 'Demais clientes');
export const personaNome = (p: string | null) => (p && p.trim() ? p : 'Sem persona');

/** Soma linhas (números aditivos). fora_da_lista entra em com_retorno/cpcs/custo mas não em enviadas/reservas. */
export function somar(rows: AcaoRow[]): Totais {
	const t: Totais = {
		enviadas: 0, reservas: 0, com_retorno: 0, retornos: 0,
		cpcs: 0, custo: 0, primeiros_cpc: 0, acoes_ate_primeiro_cpc: 0,
	};
	for (const r of rows) {
		const fora = r.regua === 'fora_da_lista';
		if (!fora) {
			t.enviadas += Number(r.enviadas) || 0;
			t.reservas += Number(r.reservas) || 0;
		}
		t.com_retorno += Number(r.com_retorno) || 0;
		t.retornos += Number(r.retornos) || 0;
		t.cpcs += Number(r.cpcs) || 0;
		t.custo += Number(r.custo) || 0;
		t.primeiros_cpc += Number(r.primeiros_cpc) || 0;
		t.acoes_ate_primeiro_cpc += Number(r.acoes_ate_primeiro_cpc) || 0;
	}
	return t;
}

export const taxaRetorno = (t: Totais) => (t.enviadas ? t.com_retorno / t.enviadas : null);
export const taxaCpc = (t: Totais) => (t.enviadas ? t.cpcs / t.enviadas : null);
export const custoPorCpc = (t: Totais) => (t.cpcs ? t.custo / t.cpcs : null);
export const mediaAtePrimeiroCpc = (t: Totais) => (t.primeiros_cpc ? t.acoes_ate_primeiro_cpc / t.primeiros_cpc : null);

// --- Datas (string ISO YYYY-MM-DD, sem fuso) ---

export function addDays(iso: string, n: number): string {
	const d = new Date(`${iso}T12:00:00Z`);
	d.setUTCDate(d.getUTCDate() + n);
	return d.toISOString().slice(0, 10);
}

export function diffDays(a: string, b: string): number {
	const da = new Date(`${a}T12:00:00Z`).getTime();
	const db = new Date(`${b}T12:00:00Z`).getTime();
	return Math.round((da - db) / 86400000);
}

/** Segunda-feira da semana de `iso` (seg a dom). */
export function mondayOf(iso: string): string {
	const d = new Date(`${iso}T12:00:00Z`);
	const day = d.getUTCDay(); // 0=dom..6=sáb
	const delta = day === 0 ? -6 : 1 - day;
	return addDays(iso, delta);
}

export function bucketKey(iso: string, agrupar: 'dia' | 'semana' | 'mes'): string {
	if (agrupar === 'semana') return mondayOf(iso);
	if (agrupar === 'mes') return iso.slice(0, 7);
	return iso;
}

export function bucketLabel(key: string, agrupar: 'dia' | 'semana' | 'mes'): string {
	if (agrupar === 'mes') {
		const [y, m] = key.split('-');
		const meses = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
		return `${meses[Number(m) - 1]}/${y.slice(2)}`;
	}
	if (agrupar === 'semana') return `sem. ${key.slice(8)}`;
	// dia → DD/MM
	return `${key.slice(8, 10)}/${key.slice(5, 7)}`;
}

/** Gera todas as chaves de bucket entre de e ate (inclusive), mesmo vazias. */
export function allBuckets(de: string, ate: string, agrupar: 'dia' | 'semana' | 'mes'): string[] {
	const out: string[] = [];
	if (agrupar === 'dia') {
		let cur = de;
		while (cur <= ate) { out.push(cur); cur = addDays(cur, 1); }
	} else if (agrupar === 'semana') {
		let cur = mondayOf(de);
		while (cur <= ate) { out.push(cur); cur = addDays(cur, 7); }
	} else {
		let cur = de.slice(0, 7);
		const endMonth = ate.slice(0, 7);
		while (cur <= endMonth) {
			out.push(cur);
			const [y, m] = cur.split('-').map(Number);
			const nm = m === 12 ? 1 : m + 1;
			const ny = m === 12 ? y + 1 : y;
			cur = `${ny}-${String(nm).padStart(2, '0')}`;
		}
	}
	return out;
}

// --- Períodos ---

export type Periodo = { de: string; ate: string };

export const periodoOntem = (): Periodo => { const y = addDays(today(), -1); return { de: y, ate: y }; };
export const periodo7 = (): Periodo => ({ de: addDays(today(), -6), ate: today() });
export const periodo30 = (): Periodo => ({ de: addDays(today(), -29), ate: today() });
export const periodo60 = (): Periodo => ({ de: addDays(today(), -59), ate: today() });

export function periodoAnterior(p: Periodo): Periodo {
	const size = diffDays(p.ate, p.de) + 1;
	return { de: addDays(p.de, -size), ate: addDays(p.de, -1) };
}

/** Variação percentual entre atual e anterior. null = indisponível. */
export function variacao(curr: number, prev: number): number | null {
	if (prev === 0) return curr === 0 ? null : null;
	return (curr - prev) / prev;
}

// --- Fetch paginado ---

const ACAO_COLS = 'credor_id,data,canal,regua,cluster,persona,enviadas,reservas,com_retorno,retornos,cpcs,custo,primeiros_cpc,acoes_ate_primeiro_cpc,atualizado_em';

/** Busca linhas de acoes_dia no intervalo [de, ate] com paginação de 1000 em 1000. */
export async function fetchAcoes(empresaId: string, de: string, ate: string, credorId?: string | null): Promise<AcaoRow[]> {
	if (!supabase) return [];
	const all: AcaoRow[] = [];
	let from = 0;
	for (;;) {
		let q = supabase
			.from('acoes_dia')
			.select(ACAO_COLS)
			.eq('empresa_id', empresaId)
			.gte('data', de)
			.lte('data', ate)
			.order('data', { ascending: true })
			.range(from, from + 999);
		if (credorId) q = q.eq('credor_id', credorId);
		const { data, error } = await q;
		if (error) throw error;
		if (!data || data.length === 0) break;
		all.push(...(data as AcaoRow[]));
		if (data.length < 1000) break;
		from += 1000;
	}
	return all;
}

/** Dia útil = segunda a sexta (não conhecemos feriados). */
export function ehDiaUtil(iso: string): boolean {
	const day = new Date(`${iso}T12:00:00Z`).getUTCDay();
	return day >= 1 && day <= 5;
}
