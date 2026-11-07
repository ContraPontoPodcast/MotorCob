// Raias por persona DENTRO de um estágio (passo Régua): o que a tela mostra para o estágio escolhido — fase do motor
// (Cliente novo, Não CPC, Acordo) ou estágio próprio (definicao.etapas) — e como o motor roda cada célula.
//
// Semântica do motor (pinada nos dois lados pelos casos de tests/dados/raias_semantica.json):
// - célula = um dia × uma raia; as ações valem na ordem (motor/estrategia.py › resolver):
//   · sempre  → vai se houver contato; um "sempre" depois do 1º abre OUTRA cadeia (vai também);
//   · senão   → só se nada da cadeia (desde o último "sempre") foi;
//   · junto   → só se a ação IMEDIATAMENTE acima foi;
//   · reserva → se a cadeia foi: vai marcada "se <1º canal da cadeia> sem contato no dia"; se não foi: vai no lugar;
//   · o mesmo canal não vai duas vezes no dia.
// - raia da persona (motor/fila.py › montar + estrategia.raia): cliente cuja persona tem raia no dia recebe só a raia
//   dela; se nenhum canal dela tiver contato, segue o Público geral; "sem ação" = nada no dia. Persona sem raia no dia
//   ou cliente sem persona → Público geral.
// - "Dia N do ciclo": Não CPC (motor/fila.py › _passo_do_dia) N = dias de lista desde o início do giro mod ciclo + 1;
//   estágio próprio com ciclo (motor/etapas.py › escolher) N = (dia − de) mod ciclo + 1. Repete "× vezes".
import { diaLabelEtapa, isFaseId, type Acao, type Definicao, type Etapa, type Passos } from '@/lib/estrategia';

export const SEM_ACAO = 'sem_acao';

// ------------------------------------------------------------------ ordem dos canais numa célula
/** [canal, condição] que vão para a lista, como `estrategia.resolver`. comContato: o canal tem contato elegível hoje? */
export function simularCelula(acoes: Acao[], comContato: (a: Acao) => boolean): [string, string][] {
	const saida: [string, string][] = [];
	const usados = new Set<string>();
	let cadeiaFoi = false;
	let cadeiaCanal: string | null = null;
	let anteriorFoi = false;
	for (const a of acoes) {
		const modo = a.modo ?? 'sempre';
		if (modo === 'sempre') { cadeiaFoi = false; cadeiaCanal = null; }
		const tem = !usados.has(a.canal) && comContato(a);
		let foi = false;
		let condicao = '';
		if (tem) {
			if (modo === 'sempre') foi = true;
			else if (modo === 'senao') foi = !cadeiaFoi;
			else if (modo === 'junto') foi = anteriorFoi;
			else if (modo === 'reserva') { foi = true; if (cadeiaFoi) condicao = `se ${cadeiaCanal} sem contato no dia`; }
		}
		if (foi) {
			saida.push([a.canal, condicao]);
			usados.add(a.canal);
			if (modo !== 'junto' && !condicao) { cadeiaFoi = true; cadeiaCanal = cadeiaCanal ?? a.canal; }
		}
		anteriorFoi = foi;
	}
	return saida;
}

/** Rótulo do conector antes do canal (o 1º da célula não tem). */
export function conectorDoModo(modo: string | undefined, primeiro: boolean): string {
	if (primeiro) return '';
	if (modo === 'junto') return '+ junto';
	if (modo === 'reserva') return '↻ reserva';
	if (modo === 'sempre') return 'e sempre';
	return '↳ senão';
}

