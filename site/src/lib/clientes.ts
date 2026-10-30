// Constantes e helpers da página Clientes (carteira) — view enquadramento + estado_cliente.
import { supabase, type Row } from '@/lib/supabase';

/** Momento (estado) → nome na tela, na ordem da esteira. */
export const momentoNome: Record<string, string> = {
	LOC: 'Novo · localizando',
	NCP: 'Não CPC',
	CPA: 'CPC A',
	CPB: 'CPC B',
	PRE: 'Preventivo',
	COL: 'Acordo em dia',
	QBR: 'Quebra',
	LIQ: 'Liquidado',
	BLQ: 'Bloqueado',
};

/** Ordem natural dos momentos (colunas da matriz). */
export const momentoOrdem = ['LOC', 'NCP', 'CPA', 'CPB', 'PRE', 'COL', 'QBR', 'LIQ', 'BLQ'];

/** Canal da vez → nome curto. */
export const canalNome: Record<string, string> = {
	WA: 'WhatsApp',
	RC: 'RCS',
	AV: 'Agente virtual',
	DC: 'Discador',
	SM: 'SMS',
	EM: 'E-mail',
	ND: '—',
};

export type Enquadramento = {
	cluster: string | null;
	estrategia: string | null;
	estado: string | null;
	na_carga: boolean;
	clientes: number;
	com_acao_hoje: number;
	saldo: number;
};

export type ClienteRow = {
	id_cliente: string;
	cluster_atual: string | null;
	estado: string | null;
	ciclo: string | null;
	canal: string | null;
	saldo: number;
	dias_atraso: number | null;
	estrategia: string | null;
	persona: string | null;
	persona_usuario: string | null;
	enriq_enviado: string | null;
	enriq_retorno: string | null;
	na_carga: boolean;
	acao_hoje: string | null;
	passo_hoje: string | null;
	motivo_hoje: string | null;
	atualizado_em: string | null;
	faixa_propensao: string | null;
	propensao: number | null;
};

export type ClusterInfo = { codigo: string; nome: string };

/** Busca o resumo enquadramento de um credor (paginação de 1000 em 1000). */
export async function fetchEnquadramento(empresaId: string, credorId: string): Promise<Enquadramento[]> {
	if (!supabase) return [];
	const cols = 'cluster,estrategia,estado,na_carga,clientes,com_acao_hoje,saldo';
	const all: Enquadramento[] = [];
	let from = 0;
	for (;;) {
		const { data, error } = await supabase
			.from('enquadramento')
			.select(cols)
			.eq('empresa_id', empresaId)
			.eq('credor_id', credorId)
			.range(from, from + 999);
		if (error) throw error;
		if (!data || data.length === 0) break;
		all.push(...(data as Enquadramento[]));
		if (data.length < 1000) break;
		from += 1000;
	}
	return all;
}

/** Busca os clusters da empresa para mapear código → nome. */
export async function fetchClusters(empresaId: string): Promise<ClusterInfo[]> {
	if (!supabase) return [];
	const { data, error } = await supabase
		.from('clusters')
		.select('codigo,nome')
		.eq('empresa_id', empresaId)
		.eq('ativo', true);
	if (error) return [];
	return (data ?? []) as ClusterInfo[];
}

const CLIENTE_COLS = 'id_cliente,cluster_atual,estado,ciclo,canal,saldo,dias_atraso,estrategia,persona,persona_usuario,enriq_enviado,enriq_retorno,na_carga,acao_hoje,passo_hoje,motivo_hoje,atualizado_em';

// A coluna faixa_propensao pode não existir (SQL 48 ausente). Sondamos uma vez e
// cacheamos: se não existir, refazemos a consulta sem as colunas novas e ocultamos
// a coluna/filtro de propensão (mostra “Coletando”).
let propensaoDisponivel: boolean | null = null;
async function ensurePropensao(empresaId: string, credorId: string): Promise<boolean> {
	if (propensaoDisponivel !== null) return propensaoDisponivel;
	if (!supabase) { propensaoDisponivel = false; return false; }
	const { error } = await supabase.from('estado_cliente').select('faixa_propensao').eq('empresa_id', empresaId).eq('credor_id', credorId).limit(1);
	propensaoDisponivel = !error;
	return propensaoDisponivel;
}
function selectCols(): string {
	return propensaoDisponivel ? `${CLIENTE_COLS},faixa_propensao,propensao` : CLIENTE_COLS;
}
/** True após a primeira consulta se a coluna faixa_propensao existir no banco. */
export function isPropensaoDisponivel(): boolean { return propensaoDisponivel === true; }

