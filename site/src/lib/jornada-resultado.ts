// Resultado da Jornada (SQL 40) para a Visão geral, o Painel e Clientes (Onda 3).
// Só contagens e o ID do cliente: nada de nome, documento, telefone ou e-mail.
import { supabase, today, type Row } from '@/lib/supabase';
import { addDays, type Periodo } from '@/lib/acoes';
import { MOMENTOS } from '@/lib/jornada';

export type MapaMomento = {
	momento: string;
	no_momento: number;
	com_acao: number;
	sucesso: number;
	nao: number;
	taxa: number | null;
	cobranca: number;
};

export type ResultadoCanal = {
	momento: string;
	canal: string;
	acionamentos: number;
	sucesso: number;
	nao: number;
	custo: number;
};

/** Fase do cliente hoje (jornada_cliente.fase) → nome na tela. '' = fora da jornada; cobranca = em atraso. */
export const FASE_NOME: Record<string, string> = {
	pre_vencimento: 'Pré-vencimento',
	boas_vindas: 'Boas-vindas',
	ativacao: 'Ativação',
	retencao: 'Retenção',
	reativacao: 'Reativação',
	cobranca: 'Em atraso',
	'': 'Fora da jornada',
};
export const faseNome = (f: unknown) => FASE_NOME[String(f ?? '')] ?? String(f ?? '');

export const PERIODOS = [
	{ id: '7', nome: '7 dias', dias: 7 },
	{ id: '30', nome: '30 dias', dias: 30 },
	{ id: '90', nome: '90 dias', dias: 90 },
] as const;

export function periodoDe(dias: number): Periodo {
	return { de: addDays(today(), -(dias - 1)), ate: today() };
}

const num = (v: unknown) => Number(v ?? 0) || 0;

/** mapa_jornada(credor, de, ate): por momento, quem está nele hoje, com ação hoje e o resultado do período. */
export async function fetchMapa(credorId: string, p: Periodo): Promise<MapaMomento[]> {
	if (!supabase) return [];
	const { data, error } = await supabase.rpc('mapa_jornada', { credor: Number(credorId), de: p.de, ate: p.ate });
	if (error) throw error;
	return ((data ?? []) as Row[]).map(r => ({
		momento: String(r.momento ?? ''),
		no_momento: num(r.no_momento),
		com_acao: num(r.com_acao),
		sucesso: num(r.sucesso),
		nao: num(r.nao),
		taxa: r.taxa == null ? null : Number(r.taxa),
		cobranca: num(r.cobranca),
	}));
}

/** resultado_jornada(credor, de, ate, momento): por momento e canal, acionamentos, resultado e custo. */
export async function fetchResultado(credorId: string, p: Periodo, momento?: string | null): Promise<ResultadoCanal[]> {
	if (!supabase) return [];
	const { data, error } = await supabase.rpc('resultado_jornada', { credor: Number(credorId), de: p.de, ate: p.ate, momento: momento || null });
	if (error) throw error;
	return ((data ?? []) as Row[]).map(r => ({
		momento: String(r.momento ?? ''),
		canal: String(r.canal ?? ''),
		acionamentos: num(r.acionamentos),
		sucesso: num(r.sucesso),
		nao: num(r.nao),
		custo: num(r.custo),
	}));
}

export type Totais = { acionamentos: number; sucesso: number; fechados: number; custo: number; cobranca: number; noJornada: number };

/** Os números do período: soma do mapa (resultado e cobrança) e do resultado por canal (acionamentos e custo). */
export function totais(mapa: MapaMomento[], res: ResultadoCanal[]): Totais {
	const momentos = mapa.filter(m => m.momento !== 'cobranca');
	return {
		acionamentos: res.reduce((s, r) => s + r.acionamentos, 0),
		sucesso: momentos.reduce((s, m) => s + m.sucesso, 0),
		fechados: momentos.reduce((s, m) => s + m.sucesso + m.nao, 0),
		custo: res.reduce((s, r) => s + r.custo, 0),
		cobranca: mapa.find(m => m.momento === 'cobranca')?.cobranca ?? 0,
		noJornada: momentos.reduce((s, m) => s + m.no_momento, 0),
	};
}

export const taxaDe = (s: number, fechados: number): number | null => (fechados > 0 ? (100 * s) / fechados : null);

/** Por canal (somando os momentos): a tabela Ações por canal. "sem ação" não é canal e fica de fora. */
export function porCanal(res: ResultadoCanal[]): ResultadoCanal[] {
	const map = new Map<string, ResultadoCanal>();
	for (const r of res) {
		if (!r.canal || r.canal === 'sem ação') continue;
		const a = map.get(r.canal) ?? { momento: '', canal: r.canal, acionamentos: 0, sucesso: 0, nao: 0, custo: 0 };
		a.acionamentos += r.acionamentos; a.sucesso += r.sucesso; a.nao += r.nao; a.custo += r.custo;
		map.set(r.canal, a);
	}
	return [...map.values()].sort((a, b) => b.acionamentos - a.acionamentos);
}

export type Sugestao = { momento: string; barato: ResultadoCanal; caro: ResultadoCanal };

/** Volume mínimo de resultados fechados por canal para comparar (o mesmo do "melhor canal" do motor). */
export const SUGESTAO_MINIMO = 200;