/** Uma frase por ação: o que o motor faz com ela (para o título/ajuda da célula). */
export function leituraDaCelula(acoes: Acao[], nome: (canal: string) => string): string[] {
	const out: string[] = [];
	let cadeia: string | null = null;
	acoes.forEach((a, i) => {
		const c = nome(a.canal);
		const modo = i === 0 ? 'sempre' : (a.modo ?? 'senao');
		if (a.canal === SEM_ACAO) { out.push('Sem ação neste dia'); return; }
		if (modo === 'sempre') {
			cadeia = c;
			out.push(i === 0 ? `${c}: vai se houver contato` : `${c}: vai também (abre outra cadeia)`);
		} else if (modo === 'senao') out.push(`${c}: só se nada acima${cadeia ? ` (desde ${cadeia})` : ''} foi`);
		else if (modo === 'junto') out.push(`${c}: junto, se a ação de cima foi`);
		else if (modo === 'reserva') out.push(`${c}: se ${cadeia ?? 'a de cima'} foi, só se ${cadeia ?? 'ela'} não contatar no dia; se não foi, vai no lugar`);
	});
	return out;
}

// ------------------------------------------------------------------ raia da persona no dia
export function ehPublico(a: Acao): boolean { return !a.personas || a.personas.length === 0; }

/** (raia da persona, público geral) do dia, como `estrategia.raia`. */
export function raiaDoDia(acoes: Acao[], persona: string | null): { propria: Acao[]; geral: Acao[] } {
	const geral = acoes.filter(ehPublico);
	if (persona == null) return { propria: [], geral };
	return { propria: acoes.filter(a => a.personas?.includes(persona)), geral };
}

/** Quem recebe o quê num dia para um cliente da persona (null = sem persona), como `fila.montar`. */
export function quemRecebe(acoes: Acao[], persona: string | null, comContato: (a: Acao) => boolean): { raia: 'persona' | 'geral' | 'nada'; canais: [string, string][] } {
	const { propria, geral } = raiaDoDia(acoes, persona);
	if (propria.some(a => a.canal === SEM_ACAO)) {
		const lista = propria.filter(a => a.canal !== SEM_ACAO);
		const canais = simularCelula(lista, comContato);
		return { raia: canais.length ? 'persona' : 'nada', canais };
	}
	if (propria.length) {
		const canais = simularCelula(propria, comContato);
		if (canais.length) return { raia: 'persona', canais };
	}
	const canais = simularCelula(geral, comContato);
	return { raia: canais.length ? 'geral' : 'nada', canais };
}

// ------------------------------------------------------------------ o estágio
function etapaDe(def: Definicao, id: string): Etapa | undefined {
	return (def.etapas ?? []).find(e => e.id === id);
}

/** Régua por dia do estágio (fase → definicao.<fase>.passos; estágio próprio → etapa.passos). */
export function passosDe(def: Definicao, id: string): Passos {
	const p = isFaseId(id) ? (def[id] as { passos?: Passos } | undefined)?.passos : etapaDe(def, id)?.passos;
	return p && typeof p === 'object' ? p : {};
}

/** Grava a régua por dia do estágio, sem mexer no resto. */
export function comPassosDe(def: Definicao, id: string, passos: Passos): Definicao {
	if (isFaseId(id)) {
		const padrao: Record<string, unknown> = id === 'localizacao' ? { dias_sem_contato_para_ncp: 8 } : id === 'giro' ? { ciclo_dias: 8, max_ciclos: 3 } : id === 'quebra' ? { dias_para_estoque: 6 } : {};
		return { ...def, [id]: { ...padrao, ...((def[id] as object | undefined) ?? {}), passos } } as Definicao;
	}
	return { ...def, etapas: (def.etapas ?? []).map(e => (e.id === id ? { ...e, passos } : e)) };
}

export type CicloEstagio = { dias: number; vezes: number };

/** Ciclo do estágio: Não CPC (ciclo_dias × max_ciclos) ou estágio próprio com ciclo; senão null. */
export function cicloDoEstagio(def: Definicao, id: string): CicloEstagio | null {
	if (id === 'giro') return { dias: def.giro?.ciclo_dias ?? 8, vezes: def.giro?.max_ciclos ?? 3 };
	if (isFaseId(id)) return null;
	const c = etapaDe(def, id)?.ciclo;
	return c ? { dias: c.dias, vezes: c.vezes } : null;
}

