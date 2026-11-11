// Roleplay › Evolução (SQL 121, evolucao_treino): regras e textos sem banco. Linha do tempo da nota (treino × ligações
// reais por semana), mapa por item (treino e ligações reais lado a lado; por equipe na leitura da empresa) e a linha do
// tempo de cada item nas sessões de uma pessoa. Sem ranking: nada aqui ordena pessoas por nota. Faixas e regra "sem
// humilhar" de lib/speech.ts (FAIXAS, faixaDe). A nota de treino nunca entra na monitoria; só aparece ao lado.
import { dataBR, faixaDe, FAIXAS } from './speech';
import { itemChecklist, type ItemChecklistRP } from './roleplay';

export type PontoItem = { semana: string; item: string; sim: number; avaliados: number };
export type EvolucaoRP = {
	de: string; ate: string; escopo: 'empresa' | 'equipe' | 'pessoa'; pessoas: number; com_ligacoes: number;
	treino_itens: PontoItem[]; treino_notas: { semana: string; nota: number | null; sessoes: number; na_meta: number }[];
	real_itens: PontoItem[]; real_notas: { semana: string; nota: number | null; ligacoes: number }[];
	por_equipe: (Omit<PontoItem, 'semana'> & { equipe: number; pessoas: number })[] | null;
	concordancia: { revisados: number; iguais: number } | null; itens_treinados: string[];
	sessoes: { id: number; atribuicao: number | null; inicio: string; modo: string; nota: number | null; reprovada: boolean; cenario: string | null; itens: Record<string, string> | null }[] | null;
};

/** Mínimo de avaliações para mostrar a porcentagem (abaixo disso, só "poucas"). */
export const MIN_ITEM = 3;
/** Período da Evolução (?d=): 30, 90 ou 180 dias. */
export const PERIODOS_EVOLUCAO = [{ d: 30, nome: '30 dias' }, { d: 90, nome: '90 dias' }, { d: 180, nome: '180 dias' }] as const;
export const periodoValido = (v: string | null | undefined) => (PERIODOS_EVOLUCAO.some(p => String(p.d) === v) ? Number(v) : 90);

/** Segundas-feiras de `de` até `ate` (o eixo do gráfico; semana sem dado fica como lacuna). */
export function semanas(de: string, ate: string): string[] {
	const out: string[] = [];
	const d = new Date(`${de}T12:00:00Z`);
	d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
	const fim = new Date(`${ate}T12:00:00Z`);
	while (d <= fim && out.length < 60) { out.push(d.toISOString().slice(0, 10)); d.setUTCDate(d.getUTCDate() + 7); }
	return out;
}

export const pct = (sim: number, avaliados: number) => (avaliados >= MIN_ITEM ? Math.round((100 * sim) / avaliados) : null);

/** Nota por semana: treino e ligações reais (linha do tempo da nota). */
export function seriesNotas(e: EvolucaoRP) {
	const x = semanas(e.de, e.ate);
	const t = new Map(e.treino_notas.map(n => [n.semana, n.nota]));
	const r = new Map(e.real_notas.map(n => [n.semana, n.nota]));
	return { x, rotulos: x.map(s => dataBR(s)), treino: x.map(s => (t.has(s) ? Number(t.get(s)) : null)), real: x.map(s => (r.has(s) ? Number(r.get(s)) : null)) };
}

function somar(pontos: PontoItem[]) {
	const m = new Map<string, { sim: number; avaliados: number }>();
	for (const p of pontos) { const v = m.get(p.item) ?? { sim: 0, avaliados: 0 }; v.sim += p.sim; v.avaliados += p.avaliados; m.set(p.item, v); }
	return m;
}