/**
 * Sugestão do Painel (calculada na tela): num mesmo momento, um canal com taxa até 5 p.p. menor e custo por resultado
 * 3 vezes menor ou menos que o canal de maior taxa. Devolve a maior economia; nenhuma = null. Nada muda sozinho.
 */
export function calcularSugestao(res: ResultadoCanal[]): Sugestao | null {
	let melhor: (Sugestao & { ganho: number }) | null = null;
	for (const m of MOMENTOS) {
		const canais = res.filter(r => r.momento === m.id && r.canal && r.canal !== 'sem ação' && r.sucesso > 0 && r.custo > 0
			&& r.sucesso + r.nao >= SUGESTAO_MINIMO);
		if (canais.length < 2) continue;
		const taxa = (r: ResultadoCanal) => (100 * r.sucesso) / (r.sucesso + r.nao);
		const cpr = (r: ResultadoCanal) => r.custo / r.sucesso;
		const caro = [...canais].sort((a, b) => taxa(b) - taxa(a))[0];
		for (const c of canais) {
			if (c.canal === caro.canal) continue;
			if (taxa(c) >= taxa(caro) - 5 && cpr(c) * 3 <= cpr(caro)) {
				const ganho = cpr(caro) / cpr(c);
				if (!melhor || ganho > melhor.ganho) melhor = { momento: m.id, barato: c, caro, ganho };
			}
		}
	}
	return melhor ? { momento: melhor.momento, barato: melhor.barato, caro: melhor.caro } : null;
}

/** Taxa de resultado por dia (todos os momentos), a partir de jornada_desfechos. */
export async function fetchTaxaPorDia(empresaId: string, credorId: string, p: Periodo): Promise<{ data: string; taxa: number | null }[]> {
	if (!supabase) return [];
	const soma = new Map<string, { s: number; f: number }>();
	let from = 0;
	for (;;) {
		const { data, error } = await supabase.from('jornada_desfechos').select('data,desfecho,clientes')
			.eq('empresa_id', empresaId).eq('credor_id', credorId).gte('data', p.de).lte('data', p.ate)
			.in('desfecho', ['sucesso', 'nao']).order('data').range(from, from + 999);
		if (error) throw error;
		const rows = (data ?? []) as Row[];
		for (const r of rows) {
			const d = String(r.data);
			const a = soma.get(d) ?? { s: 0, f: 0 };
			const n = num(r.clientes);
			a.f += n;
			if (r.desfecho === 'sucesso') a.s += n;
			soma.set(d, a);
		}
		if (rows.length < 1000) break;
		from += 1000;
	}
	const out: { data: string; taxa: number | null }[] = [];
	for (let d = p.de; d <= p.ate; d = addDays(d, 1)) {
		const a = soma.get(d);
		out.push({ data: d, taxa: a && a.f > 0 ? (100 * a.s) / a.f : null });
	}
	return out;
}

/** Movimento entre momentos no período: jornada_movimento somado por de → para. */
export async function fetchMovimento(empresaId: string, credorId: string, p: Periodo): Promise<Record<string, number>> {
	if (!supabase) return {};
	const out: Record<string, number> = {};
	let from = 0;
	for (;;) {
		const { data, error } = await supabase.from('jornada_movimento').select('de,para,clientes')
			.eq('empresa_id', empresaId).eq('credor_id', credorId).gte('data', p.de).lte('data', p.ate)
			.order('data').range(from, from + 999);
		if (error) throw error;
		const rows = (data ?? []) as Row[];
		for (const r of rows) {
			const k = `${String(r.de)}>${String(r.para)}`;
			out[k] = (out[k] ?? 0) + num(r.clientes);
		}
		if (rows.length < 1000) break;
		from += 1000;
	}
	return out;
}

export type FraseResultado = { texto: string; momento: string; canal: string; taxa: number; fechados: number };

/** Mensagens que mais dão resultado: resultado_frases + o texto e o canal da frase. */
export async function fetchFrases(empresaId: string, credorId: string, p: Periodo, limite = 5): Promise<FraseResultado[]> {
	if (!supabase) return [];
	const { data, error } = await supabase.rpc('resultado_frases', { credor: Number(credorId), de: p.de, ate: p.ate });
	if (error) throw error;
	const rows = ((data ?? []) as Row[]).filter(r => r.taxa != null && num(r.sucesso) + num(r.nao) > 0);
	if (rows.length === 0) return [];
	const ids = [...new Set(rows.map(r => Number(r.frase_id)))];
	const { data: fr } = await supabase.from('frases').select('id,texto,canal').eq('empresa_id', empresaId).in('id', ids);
	const porId = new Map(((fr ?? []) as Row[]).map(f => [Number(f.id), f]));
	return rows
		.map(r => {
			const f = porId.get(Number(r.frase_id));
			return f ? { texto: String(f.texto ?? ''), canal: String(f.canal ?? ''), momento: String(r.momento ?? ''), taxa: Number(r.taxa), fechados: num(r.sucesso) + num(r.nao) } : null;
		})
		.filter((x): x is FraseResultado => !!x && !!x.texto)
		.sort((a, b) => b.taxa - a.taxa || b.fechados - a.fechados)
		.slice(0, limite);
}

/** "30,4%" */
export const pct1 = (v: number | null | undefined) => (v == null || !Number.isFinite(v) ? '—' : `${v.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`);
