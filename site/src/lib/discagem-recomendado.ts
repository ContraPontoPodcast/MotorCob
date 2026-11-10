// Agente Voz/CX › Discagem: os padrões recomendados da revisão do especialista (PR 8 do plano Canais/Agente Voz/CX;
// REVISAO_ESPECIALISTA.md D2 "Padrões de renitência" e D3 "Posição e rodízio do número").
// Regras puras (sem React, sem Supabase). O padrão MotorCX do banco e do motor NÃO muda: a tela mostra a tabela
// recomendada, compara com o que vale na carteira e aplica com um clique no rascunho. Só vale depois de "Salvar como
// vN" (salvar_discagem: validação, versão e Auditoria), como qualquer outra mudança da Discagem.
// Motivo (D2): cada tentativa evitada em número que não atende reduz as chamadas curtas (Anatel, 12/11/2026).
import {
	efetivo, idxSpins, HOJE_SIN, modoDaCarteira, mudarCampo, mudarModo, mudarSinal, sinalDaCarteira, telefonesDia, MODOS, ORDENS,
	type DiscagemRen, type RegraSinal,
} from './renitencia';

/** Uma linha da tabela D2. `aplica` muda o rascunho; `confere` diz se a carteira já está assim. */
export type LinhaRecomendada = {
	k: string; situacao: string; rediscar: string; maxDia: string; depois: string;
	aplica?: (d: DiscagemRen) => DiscagemRen;
	confere?: (d: DiscagemRen) => boolean;
};

const sinal = (d: DiscagemRen, k: string): RegraSinal | null => efetivo(d).sinal?.[k] ?? null;
const maxDia = (d: DiscagemRen, k: string) => efetivo(d).ren[k]?.max_dia;

/** Redisca o mesmo número depois de `min` (até max_dia − 1 vezes) e, esgotado, vai para `acao`. */
function rediscar(k: string, min: number, max: number, acao: RegraSinal['depois']['acao']) {
	return {
		aplica: (d: DiscagemRen) => {
			let x = mudarSinal(d, k, 'rediscar.ativo', true);
			x = mudarSinal(x, k, 'rediscar.depois_min', min);
			x = mudarSinal(x, k, 'rediscar.max', Math.max(1, max - 1));
			x = mudarSinal(x, k, 'depois.acao', acao);
			return k === 'indisponivel' ? x : mudarCampo(x, 'por_situacao', k, 'max_dia', max);
		},
		confere: (d: DiscagemRen) => {
			const r = sinal(d, k);
			return !!r && !r.finaliza && r.rediscar.ativo && r.rediscar.depois_min === min && r.rediscar.max === Math.max(1, max - 1)
				&& r.depois.acao === acao && (k === 'indisponivel' || maxDia(d, k) === max);
		},
	};
}

/** Uma tentativa por dia no número e, depois, `acao` (sem rediscar no dia). */
function semRediscar(k: string, acao: RegraSinal['depois']['acao']) {
	return {
		aplica: (d: DiscagemRen) => mudarCampo(mudarSinal(mudarSinal(d, k, 'rediscar.ativo', false), k, 'depois.acao', acao), 'por_situacao', k, 'max_dia', 1),
		confere: (d: DiscagemRen) => {
			const r = sinal(d, k);
			return !!r && !r.finaliza && !r.rediscar.ativo && r.depois.acao === acao && maxDia(d, k) === 1;
		},
	};
}

function liga(campo: 'descanso_nao_atende' | 'descanso_recusa' | 'promessa_suspende') {
	const base = { descanso_nao_atende: { ativo: true, n: 6, em_dias: 3, descansa_dias: 7 }, descanso_recusa: { ativo: true, dias: 7 }, promessa_suspende: { ativo: true, dias_sem_data: 7 } }[campo];
	return {
		aplica: (d: DiscagemRen) => ({ ...d, [campo]: { ...base, ...(d[campo] ?? {}), ativo: true } }),
		confere: (d: DiscagemRen) => d[campo]?.ativo === true,
	};
}

