// Recuperação por ação (SQL 77): leitura das linhas da RPC recuperacao_por_acao (só agregados).

export type LinhaRecuperacao = {
	canal: string; persona: string; acoes: number; cpcs: number; taxa_cpc: number | null; acordos: number;
	pagamentos: number; valor_pago: number; custo: number; recuperado_por_real: number | null;
};

export const PERIODOS_RECUPERACAO = [30, 90, 180] as const;

export const NOME_CANAL_RECUPERACAO: Record<string, string> = {
	whatsapp: 'WhatsApp', rcs: 'RCS', agente_voz: 'Agente virtual', discador: 'Discador', sms: 'SMS', email: 'E-mail',
};

const num = (v: unknown) => (v == null ? 0 : Number(v));
const talvez = (v: unknown) => (v == null ? null : Number(v));

/** Período fechado até ontem (a rotina publica o dia anterior), em datas ISO. */
export function periodoRecuperacao(hoje: Date, dias: number): { de: string; ate: string } {
	const ate = new Date(hoje.getTime() - 86_400_000).toISOString().slice(0, 10);
	const de = new Date(hoje.getTime() - dias * 86_400_000).toISOString().slice(0, 10);
	return { de, ate };
}

export function lerLinhasRecuperacao(data: unknown): LinhaRecuperacao[] {
	return ((data ?? []) as Record<string, unknown>[]).map(r => ({
		canal: String(r.canal ?? ''), persona: String(r.persona ?? ''), acoes: num(r.acoes), cpcs: num(r.cpcs),
		taxa_cpc: talvez(r.taxa_cpc), acordos: num(r.acordos), pagamentos: num(r.pagamentos), valor_pago: num(r.valor_pago),
		custo: num(r.custo), recuperado_por_real: talvez(r.recuperado_por_real),
	}));
}