export type ClienteFiltros = {
	segmento: string | null;
	estrategia: string | null;
	estado: string | null;
	persona: string | null;
	motivoHoje: string | null;
	comAcaoHoje: boolean;
	soNaCarga: boolean;
	busca: string;
	faixa: string | null;
};

/** Monta a query de estado_cliente com os filtros aplicados (sem range). */
function buildQuery(empresaId: string, credorId: string, f: ClienteFiltros) {
	let q = supabase!
		.from('estado_cliente')
		.select(selectCols(), { count: 'exact' })
		.eq('empresa_id', empresaId)
		.eq('credor_id', credorId);
	if (f.soNaCarga) q = q.eq('na_carga', true);
	if (f.comAcaoHoje) q = q.not('acao_hoje', 'is', null).filter('acao_hoje', 'neq', '');
	if (f.segmento) q = q.eq('cluster_atual', f.segmento);
	if (f.estrategia) q = q.eq('estrategia', f.estrategia);
	if (f.estado) q = q.eq('estado', f.estado);
	if (f.persona) q = q.eq('persona', f.persona);
	if (f.motivoHoje) q = q.eq('motivo_hoje', f.motivoHoje);
	if (propensaoDisponivel && f.faixa) {
		if (f.faixa === 'sem') q = q.is('faixa_propensao', null);
		else q = q.eq('faixa_propensao', f.faixa);
	}
	if (f.busca.trim()) q = q.ilike('id_cliente', `%${f.busca.trim()}%`);
	return q;
}

/** Busca uma página de clientes (ordenado por saldo decrescente). */
export async function fetchClientes(
	empresaId: string,
	credorId: string,
	f: ClienteFiltros,
	pagina: number,
	porPagina = 50,
): Promise<{ rows: ClienteRow[]; total: number }> {
	if (!supabase) return { rows: [], total: 0 };
	await ensurePropensao(empresaId, credorId);
	const from = pagina * porPagina;
	const { data, error, count } = await buildQuery(empresaId, credorId, f)
		.order('saldo', { ascending: false })
		.range(from, from + porPagina - 1);
	if (error) throw error;
	return { rows: (data ?? []) as unknown as ClienteRow[], total: count ?? 0 };
}

/** Busca todos os clientes com os filtros (para CSV). */
export async function fetchTodosClientes(
	empresaId: string,
	credorId: string,
	f: ClienteFiltros,
): Promise<ClienteRow[]> {
	if (!supabase) return [];
	await ensurePropensao(empresaId, credorId);
	const all: ClienteRow[] = [];
	let from = 0;
	for (;;) {
		const { data, error } = await buildQuery(empresaId, credorId, f)
			.order('saldo', { ascending: false })
			.range(from, from + 999);
		if (error) throw error;
		if (!data || data.length === 0) break;
		all.push(...(data as unknown as ClienteRow[]));
		if (data.length < 1000) break;
		from += 1000;
	}
	return all;
}

/** Busca os motivos de hoje distintos de uma carteira (view motivos_hoje). */
export async function fetchMotivosHoje(empresaId: string, credorId: string): Promise<string[]> {
	if (!supabase) return [];
	const { data, error } = await supabase
		.from('motivos_hoje')
		.select('motivo')
		.eq('empresa_id', empresaId)
		.eq('credor_id', credorId);
	if (error) return [];
	return (data ?? []).map((r: Row) => String(r.motivo ?? '')).filter(Boolean);
}

/** Nome do segmento: "VE · Veículo" se houver cluster, senão "Demais clientes". */
export function segmentoNome(cluster: string | null, clusters: ClusterInfo[]): string {
	if (!cluster || !cluster.trim()) return 'Demais clientes';
	const found = clusters.find(c => c.codigo === cluster);
	if (!found) return 'Demais clientes';
	return `${found.codigo} · ${found.nome}`;
}

/** Nome do momento com etapa do ciclo: "Novo · L2", "CPC B · T1". */
export function momentoComCiclo(estado: string | null, ciclo: string | null): string {
	const base = (estado && momentoNome[estado]) ?? '—';
	if (!ciclo || !ciclo.trim()) return base === '—' ? '—' : base;
	return `${base} · ${ciclo}`;
}

/** Soma simples de um campo numérico. */
export function soma(rows: Row[], campo: string): number {
	return rows.reduce((acc, r) => acc + (Number(r[campo]) || 0), 0);
}
