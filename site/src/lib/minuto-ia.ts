// Agente de voz cobrado por minuto falado com a IA (SQL 123–127): a mesma tarifação do banco
// (public.segundos_tarifados_ia) e da VM (voz/tarifacao.py), com a mesma tabela de casos
// (tests/dados/tarifacao_ia_casos.json, conferida em minuto-ia.test.tsx), e as planilhas do demonstrativo.
import { paraCsv } from './voz';

/** Pré-preenchidos (decisão do dono): preço do minuto R$ 1,25 e cadência 0/30/6, sempre editáveis. */
export const PRECO_MINUTO_PADRAO = 1.25;
export const CADENCIA_PADRAO = '0/30/6';
/** Régua da tela da Contratação: como cada duração é cobrada. */
export const REGUA_CADENCIA = [5, 12, 31, 47, 95] as const;

/** Segundos em milésimos inteiros, arredondando a 4ª casa para cima a partir de 5 (como o round(s, 3) do banco). */
export function milesimos(v: unknown): number {
	const n = Number(v ?? 0);
	if (!Number.isFinite(n) || n <= 0) return 0;
	const [int, frac = ''] = String(n).includes('e') ? n.toFixed(6).split('.') : String(n).split('.');
	const tres = Number((frac + '000').slice(0, 3));
	const quarta = Number(frac.charAt(3) || '0');
	return Number(int) * 1000 + tres + (quarta >= 5 ? 1 : 0);
}

/** ≤ grátis → 0; ≤ inicial → inicial; senão inicial + ceil((s − inicial) ÷ incremento) × incremento. */
export function segundosTarifadosIa(segundos: unknown, gratis: number, inicial: number, incremento: number): number {
	if (inicial < 1 || incremento < 1 || gratis < 0) return 0;
	const ms = milesimos(segundos);
	if (ms <= 0 || ms <= gratis * 1000) return 0;
	if (ms <= inicial * 1000) return inicial;
	return inicial + Math.ceil((ms - inicial * 1000) / (incremento * 1000)) * incremento;
}

/** '0/30/6' → [0, 30, 6]. */
export function cadenciaIa(texto: unknown): [number, number, number] {
	const [g, i, n] = String(texto ?? '0/30/6').split('/').map(Number);
	return [g || 0, i || 30, n || 6];
}

/** Valor da ligação: tarifados × preço ÷ 60 (5 casas, como valor_ia). */
export function valorIa(tarifados: number, preco: number): number {
	return Math.round(tarifados * preco / 60 * 100000) / 100000;
}

/** "uma conversa de 47 s é cobrada como 48 s" */
export function exemploCadencia(segundos: number, g: number, i: number, n: number): string {
	return `uma conversa de ${segundos.toLocaleString('pt-BR')} s é cobrada como ${segundosTarifadosIa(segundos, g, i, n)} s`;
}

/** Segundos para texto curto: "47,25 s" / "1 min 12 s". */
export function textoSegundos(v: unknown): string {
	const s = Number(v ?? 0);
	if (s < 60) return `${s.toLocaleString('pt-BR', { maximumFractionDigits: 3 })} s`;
	const m = Math.floor(s / 60);
	const r = Math.round((s - m * 60) * 1000) / 1000;
	return `${m} min${r ? ` ${r.toLocaleString('pt-BR', { maximumFractionDigits: 3 })} s` : ''}`;
}

const hora = (v: unknown) => (v ? new Date(String(v)).toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : '');
const dia = (v: unknown) => (v ? String(v).slice(0, 10).split('-').reverse().join('/') : '');
const num = (v: unknown) => (v == null || v === '' ? null : Number(v));
const DESFECHO_MAQUINA = new Set(['maquina', 'caixa_postal']);

export type LinhaDemonstrativo = Record<string, unknown>;

/** Planilha por ligação (sem telefone nem cliente). */
export function csvLigacoesIa(linhas: LinhaDemonstrativo[]): string {
	return paraCsv(
		['id_chamada', 'dia', 'atendida', 'inicio_ia', 'fim_ia_ou_transferencia', 'retomada_ia', 'fim', 'segundos_falados',
			'segundos_tarifados', 'cadencia', 'preco_minuto', 'valor', 'desfecho', 'observacao'],
		linhas.map(l => [String(l.id_chamada ?? ''), dia(l.dia), hora(l.atendida_em), hora(l.ia_inicio_em), hora(l.ia_fim_em),
			hora(l.ia_retomada_em), hora(l.encerrada_em), num(l.segundos_ia), num(l.segundos_ia_tarifados),
			String(l.cadencia_ia ?? ''), num(l.preco_minuto_ia), l.valor_ia == null ? null : Number(Number(l.valor_ia).toFixed(4)),
			String(l.desfecho ?? ''), DESFECHO_MAQUINA.has(String(l.desfecho ?? '')) ? 'máquina/caixa postal: não cobrada' : '']),
	);
}

/** Planilha resumo (por dia). */
export function csvResumoIa(linhas: LinhaDemonstrativo[]): string {
	return paraCsv(
		['dia', 'modelo', 'cadencia', 'preco_minuto', 'ligacoes', 'ligacoes_cobradas', 'segundos_falados', 'segundos_tarifados',
			'minutos_tarifados', 'valor'],
		linhas.map(l => [dia(l.dia), String(l.modelo ?? ''), String(l.cadencia_ia ?? ''), num(l.preco_minuto_ia), num(l.ligacoes),
			num(l.ligacoes_cobradas), num(l.segundos_ia), num(l.segundos_ia_tarifados),
			Math.round(Number(l.segundos_ia_tarifados ?? 0) / 60 * 100) / 100, l.valor == null ? null : Number(Number(l.valor).toFixed(4))]),
	);
}

/** Total do mês como na fatura: Σ tarifados × preço ÷ 60, arredondado só no total (por preço). */
export function totalMesIa(linhas: LinhaDemonstrativo[]): { segundos: number; tarifados: number; minutos: number; valor: number; ligacoes: number; cobradas: number } {
	const porPreco = new Map<number, number>();
	let segundos = 0, tarifados = 0, ligacoes = 0, cobradas = 0;
	for (const l of linhas) {
		segundos += Number(l.segundos_ia ?? 0);
		tarifados += Number(l.segundos_ia_tarifados ?? 0);
		ligacoes += Number(l.ligacoes ?? 0);
		cobradas += Number(l.ligacoes_cobradas ?? 0);
		if (l.preco_minuto_ia != null && l.valor != null) porPreco.set(Number(l.preco_minuto_ia), (porPreco.get(Number(l.preco_minuto_ia)) ?? 0) + Number(l.segundos_ia_tarifados ?? 0));
	}
	let valor = 0;
	for (const [p, s] of porPreco) valor += Math.round(s * p / 60 * 100) / 100;
	return { segundos, tarifados, minutos: Math.round(tarifados / 60 * 100) / 100, valor: Math.round(valor * 100) / 100, ligacoes, cobradas };
}