/** A tabela D2 (ordem da revisão). As linhas sem `aplica` já valem assim hoje (só informativas). */
export const RENITENCIA_RECOMENDADA: LinhaRecomendada[] = [
	{ k: 'ocupado', situacao: 'Ocupado', rediscar: '15 min', maxDia: '2', depois: 'próximo telefone', ...rediscar('ocupado', 15, 2, 'proximo_telefone') },
	{ k: 'nao_atendida', situacao: 'Não atende', rediscar: '120 min', maxDia: '2', depois: 'descanso: 6 “não atende” em 3 dias → 7 dias sem ligar',
		aplica: d => liga('descanso_nao_atende').aplica(rediscar('nao_atendida', 120, 2, 'proximo_cliente').aplica(d)),
		confere: d => rediscar('nao_atendida', 120, 2, 'proximo_cliente').confere(d) && liga('descanso_nao_atende').confere(d) },
	{ k: 'caixa_postal', situacao: 'Caixa postal', rediscar: 'não redisca no dia', maxDia: '1', depois: 'próximo telefone; conta para o descanso', ...semRediscar('caixa_postal', 'proximo_telefone') },
	{ k: 'desligou_sem_conversar', situacao: 'Atendeu e desligou (“alô e desliga”)', rediscar: 'amanhã, em outro horário', maxDia: '1', depois: 'próximo cliente', ...semRediscar('desligou_sem_conversar', 'proximo_cliente') },
	{ k: 'indisponivel', situacao: 'Fora de área ou desligado', rediscar: '60 min', maxDia: '2', depois: 'próximo telefone; não penaliza o número', ...rediscar('indisponivel', 60, 2, 'proximo_telefone') },
	{ k: 'mudo', situacao: 'Mudo ou silêncio', rediscar: 'como Não atende', maxDia: '—', depois: 'não penaliza o número (pode ser a rede)' },
	{ k: 'recusa', situacao: 'Recusa', rediscar: '—', maxDia: '—', depois: '7 dias sem voz', ...liga('descanso_recusa') },
	{ k: 'promessa', situacao: 'Promessa', rediscar: '—', maxDia: '—', depois: 'voz suspensa até a data + 1', ...liga('promessa_suspende') },
	{ k: 'retorno_agendado', situacao: 'Retorno agendado', rediscar: 'no horário pedido', maxDia: '—', depois: 'já é assim' },
	{ k: 'inexistente', situacao: 'Inexistente', rediscar: '—', maxDia: '—', depois: '2 confirmações em dias diferentes (já é assim)' },
];

/** Aplica a tabela D2 inteira no rascunho. Fixa 2 tentativas por número (a regra nova subiria para 3). */
export function aplicarRenitenciaRecomendada(d: DiscagemRen): DiscagemRen {
	let x: DiscagemRen = { ...d, tentativas_numero_dia: 2 };
	for (const l of RENITENCIA_RECOMENDADA) if (l.aplica) x = l.aplica(x);
	return x;
}

/** As situações em que a carteira está diferente da tabela D2 (vazio = já está nos padrões recomendados). */
export function foraDoRecomendado(d: DiscagemRen | null | undefined): string[] {
	const x = d ?? {};
	return RENITENCIA_RECOMENDADA.filter(l => l.confere && !l.confere(x)).map(l => l.situacao);
}

/** O que vale hoje na carteira, em poucas palavras, para a coluna "Nesta carteira". */
export function hojeNaCarteira(d: DiscagemRen | null | undefined, k: string): string {
	const x = d ?? {};
	const e = efetivo(x);
	if (k === 'recusa') return e.recusa ? `${e.recusaDias} dias sem voz` : 'desligado';
	if (k === 'promessa') return e.promessa ? 'suspende a voz' : 'desligado';
	const l = RENITENCIA_RECOMENDADA.find(y => y.k === k);
	if (!l?.confere) return '—';
	const { ativa, regras } = sinalDaCarteira(x);
	const r = regras[k];
	const max = k === 'indisponivel' ? e.tnum : e.ren[k]?.max_dia;
	const partes = [
		!ativa ? (HOJE_SIN[k]?.txt ?? '—') : r.finaliza ? 'finaliza no dia' : r.rediscar.ativo ? `${r.rediscar.depois_min} min` : 'não redisca',
		ativa && max != null ? `máx. ${max} no dia` : '',
		k === 'nao_atendida' ? (e.naOn ? 'descanso ligado' : 'descanso desligado') : '',
	].filter(Boolean);
	return partes.join(' · ');
}

// ---------------------------------------------------------------- D3 · Posição do número
/** Recomendado: no máximo 2 telefones por cliente no dia, horizontal (spin 1 = telefone 1, spin 2 = telefone 2). */
export const POSICAO_RECOMENDADA = 'No máximo 2 telefones por cliente no dia, horizontal: na 1ª passada o telefone 1, na 2ª o telefone 2.';

export function aplicarPosicaoRecomendada(d: DiscagemRen): DiscagemRen {
	return mudarModo(d, m => ({
		...m, modo: 'horizontal',
		spins: { ...m.spins, quantidade: 2, regras: [{ spin: 1, telefone: 't1', inicio: null }, { spin: 2, telefone: 't2', inicio: null }] },
	}));
}

export function posicaoNoRecomendado(d: DiscagemRen | null | undefined): boolean {
	const { ativo, m } = modoDaCarteira(d);
	return ativo && m.modo === 'horizontal' && m.spins.quantidade === 2 && idxSpins(m).join(',') === '1,2';
}

/** "Horizontal · 2 telefones por cliente no dia · Certificado primeiro" ou o de antes (1 telefone de voz por cliente). */
export function resumoPosicao(d: DiscagemRen | null | undefined): string {
	const { ativo, m } = modoDaCarteira(d);
	if (!ativo) return '1 telefone de voz por cliente no dia (o padrão de antes)';
	const n = telefonesDia(m);
	return `${MODOS[m.modo]} · ${n} ${n === 1 ? 'telefone' : 'telefones'} por cliente no dia · ${ORDENS[m.ordem]}`;
}
