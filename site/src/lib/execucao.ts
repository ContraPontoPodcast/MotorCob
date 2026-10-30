// Última execução da carteira para uma data: resumo de "sem ação" e próximos dias.
// O site só faz SELECT em execucoes; nada é criado/alterado.
import { supabase, type Row } from '@/lib/supabase';

export const SEM_ACAO_LABELS: Record<string, string> = {
	com_acao: 'Com ação hoje',
	sem_passo_hoje: 'A esteira não tem passo hoje (ex.: D+2)',
	sem_contato: 'Sem contato para os canais do dia',
	sem_acao_na_raia: "Persona com 'sem ação' hoje",
	bureau_hoje: 'Só enriquecimento hoje',
	outro_credor: 'Acionados por outra carteira nas últimas 48h',
	demais_desligado: 'Demais clientes desligado',
	fora_da_carga: 'Fora da carga (retirados/quitados)',
	encerrado: 'Bloqueados, liquidados ou encerrados',
	domingo_feriado: 'Domingo ou feriado',
};

export const SEM_ACAO_SHORT: Record<string, string> = {
	com_acao: 'com ação',
	sem_passo_hoje: 'sem passo hoje',
	sem_contato: 'sem contato',
	sem_acao_na_raia: 'sem ação na raia',
	bureau_hoje: 'só bureau',
	outro_credor: 'outro credor',
	demais_desligado: 'demais desligado',
	fora_da_carga: 'fora da carga',
	encerrado: 'encerrado',
	domingo_feriado: 'domingo/feriado',
};

export type ProximoDia = {
	data: string;
	clientes: number;
	passos: Record<string, number>;
	sem_acoes?: boolean;
};

export type ResumoExecucao = {
	sem_acao?: Record<string, number>;
	proximos?: ProximoDia[];
	retorno_canal?: import('@/lib/canal-retorno').RetornoCanalResumo | null;
};

export type Execucao = {
	resumo: ResumoExecucao | null;
	iniciada_em: string | null;
	status: string | null;
};

/** Última execução da carteira para a data escolhida (mais recente primeiro). */
export async function fetchExecucao(
	empresaId: string,
	credorId: string,
	data: string,
): Promise<Execucao | null> {
	if (!supabase) return null;
	const { data: rows, error } = await supabase
		.from('execucoes')
		.select('resumo, iniciada_em, status')
		.eq('empresa_id', empresaId)
		.eq('credor_id', credorId)
		.eq('data_ref', data)
		.order('iniciada_em', { ascending: false })
		.limit(1);
	if (error || !rows || rows.length === 0) return null;
	const r = rows[0] as Row;
	return {
		resumo: (r.resumo as ResumoExecucao | null) ?? null,
		iniciada_em: (r.iniciada_em as string | null) ?? null,
		status: (r.status as string | null) ?? null,
	};
}

/** "segunda-feira, 06/10" a partir de uma data ISO yyyy-mm-dd, no fuso de São Paulo. */
export function diaSemanaDataBR(data: string): string {
	try {
		const d = new Date(`${data}T12:00:00-03:00`);
		const s = new Intl.DateTimeFormat('pt-BR', {
			timeZone: 'America/Sao_Paulo',
			weekday: 'long',
			day: '2-digit',
			month: '2-digit',
		}).format(d);
		return s.charAt(0).toUpperCase() + s.slice(1);
	} catch {
		return data;
	}
}

/** Lista de motivos sem_acao ordenada do maior para o menor, com rótulo e total. */
export function semAcaoEntradas(semAcao: Record<string, number> | undefined) {
	if (!semAcao) return [];
	return Object.entries(semAcao)
		.map(([k, v]) => ({ key: k, valor: Number(v) || 0, label: SEM_ACAO_LABELS[k] ?? k, short: SEM_ACAO_SHORT[k] ?? k }))
		.filter(e => e.valor > 0)
		.sort((a, b) => b.valor - a.valor);
}
