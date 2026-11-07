// Estágios da estratégia como o motor os lê (uma lista só para os passos Estágios, Régua e Revisar).
//
// O modelo do motor (motor/estrategia.py › validar_estrategia + aplicar; motor/etapas.py):
// - As 5 fases (localizacao, cpc, giro, preventivo, quebra) SEMPRE existem. Cada uma:
//   · `ativo: false`            → desligada: ninguém dessa fase recebe ação;
//   · sem a chave `passos`      → segue a régua padrão do motor (regras/regua.json);
//   · `passos` com algum dia    → a régua própria da estratégia;
//   · `passos` sem nenhum dia   → sobrescreve o padrão com NADA: ninguém dessa fase recebe ação.
//   Deu CPC (cpc) não tem passos: sem `ordem` segue a ordem de rotação padrão do motor.
// - As etapas (definicao.etapas) são estágios próprios por cima das fases, na ordem de `ordem_etapas`.
//   Etapa sem régua (nenhum dia com ação) é ignorada pelo motor: quem cairia nela segue para o próximo.
import { FASES_ORDEM, faseLabel, isFaseId, ordemStages, playbookDefinicao, type Definicao, type FaseId, type Passos } from '@/lib/estrategia';

export type SituacaoRegua = 'desligado' | 'propria' | 'padrao' | 'vazia';

export type EstagioDaEstrategia = {
	id: string;
	nome: string;
	tipo: 'fase' | 'etapa';
	ativo: boolean;
	regua: SituacaoRegua;
	/** Frase curta do que o motor faz com o estágio (ex.: "segue a régua padrão do motor"). */
	texto: string;
};

function temAcao(passos: Passos | undefined | null): boolean {
	if (!passos || typeof passos !== 'object') return false;
	return Object.values(passos).some(arr => Array.isArray(arr) && arr.length > 0);
}

/** O que o motor faz com uma das 5 fases desta estratégia. */
export function situacaoReguaFase(def: Definicao, fase: FaseId): SituacaoRegua {
	const obj = def[fase] as Record<string, unknown> | undefined;
	if (obj && obj.ativo === false) return 'desligado';
	if (fase === 'cpc') {
		const ordem = (obj?.ordem as { canal?: string }[] | undefined) ?? [];
		return ordem.some(a => a && a.canal) ? 'propria' : 'padrao';
	}
	if (!obj || !('passos' in obj) || obj.passos == null) return 'padrao';
	return temAcao(obj.passos as Passos) ? 'propria' : 'vazia';
}

export function textoSituacao(s: SituacaoRegua, tipo: 'fase' | 'etapa', fase?: FaseId): string {
	if (s === 'desligado') return 'desligado: ninguém aqui recebe ação';
	if (s === 'propria') return 'régua própria';
	if (s === 'padrao') return fase === 'cpc' ? 'segue a ordem padrão do motor' : 'segue a régua padrão do motor';
	return tipo === 'etapa' ? 'sem régua: o motor ignora este estágio' : 'sem régua: ninguém aqui recebe ação';
}

/** Os estágios da estratégia, na ordem de prioridade (a mesma do passo Estágios). */
export function estagiosDaEstrategia(def: Definicao): EstagioDaEstrategia[] {
	const etapas = new Map((def.etapas ?? []).map(e => [e.id, e]));
	return ordemStages(def).map(id => {
		if (isFaseId(id)) {
			const regua = situacaoReguaFase(def, id);
			return { id, nome: faseLabel(def, id), tipo: 'fase' as const, ativo: regua !== 'desligado', regua, texto: textoSituacao(regua, 'fase', id) };
		}
		const e = etapas.get(id);
		const ativo = e?.ativo !== false;
		const regua: SituacaoRegua = !ativo ? 'desligado' : temAcao(e?.passos) ? 'propria' : 'vazia';
		return { id, nome: e?.nome ?? id, tipo: 'etapa' as const, ativo, regua, texto: textoSituacao(regua, 'etapa') };
	});
}

/** Algum estágio pega cliente e faz algo? (fase ligada ou etapa ligada) */
export function algumEstagioLigado(def: Definicao): boolean {
	return estagiosDaEstrategia(def).some(e => e.ativo);
}

/**
 * Avisos de "fica sem estágio" agrupados: com nenhum estágio ligado (ou muitas fases descobertas),
 * uma mensagem só; com poucas, uma por fase.
 */
export type AvisoSemEstagio =
	| { tipo: 'nenhum'; texto: string }
	| { tipo: 'varias'; texto: string }
	| { tipo: 'detalhe'; itens: string[] }
	| { tipo: 'ok' };

export const LIMITE_AVISOS_DETALHADOS = 2;

export function avisoSemEstagio(def: Definicao, descobertas: FaseId[], clientes?: number | null): AvisoSemEstagio {
	if (descobertas.length === 0) return { tipo: 'ok' };
	const quantos = clientes != null && clientes > 0
		? `os ${clientes.toLocaleString('pt-BR')} cliente${clientes === 1 ? '' : 's'} deste segmento ficam`
		: 'os clientes deste segmento ficam';
	if (!algumEstagioLigado(def)) {
		return { tipo: 'nenhum', texto: `Nenhum estágio ligado: ${quantos} sem estágio. Ligue pelo menos um.` };
	}
	const nomes = descobertas.map(f => faseLabel(def, f));
	if (descobertas.length > LIMITE_AVISOS_DETALHADOS) {
		return { tipo: 'varias', texto: `${descobertas.length} estágios desligados ficam sem estágio (${nomes.join(', ')}): quem está neles não recebe ação.` };
	}
	return { tipo: 'detalhe', itens: nomes.map(n => `Quem está em ${n} fica sem estágio.`) };
}

/** Copia a régua padrão do motor para a fase (vira régua própria, editável). Mantém o resto da fase. */
export function copiarReguaPadrao(def: Definicao, fase: FaseId): Definicao {
	const pb = playbookDefinicao();
	const atual = (def[fase] ?? {}) as Record<string, unknown>;
	if (fase === 'cpc') {
		return { ...def, cpc: { ...pb.cpc!, ...atual, ordem: pb.cpc!.ordem, junto: pb.cpc!.junto, ativo: true } as Definicao['cpc'] };
	}
	const origem = pb[fase] as { passos: Passos } | undefined;
	return { ...def, [fase]: { ...atual, ativo: true, passos: JSON.parse(JSON.stringify(origem?.passos ?? {})) } } as Definicao;
}

/** Fases na ordem de exibição do rodapé (útil para testes e para a Revisão). */
export const FASES = FASES_ORDEM;

/** Nome da estratégia criada a partir de um modelo: "<Modelo> · <Segmento>", sem cortar no meio. */
export function nomeEstrategiaModelo(modelo: string, segmento: string, limite = 80): string {
	const m = modelo.trim() || 'Estratégia';
	const s = segmento.trim();
	const nome = s ? `${m} · ${s}` : m;
	if (nome.length <= limite) return nome;
	// corta na última palavra inteira que cabe, com reticências
	const corte = nome.slice(0, limite - 1);
	const i = corte.lastIndexOf(' ');
	return `${(i > limite / 2 ? corte.slice(0, i) : corte).replace(/[\s·]+$/, '')}…`;
}
