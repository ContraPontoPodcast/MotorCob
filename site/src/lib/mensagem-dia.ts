// Helpers para o campo `mensagem` de cada ação de dia (modelo de frases por dia).
import type { Acao, Definicao, Passos, MensagemAcao, MensagemRef } from '@/lib/estrategia';
import type { Frase } from '@/lib/frases';
import { canalTipoMensagem, templateCodigoOf } from '@/lib/frases';

type FrasesMap = Map<string, Frase>;

/** Lê o MensagemRef relevante de uma ação (canal comum, CPC ou persona). */
export function getMensagemRef(a: Acao): MensagemRef | undefined {
	if (a.mensagem == null) return undefined;
	const m = a.mensagem;
	if (typeof m === 'string') return m;
	if ('frase_id' in m) return m as MensagemRef;
	// objeto: CPC (cpa/cpb) ou persona (mapa por canal) — pega o primeiro
	const obj = m as Record<string, MensagemRef>;
	const vals = Object.values(obj);
	return vals[0];
}

/** True se a ação tem alguma mensagem configurada. */
export function hasMensagem(a: Acao): boolean {
	return getMensagemRef(a) != null;
}

/** Coleta todos os MensagemRef de uma MensagemAcao (simples, CPC cpa/cpb ou persona por canal). */
export function mensagemRefs(m: MensagemAcao | undefined): MensagemRef[] {
	if (m == null) return [];
	if (typeof m === 'string' || 'frase_id' in m) return [m as MensagemRef];
	const obj = m as Record<string, MensagemRef>;
	return Object.values(obj).filter(v => v != null) as MensagemRef[];
}

/** Status agregado de uma mensagem CPC (cpa/cpb) ou simples — vermelho se qualquer frase estiver desativada/apagada. */
export function cpcMensagemStatus(m: MensagemAcao | undefined, frasesPorId: FrasesMap): MensagemStatus {
	const refs = mensagemRefs(m);
	if (refs.length === 0) return 'nenhuma';
	let hasFrase = false;
	let hasTexto = false;
	for (const r of refs) {
		if (typeof r === 'string') hasTexto = true;
		else if ('frase_id' in r) {
			const f = frasesPorId.get(r.frase_id);
			if (!f || !f.ativo) return 'desativada';
			hasFrase = true;
		}
	}
	return hasTexto ? 'texto' : 'frase';
}

/** Rótulo curto agregado de uma mensagem CPC (nomes das frases ou começo dos textos). */
export function cpcMensagemLabel(m: MensagemAcao | undefined, frasesPorId: FrasesMap, canal?: string): string {
	const refs = mensagemRefs(m);
	if (refs.length === 0) return '';
	const isTemplate = canal ? canalTipoMensagem(canal) === 'template' : false;
	const parts: string[] = [];
	for (const r of refs) {
		if (typeof r === 'string') parts.push(r.slice(0, 40));
		else if ('frase_id' in r) {
			const f = frasesPorId.get(r.frase_id);
			if (!f) parts.push('frase removida');
			else parts.push(isTemplate ? (templateCodigoOf(f) || f.nome) : f.nome);
		}
	}
	return parts.join(' · ');
}

/** Status agregado do mensagem_hot (mapa por canal do CPC). */
export function cpcHotStatus(mensagem_hot: Record<string, MensagemAcao> | undefined, frasesPorId: FrasesMap): MensagemStatus {
	if (!mensagem_hot) return 'nenhuma';
	const vals = Object.values(mensagem_hot);
	if (vals.length === 0) return 'nenhuma';
	let hasFrase = false;
	let hasTexto = false;
	for (const v of vals) {
		const s = cpcMensagemStatus(v, frasesPorId);
		if (s === 'desativada') return 'desativada';
		if (s === 'frase') hasFrase = true;
		if (s === 'texto') hasTexto = true;
	}
	return hasTexto ? 'texto' : hasFrase ? 'frase' : 'nenhuma';
}

/** Coleta todos os frase_id referenciados na mensagem de uma ação. */
export function fraseIdsNaMensagem(a: Acao): string[] {
	const ids: string[] = [];
	function collect(r: MensagemRef | undefined) {
		if (r && typeof r === 'object' && 'frase_id' in r) ids.push(r.frase_id);
	}
	if (a.mensagem == null) return ids;
	if (typeof a.mensagem === 'string' || 'frase_id' in a.mensagem) collect(a.mensagem as MensagemRef);
	else for (const v of Object.values(a.mensagem as Record<string, MensagemRef>)) collect(v);
	return ids;
}

export type MensagemStatus = 'nenhuma' | 'texto' | 'frase' | 'desativada';

/** Status da mensagem de uma ação para o balão 💬. */
export function mensagemStatus(a: Acao, frasesPorId: FrasesMap): MensagemStatus {
	const ref = getMensagemRef(a);
	if (ref == null) return 'nenhuma';
	if (typeof ref === 'string') return 'texto';
	if ('frase_id' in ref) {
		const f = frasesPorId.get(ref.frase_id);
		return f && f.ativo ? 'frase' : 'desativada';
	}
	return 'nenhuma';
}

/** Rótulo curto da mensagem (código do template para WhatsApp/RCS, nome da frase para SMS/Agente). */
export function mensagemLabel(a: Acao, frasesPorId: FrasesMap): string {
	const ref = getMensagemRef(a);
	if (ref == null) return '';
	if (typeof ref === 'string') return ref.slice(0, 60);
	if ('frase_id' in ref) {
		const f = frasesPorId.get(ref.frase_id);
		if (!f) return 'frase removida';
		return canalTipoMensagem(a.canal) === 'template' ? (templateCodigoOf(f) || f.nome) : f.nome;
	}
	return '';
}

