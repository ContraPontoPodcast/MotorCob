// Prévia de segmentação (SQL 76): quantos clientes cairiam em cada segmento HOJE, na ordem da empresa.
//
// O banco conta (`previa_segmentacao`, só contagens; nenhum cliente sai de lá) com a mesma regra do motor
// (`motor/cluster.py › condicao_ok`; o cliente fica no 1º segmento em que se encaixa). O site só monta a proposta:
// os segmentos em uso na carteira, na ordem (ordem, código — como `carregar_regras`), com o segmento que está sendo
// editado no lugar dele (ou no fim, se for novo) e as condições já normalizadas (números como número JSON).

import type { Condicao } from '@/lib/supabase';

export type SegmentoParaPrevia = { id: string; codigo: string; nome: string; ordem: number; condicoes: Condicao[] };

export type ResultadoPrevia = {
	data_base: string | null;
	clientes: number;
	segmentos: { posicao: number; ref: string | null; codigo: string | null; nome: string | null; clientes: number; batem: number; erro: string | null }[];
	demais: number;
	sobreposicao: { a: number; b: number; clientes: number }[];
	de_onde: { de: string | null; para: number | null; clientes: number }[];
	campos_sem_dado: string[];
};

/** Ref do segmento que está sendo editado na proposta. */
export const REF_EDITADO = 'editado';

/** Lista na ordem do motor (ordem, depois código) com o editado no lugar dele (mesmo id) ou no fim (novo). */
export function montarProposta(emUso: SegmentoParaPrevia[], editado: Omit<SegmentoParaPrevia, 'id'> & { id: string | null }) {
	const lista = emUso.filter(s => s.id !== editado.id).map(s => ({ ...s, ref: s.id }));
	lista.push({ ...editado, id: editado.id ?? REF_EDITADO, ref: REF_EDITADO });
	lista.sort((a, b) => (Number(a.ordem) || 0) - (Number(b.ordem) || 0) || (a.codigo < b.codigo ? -1 : a.codigo > b.codigo ? 1 : 0));
	return { segmentos: lista.map(s => ({ ref: s.ref, codigo: s.codigo, nome: s.nome, condicoes: s.condicoes })) };
}

export type ResumoEditado = {
	clientes: number;           // ficam neste segmento (1º que bate)
	batem: number;              // batem nas condições, sem olhar a ordem
	acima: { codigo: string; clientes: number }[];   // batem aqui, mas ficam num segmento acima
	deOnde: { de: string; clientes: number }[];      // de onde vêm os que ficam aqui (segmento de hoje; "Demais")
	erro: string | null;
	dataBase: string | null;
	semDado: string[];
	total: number;
};

/** O que interessa ao formulário: o segmento editado. */
export function resumirEditado(r: ResultadoPrevia): ResumoEditado | null {
	const s = r.segmentos.find(x => x.ref === REF_EDITADO);
	if (!s) return null;
	const codigo = (pos: number) => r.segmentos.find(x => x.posicao === pos)?.codigo ?? `#${pos}`;
	const acima = r.sobreposicao.filter(o => o.b === s.posicao && o.clientes > 0)
		.map(o => ({ codigo: codigo(o.a), clientes: o.clientes }));
	const deOnde = r.de_onde.filter(d => d.para === s.posicao && d.clientes > 0)
		.map(d => ({ de: d.de ?? 'Demais', clientes: d.clientes }))
		.sort((a, b) => b.clientes - a.clientes);
	return { clientes: s.clientes, batem: s.batem, acima, deOnde, erro: s.erro, dataBase: r.data_base, semDado: r.campos_sem_dado ?? [], total: r.clientes };
}

/** "2026-11-06" -> "06/11". */
export function dataCurta(iso: string | null): string {
	if (!iso) return '';
	const [, m, d] = iso.split('-');
	return `${d}/${m}`;
}