/** Até quantos dias a janela de um estágio próprio sem ciclo aparece inteira (acima disso, só os dias com régua). */
export const JANELA_INTEIRA_ATE = 15;

function chavesNumericas(passos: Passos): number[] {
	return Object.keys(passos).map(Number).filter(n => Number.isFinite(n));
}

/** Colunas (dias) do estágio, em ordem. */
export function diasDoEstagio(def: Definicao, id: string): number[] {
	const passos = passosDe(def, id);
	const faixa = (a: number, b: number) => Array.from({ length: Math.max(0, b - a + 1) }, (_, i) => a + i);
	if (id === 'localizacao') return faixa(1, Math.max(1, (def.localizacao?.dias_sem_contato_para_ncp ?? 8) - 1));
	if (id === 'giro') return faixa(1, Math.max(1, def.giro?.ciclo_dias ?? 8));
	if (id === 'preventivo') return chavesNumericas(passos).filter(d => d <= 0).sort((a, b) => a - b);
	if (id === 'quebra') return chavesNumericas(passos).filter(d => d > 0).sort((a, b) => a - b);
	if (id === 'cpc') return [];
	const e = etapaDe(def, id);
	if (!e) return [];
	const ciclo = cicloDoEstagio(def, id);
	const base = ciclo ? faixa(1, ciclo.dias) : (e.ate ?? 30) - (e.de ?? 1) + 1 <= JANELA_INTEIRA_ATE ? faixa(e.de ?? 1, e.ate ?? 30) : [];
	return [...new Set([...base, ...chavesNumericas(passos)])].sort((a, b) => a - b);
}

/** Rótulo da coluna: título + linha de apoio (ex.: "D+1" · "Dia 1"; "Dia 2 do ciclo"). */
export function rotuloDiaEstagio(def: Definicao, id: string, d: number): { titulo: string; sub?: string } {
	if (id === 'localizacao') return { titulo: `D+${d}`, sub: `Dia ${d}` };
	if (id === 'giro') return { titulo: `Dia ${d} do ciclo` };
	if (id === 'preventivo') return { titulo: d === 0 ? 'D0' : `D${d}`, sub: 'antes do vencimento' };
	if (id === 'quebra') return { titulo: `D+${d}`, sub: 'depois do vencimento' };
	const e = etapaDe(def, id);
	return { titulo: e ? diaLabelEtapa(e, d) : `Dia ${d}` };
}

/** Rótulo curto de um dia (uma linha), para avisos e títulos. */
export function rotuloCurto(def: Definicao, id: string, d: number): string {
	const r = rotuloDiaEstagio(def, id, d);
	return id === 'localizacao' ? `${r.titulo} · ${r.sub}` : r.titulo;
}

/** O dia está fora do prazo do estágio próprio (o motor ignora)? */
export function diaForaDoPrazo(def: Definicao, id: string, d: number): boolean {
	const e = isFaseId(id) ? undefined : etapaDe(def, id);
	if (!e) return false;
	const ciclo = cicloDoEstagio(def, id);
	const [min, max] = ciclo ? [1, ciclo.dias] : [e.de ?? 1, e.ate ?? 30];
	return d < min || d > max;
}

function destinoFim(def: Definicao, e: Etapa): string {
	const d = e.saidas?.fim_janela;
	if (!d || d === 'padrao') return 'volta ao geral';
	if (d === 'sai') return 'sai da régua';
	if (d.startsWith('etapa:')) { const x = etapaDe(def, d.slice(6)); return x ? `vai para “${x.nome}”` : 'volta ao geral'; }
	return 'volta ao geral';
}