export type LinhaMapa = { item: string; texto: string; gravidade: string; treinado: boolean; treino: number | null; nTreino: number; real: number | null; nReal: number; diferenca: number | null };
/** Mapa por item: % de "sim" no treino e nas ligações reais, no período. Itens treinados primeiro; depois pelo texto. */
export function mapaItens(e: EvolucaoRP, itens: Record<string, ItemChecklistRP>): LinhaMapa[] {
	const t = somar(e.treino_itens), r = somar(e.real_itens);
	const ids = [...new Set([...t.keys(), ...r.keys()])];
	return ids.map(id => {
		const a = t.get(id) ?? { sim: 0, avaliados: 0 }, b = r.get(id) ?? { sim: 0, avaliados: 0 };
		const tp = pct(a.sim, a.avaliados), rp = pct(b.sim, b.avaliados);
		const ck = itemChecklist(id, itens);
		return { item: id, texto: ck.texto, gravidade: ck.gravidade, treinado: e.itens_treinados.includes(id), treino: tp, nTreino: a.avaliados, real: rp, nReal: b.avaliados, diferenca: tp != null && rp != null ? rp - tp : null };
	}).sort((x, y) => Number(y.treinado) - Number(x.treinado) || x.texto.localeCompare(y.texto, 'pt-BR'));
}

/** Mapa por item e equipe (leitura da empresa): % de "sim" no treino. Equipes pelo nome; nunca por pessoa. */
export function mapaEquipes(e: EvolucaoRP, equipes: { id: number; nome: string }[], itens: Record<string, ItemChecklistRP>) {
	const pe = e.por_equipe ?? [];
	const cols = equipes.filter(q => pe.some(p => p.equipe === q.id)).sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
	const ids = [...new Set(pe.map(p => p.item))].sort((a, b) => itemChecklist(a, itens).texto.localeCompare(itemChecklist(b, itens).texto, 'pt-BR'));
	return {
		equipes: cols,
		linhas: ids.map(id => ({ item: id, texto: itemChecklist(id, itens).texto, celulas: cols.map(q => { const p = pe.find(x => x.equipe === q.id && x.item === id); return p ? { pct: pct(p.sim, p.avaliados), n: p.avaliados } : { pct: null, n: 0 }; }) })),
	};
}

/** Linha do tempo de cada item nas sessões de uma pessoa (a mais antiga à esquerda): sim / não / não se aplicou. */
export function linhaTempoItens(e: EvolucaoRP, itens: Record<string, ItemChecklistRP>) {
	const ss = e.sessoes ?? [];
	const ids = [...new Set(ss.flatMap(s => Object.keys(s.itens ?? {})))];
	return {
		sessoes: ss.map(s => ({ id: s.id, atribuicao: s.atribuicao, data: dataBR(s.inicio), nota: s.nota, reprovada: s.reprovada, cenario: s.cenario })),
		linhas: ids.map(id => ({ item: id, texto: itemChecklist(id, itens).texto, gravidade: itemChecklist(id, itens).gravidade, respostas: ss.map(s => (s.itens?.[id] as 'sim' | 'nao' | 'na' | undefined) ?? null) }))
			.sort((a, b) => Number(b.gravidade === 'bloqueante') - Number(a.gravidade === 'bloqueante') || a.texto.localeCompare(b.texto, 'pt-BR')),
	};
}

/** Faixa de uma porcentagem (a mesma régua das notas: 90 / 80 / 70). */
export const faixaPct = (v: number) => FAIXAS[faixaDe(v)];

/** Frase do "treino × ligações reais" por item, sem julgar a pessoa. */
export function textoComparacao(l: Pick<LinhaMapa, 'treino' | 'real' | 'nReal' | 'nTreino'>): string {
	if (l.treino == null && l.real == null) return 'Poucas avaliações no período.';
	if (l.real == null) return l.nReal ? `Poucas ligações avaliadas nesse item (${l.nReal}).` : 'Sem ligações reais avaliadas nesse item.';
	if (l.treino == null) return l.nTreino ? `Pouco treino nesse item (${l.nTreino}).` : 'Ainda sem treino nesse item.';
	const d = l.real - l.treino;
	if (Math.abs(d) < 5) return 'No treino e nas ligações, no mesmo patamar.';
	return d > 0 ? `Nas ligações, ${d} pontos acima do treino.` : `Nas ligações, ${-d} pontos abaixo do treino: vale reforçar.`;
}

/** Concordância IA × Qualidade (itens revisados). */
export function textoConcordancia(c: EvolucaoRP['concordancia']): { valor: string; detalhe: string } {
	if (!c || !c.revisados) return { valor: '—', detalhe: 'nenhum item revisado no período' };
	return { valor: `${Math.round((100 * c.iguais) / c.revisados)}%`, detalhe: `${c.iguais} de ${c.revisados} itens revisados iguais à IA` };
}
