// Chamadas da sessão de treino por texto à Edge Function `treino` (SQL 100). Pelo link vai o token do operador; logado
// (treino lado a lado e teste do cenário), o supabase-js manda o login da pessoa. Erros viram a frase da função.
import { supabase } from '@/lib/supabase';
import { erroDaFuncao, lerErroDaFuncao } from '@/lib/funcoes';
import type { RespostaEncerrar, RespostaTurno } from '@/lib/treino-sessao';
import type { Chamar, ResultadoChamada } from './sessao';

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