/** True se alguma frase da faixa está desativada ou apagada no playbook. */
export function faixaTemFraseDesativada(passos: Passos, frasesPorId: FrasesMap): boolean {
	for (const arr of Object.values(passos)) {
		for (const a of arr) {
			if (mensagemStatus(a, frasesPorId) === 'desativada') return true;
		}
	}
	return false;
}

/** Conta ações com frase vs. total de ações ativas numa faixa (discador/e-mail/enriquecimento não contam). */
export function contagemFrasesFaixa(passos: Passos): { comFrase: number; total: number } {
	let comFrase = 0;
	let total = 0;
	for (const arr of Object.values(passos)) {
		for (const a of arr) {
			if (canalTipoMensagem(a.canal) === 'nenhuma') continue;
			total++;
			if (hasMensagem(a)) comFrase++;
		}
	}
	return { comFrase, total };
}

/** Migra definicao.mensagens (grade antiga) para o modelo por dia.
 *  Copia a frase de cada estágio × canal para todas as ações daquela faixa e canal
 *  que ainda não têm "mensagem". Retorna a nova definição sem `mensagens`. */
export function migrarMensagensParaDias(def: import('@/lib/estrategia').Definicao): import('@/lib/estrategia').Definicao {
	const mensagens = def.mensagens;
	if (!mensagens) return def;
	const next = { ...def };
	delete next.mensagens;

	// mapa estágio → faixa
	const estagioFaixa: Record<string, { passosKey: keyof typeof next; estagioCpc?: 'cpa' | 'cpb' }> = {
		localizacao: { passosKey: 'localizacao' },
		giro: { passosKey: 'giro' },
		preventivo: { passosKey: 'preventivo' },
		quebra: { passosKey: 'quebra' },
		cpc_a: { passosKey: 'cpc', estagioCpc: 'cpa' },
		cpc_b: { passosKey: 'cpc', estagioCpc: 'cpb' },
	};

	for (const [estagio, canais] of Object.entries(mensagens)) {
		const alvo = estagioFaixa[estagio];
		if (!alvo) continue;
		for (const [canal, celula] of Object.entries(canais)) {
			if (!celula) continue;
			const ref: MensagemRef | undefined = celula.frase_id ? { frase_id: celula.frase_id } : celula.texto ?? undefined;
			if (!ref) continue;

			if (alvo.passosKey === 'cpc') {
				// CPC: ordem e junto
				const cpc = next.cpc;
				if (!cpc) continue;
				const aplicarCpc = (acoes: Acao[]) => acoes.map(a => {
					if (a.canal !== canal || hasMensagem(a)) return a;
					if (alvo.estagioCpc === 'cpa' || alvo.estagioCpc === 'cpb') {
						const obj = (a.mensagem && typeof a.mensagem === 'object' && !('frase_id' in a.mensagem) ? a.mensagem : {}) as Record<string, MensagemRef>;
						return { ...a, mensagem: { ...obj, [alvo.estagioCpc]: ref } };
					}
					return { ...a, mensagem: ref };
				});
				next.cpc = { ...cpc, ordem: aplicarCpc(cpc.ordem ?? []), junto: aplicarCpc(cpc.junto ?? []) };
			} else {
				const faixa = next[alvo.passosKey as 'localizacao' | 'giro' | 'preventivo' | 'quebra'];
				if (!faixa?.passos) continue;
				const novosPassos: Passos = {};
				for (const [dia, acoes] of Object.entries(faixa.passos)) {
					novosPassos[dia] = acoes.map(a => {
						if (a.canal !== canal || hasMensagem(a)) return a;
						return { ...a, mensagem: ref };
					});
				}
				(next as Record<string, unknown>)[alvo.passosKey] = { ...faixa, passos: novosPassos };
			}
		}
	}
	return next;
}

/** Remove o campo `mensagem` de toda ação cujo canal não usa mensagem
 *  (Discador, E-mail, Enriquecimento). Vale ao salvar a estratégia. */
export function removerMensagensCanaisSemMensagem(def: Definicao): Definicao {
	const limparPassos = (passos?: Passos): Passos | undefined => {
		if (!passos) return passos;
		const out: Passos = {};
		for (const [k, arr] of Object.entries(passos)) {
			out[k] = arr.map(a => canalTipoMensagem(a.canal) === 'nenhuma' ? { ...a, mensagem: undefined } : a);
		}
		return out;
	};
	const next: Definicao = { ...def };
	if (next.localizacao) next.localizacao = { ...next.localizacao, passos: limparPassos(next.localizacao.passos) ?? {} };
	if (next.giro) next.giro = { ...next.giro, passos: limparPassos(next.giro.passos) ?? {} };
	if (next.preventivo) next.preventivo = { ...next.preventivo, passos: limparPassos(next.preventivo.passos) ?? {} };
	if (next.quebra) next.quebra = { ...next.quebra, passos: limparPassos(next.quebra.passos) ?? {} };
	if (next.cpc) {
		const cpc = { ...next.cpc };
		cpc.ordem = (cpc.ordem ?? []).map(a => canalTipoMensagem(a.canal) === 'nenhuma' ? { ...a, mensagem: undefined } : a);
		cpc.junto = (cpc.junto ?? []).map(a => canalTipoMensagem(a.canal) === 'nenhuma' ? { ...a, mensagem: undefined } : a);
		if (cpc.mensagem_hot) {
			const mh: Record<string, MensagemAcao> = {};
			for (const [c, m] of Object.entries(cpc.mensagem_hot)) {
				if (canalTipoMensagem(c) !== 'nenhuma') mh[c] = m;
			}
			cpc.mensagem_hot = Object.keys(mh).length ? mh : undefined;
		}
		next.cpc = cpc;
	}
	return next;
}
