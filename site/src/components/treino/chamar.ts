// Chamadas da sessão de treino à Edge Function `treino`: por texto (SQL 100) e por voz (SQL 119: o bilhete do WebSocket e o
// "Ouvir a voz"). Pelo link vai o token do operador; logado (treino lado a lado e teste do cenário), o supabase-js manda o
// login da pessoa. Erros viram a frase da função.
import { supabase } from '@/lib/supabase';
import { erroDaFuncao, lerErroDaFuncao } from '@/lib/funcoes';
import type { RespostaEncerrar, RespostaTurno } from '@/lib/treino-sessao';
import type { Chamar, ResultadoChamada } from './sessao';
import type { BilheteVoz, ChamarVoz, PedirPrevia } from './voz';

async function invocar<T>(corpo: Record<string, unknown>): Promise<ResultadoChamada<T>> {
	if (!supabase) return { erro: 'Configuração ausente.' };
	const { data, error } = await supabase.functions.invoke('treino', { body: corpo });
	if (error || (data && typeof data === 'object' && 'erro' in data)) {
		const { status } = await lerErroDaFuncao(error, data);
		return { erro: (await erroDaFuncao(error, data, 'O treino não respondeu agora. Tente de novo.')) ?? 'O treino não respondeu agora.', status };
	}
	return { data: data as T };
}

export function chamarTreino(sessao: number, token: string | null): Chamar {
	const base = { sessao, ...(token ? { token } : {}) };
	return {
		turno: (texto?: string) => invocar<RespostaTurno>({ ...base, acao: 'turno', ...(texto ? { texto } : {}) }),
		encerrar: () => invocar<RespostaEncerrar>({ ...base, acao: 'encerrar' }),
		sair: () => invocar<{ situacao: string }>({ ...base, acao: 'sair' }),
	};
}

export function chamarVoz(sessao: number, token: string | null): ChamarVoz {
	const base = { sessao, ...(token ? { token } : {}) };
	return {
		bilhete: () => invocar<BilheteVoz>({ ...base, acao: 'voz' }),
		sair: () => invocar<{ situacao: string }>({ ...base, acao: 'sair' }),
	};
}

/** "Ouvir a voz" da cliente simulada antes de começar: pelo link (token + atribuição) ou logado (cenário + empresa). */
export function previaVoz(a: { token: string; atribuicao: number } | { cenario: number; empresa: number }): PedirPrevia {
	return () => invocar<{ audio: string; mime: string }>({ acao: 'ouvir', ...a });
}