/** Texto da coluna final (o que acontece depois do último dia), ou null. */
export function finalDoEstagio(def: Definicao, id: string): string | null {
	if (id === 'localizacao') return `D+${def.localizacao?.dias_sem_contato_para_ncp ?? 8} sem CPC → Não CPC`;
	if (id === 'giro') return `↻ × ${def.giro?.max_ciclos ?? 3} · depois aguarda enriquecimento`;
	const e = isFaseId(id) ? undefined : etapaDe(def, id);
	if (!e) return null;
	const ciclo = cicloDoEstagio(def, id);
	if (ciclo) return `↻ × ${ciclo.vezes} · depois ${destinoFim(def, e)}`;
	return `Fim do prazo (${e.ate ?? 30}) · ${destinoFim(def, e)}`;
}

/** Indicador de repetição ("↻ × 6") quando o estágio tem ciclo. */
export function repeticaoDoEstagio(def: Definicao, id: string): string | null {
	const c = cicloDoEstagio(def, id);
	return c ? `↻ × ${c.vezes}` : null;
}

const REF_ETAPA: Record<string, string> = { entrada: 'da entrada no estágio', atraso: 'dos dias de atraso', vencimento: 'do vencimento', coluna: 'da data da coluna' };

/** Linha de cabeçalho do estágio (o que é o Dia 1, o ciclo, para onde vai). */
export function resumoDoEstagio(def: Definicao, id: string): string {
	if (id === 'localizacao') return `Dia 1 = 1ª lista do cliente · vira Não CPC no D+${def.localizacao?.dias_sem_contato_para_ncp ?? 8} sem CPC`;
	if (id === 'giro') { const c = cicloDoEstagio(def, id)!; return `Ciclo de ${c.dias} dias × ${c.vezes} voltas · Dia 1 do ciclo = 1º dia de lista no Não CPC · depois aguarda enriquecimento`; }
	if (id === 'preventivo') return 'Dias antes do vencimento de cada parcela do acordo; cada parcela recomeça a contagem';
	if (id === 'quebra') { const car = def.quebra?.carencia ?? 0; return `Dias depois do vencimento sem pagamento${car > 0 ? ` · a partir do D+${car + 1}` : ''} · volta ao estoque no D+${def.quebra?.dias_para_estoque ?? 6}`; }
	if (id === 'cpc') return 'Sem dias: o 1º canal é o do CPC; sem resposta, segue a ordem de reserva';
	const e = etapaDe(def, id);
	if (!e) return '';
	const ref = REF_ETAPA[e.referencia?.tipo ?? 'entrada'] ?? REF_ETAPA.entrada;
	const ciclo = cicloDoEstagio(def, id);
	const prazo = `de ${e.de ?? 1} a ${e.ate ?? 30}, contando ${ref}`;
	return ciclo ? `Ciclo de ${ciclo.dias} dias × ${ciclo.vezes} vezes · ${prazo} · ${finalDoEstagio(def, id)}` : `${prazo} · no fim do prazo ${destinoFim(def, e)}`;
}

// ------------------------------------------------------------------ raias do estágio
/** Personas que têm raia em algum dia do estágio, na ordem da carteira (ids fora da carteira vão no fim). */
export function personasComRaiaNoEstagio(passos: Passos, personaOrder: string[]): string[] {
	const ids = new Set<string>();
	for (const arr of Object.values(passos)) for (const a of arr ?? []) (a.personas ?? []).forEach(p => ids.add(String(p)));
	return [...personaOrder.filter(p => ids.has(p)), ...[...ids].filter(p => !personaOrder.includes(p))];
}

/** Ações do dia em ordem: Público geral primeiro, depois cada persona na ordem da carteira. */
function remontarDia(arr: Acao[], pid: string, novas: Acao[], personaOrder: string[]): Acao[] {
	const split = arr.flatMap(a => (a.personas && a.personas.length > 1 ? a.personas.map(p => ({ ...a, personas: [p] })) : [a]));
	const geral = split.filter(ehPublico);
	const out = [...geral];
	const ordem = personaOrder.includes(pid) ? personaOrder : [...personaOrder, pid];
	for (const p of ordem) out.push(...(p === pid ? novas : split.filter(a => a.personas?.includes(p))));
	for (const a of split) if (!ehPublico(a) && !ordem.some(p => a.personas?.includes(p))) out.push(a);
	return out;
}

