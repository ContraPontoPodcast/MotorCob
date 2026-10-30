// Reenquadramento da carteira: pedidos de rotina on-demand + snapshot "antes" para comparar.
// O site só faz INSERT ({credor_id}) e SELECT em pedidos_rotina; o status é gravado pelo MotorCob.
import { supabase, type Row } from '@/lib/supabase';

export type StatusPedido = 'pendente' | 'rodando' | 'ok' | 'erro';

export type PedidoRotina = {
	id: string;
	empresa_id: string;
	credor_id: string;
	status: StatusPedido;
	pedido_em: string;
	iniciado_em: string | null;
	terminado_em: string | null;
	execucao_id: string | null;
	erro: string | null;
};

export type ContagemSnapshot = {
	segmentos: Record<string, number>;
	personas: Record<string, number>;
	total: number;
	pedidoId: string | null;
	salvoEm: string;
};

const ANTES_KEY = (credorId: string) => `motorcob.antes.${credorId}`;

/** Contagens atuais por segmento (cluster) e por persona (persona_usuario), só na carga. */
export async function fetchContagens(
	empresaId: string,
	credorId: string,
): Promise<{ segmentos: Record<string, number>; personas: Record<string, number>; total: number }> {
	if (!supabase) return { segmentos: {}, personas: {}, total: 0 };
	const segmentos: Record<string, number> = {};
	const personas: Record<string, number> = {};
	let total = 0;
	let from = 0;
	for (;;) {
		const { data, error } = await supabase
			.from('enquadramento')
			.select('cluster,persona_usuario,clientes,na_carga')
			.eq('empresa_id', empresaId)
			.eq('credor_id', credorId)
			.range(from, from + 999);
		if (error) throw error;
		if (!data || data.length === 0) break;
		for (const r of data as Row[]) {
			if (!r.na_carga) continue;
			const n = Number(r.clientes) || 0;
			total += n;
			const seg = (r.cluster as string | null)?.trim() || '';
			segmentos[seg] = (segmentos[seg] ?? 0) + n;
			const per = (r.persona_usuario as string | null)?.trim() || '';
			personas[per] = (personas[per] ?? 0) + n;
		}
		if (data.length < 1000) break;
		from += 1000;
	}
	return { segmentos, personas, total };
}

export function salvarAntes(credorId: string, snap: ContagemSnapshot) {
	if (typeof window === 'undefined') return;
	localStorage.setItem(ANTES_KEY(credorId), JSON.stringify(snap));
}

export function carregarAntes(credorId: string): ContagemSnapshot | null {
	if (typeof window === 'undefined') return null;
	const raw = localStorage.getItem(ANTES_KEY(credorId));
	if (!raw) return null;
	try {
		return JSON.parse(raw) as ContagemSnapshot;
	} catch {
		return null;
	}
}

export function limparAntes(credorId: string) {
	if (typeof window === 'undefined') return;
	localStorage.removeItem(ANTES_KEY(credorId));
}

/** Insere um pedido de rotina para a carteira. A empresa é preenchida pelo banco. */
export async function pedirReenquadramento(
	credorId: string,
): Promise<{ ok: boolean; duplicado: boolean; erro: string }> {
	if (!supabase) return { ok: false, duplicado: false, erro: 'Configuração ausente' };
	const { error } = await supabase.from('pedidos_rotina').insert({ credor_id: credorId });
	if (!error) return { ok: true, duplicado: false, erro: '' };
	const code = (error as { code?: string }).code ?? '';
	const msg = String(error.message ?? '').toLowerCase();
	// unique violation → já existe pedido pendente/rodando na fila da carteira
	if (code === '23505' || msg.includes('unique') || msg.includes('duplic') || msg.includes('violates')) {
		return { ok: false, duplicado: true, erro: '' };
	}
	return { ok: false, duplicado: false, erro: 'Não foi possível pedir o reenquadramento. Tente novamente.' };
}

/** Último pedido da carteira (mais recente primeiro). */
export async function fetchUltimoPedido(credorId: string): Promise<PedidoRotina | null> {
	if (!supabase) return null;
	const { data, error } = await supabase
		.from('pedidos_rotina')
		.select('id,empresa_id,credor_id,status,pedido_em,iniciado_em,terminado_em,execucao_id,erro')
		.eq('credor_id', credorId)
		.order('pedido_em', { ascending: false })
		.order('id', { ascending: false })
		.limit(1)
		.maybeSingle();
	if (error) return null;
	return (data ?? null) as PedidoRotina | null;
}

/** Hora (HH:mm) no fuso de São Paulo a partir de um timestamp ISO. */
export function horaBR(v: string | null): string {
	if (!v) return '—';
	try {
		return new Intl.DateTimeFormat('pt-BR', {
			timeZone: 'America/Sao_Paulo',
			hour: '2-digit',
			minute: '2-digit',
		}).format(new Date(String(v)));
	} catch {
		return '—';
	}
}