/**
 * Cria a raia da persona no estágio: em cada dia, copia o Público geral para ela (mesmos canais, mesma ordem e
 * conectores). Dia sem ação no Público geral fica sem raia (= segue o geral). Dia em que ela já tem raia não muda.
 */
export function adicionarRaia(passos: Passos, pid: string, dias: number[], personaOrder: string[]): Passos {
	const out: Passos = { ...passos };
	for (const d of dias) {
		const k = String(d);
		const arr = out[k] ?? [];
		if (arr.some(a => a.personas?.includes(pid))) continue;
		const geral = arr.filter(ehPublico).filter(a => a.canal !== SEM_ACAO);
		if (!geral.length) continue;
		out[k] = remontarDia(arr, pid, geral.map(a => ({ ...a, personas: [pid] })), personaOrder);
	}
	return out;
}

/** Tira a raia da persona de todos os dias do estágio (ela volta a seguir o Público geral). */
export function removerRaia(passos: Passos, pid: string): Passos {
	const out: Passos = {};
	for (const [k, arr] of Object.entries(passos)) {
		const resto = (arr ?? []).flatMap(a => {
			if (!a.personas?.includes(pid)) return [a];
			const outras = a.personas.filter(p => p !== pid);
			return outras.length ? [{ ...a, personas: outras }] : [];
		});
		out[k] = resto;
	}
	return out;
}

export type CelulaRaia = { dia: number; acoes: Acao[]; segueGeral: boolean; semAcao: boolean };
export type LinhaRaia = { lane: 'pub' | string; celulas: CelulaRaia[] };
export type ModeloRaias = {
	id: string;
	tipo: 'fase' | 'etapa';
	resumo: string;
	colunas: { dia: number; titulo: string; sub?: string; fora: boolean }[];
	ciclo: CicloEstagio | null;
	repete: string | null;
	final: string | null;
	linhas: LinhaRaia[];
	/** Personas da carteira ainda sem raia neste estágio (para "+ raia de persona"). */
	semRaia: string[];
};

/** O modelo da tela: Público geral + uma linha por persona com raia, colunas = dias do estágio. */
export function modeloRaias(def: Definicao, id: string, personaOrder: string[], extras: string[] = []): ModeloRaias {
	const passos = passosDe(def, id);
	const dias = diasDoEstagio(def, id);
	const comRaia = personasComRaiaNoEstagio(passos, personaOrder);
	const lanes = [...comRaia, ...personaOrder.filter(p => extras.includes(p) && !comRaia.includes(p))];
	const celula = (lane: string, d: number): CelulaRaia => {
		const arr = passos[String(d)] ?? [];
		if (lane === 'pub') return { dia: d, acoes: arr.filter(ehPublico), segueGeral: false, semAcao: false };
		const proprias = arr.filter(a => a.personas?.includes(lane));
		return { dia: d, acoes: proprias.filter(a => a.canal !== SEM_ACAO), segueGeral: proprias.length === 0, semAcao: proprias.some(a => a.canal === SEM_ACAO) };
	};
	return {
		id,
		tipo: isFaseId(id) ? 'fase' : 'etapa',
		resumo: resumoDoEstagio(def, id),
		colunas: dias.map(d => ({ dia: d, ...rotuloDiaEstagio(def, id, d), fora: diaForaDoPrazo(def, id, d) })),
		ciclo: cicloDoEstagio(def, id),
		repete: repeticaoDoEstagio(def, id),
		final: finalDoEstagio(def, id),
		linhas: ['pub', ...lanes].map(lane => ({ lane, celulas: dias.map(d => celula(lane, d)) })),
		semRaia: personaOrder.filter(p => !lanes.includes(p)),
	};
}
