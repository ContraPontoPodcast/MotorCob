// Condições de segmento, persona e estágio (editores da Orquestração, Personas e Segmentos).
//
// Números em pt-BR do começo ao fim (o dono reportou: "entre", a vírgula não aceita):
// - Na tela, o usuário digita como no Brasil: "1.500,50", "1500,5", "-3.000", "R$ 1.500,50". "1500.50" (ponto com
//   1, 2 ou 4+ casas) também vale: o ponto só pode ser decimal ali. "1.500" (ponto + 3 dígitos) é mil e quinhentos.
// - No banco, o site grava NÚMERO (JSON) nas condições numéricas (>, ≥, <, ≤, "está entre" e = / ≠ em campo
//   numérico). Número em JSON não tem ambiguidade, e o motor (`motor/cluster.py › numero`) já lê int/float.
// - Valor antigo salvo como texto continua com o MESMO significado: ao abrir o editor ele é lido como o motor
//   sempre leu (`lerNumeroGravado`, espelho de `numero()`: com vírgula = pt-BR; sem vírgula, um ponto = decimal,
//   então "1.500" antigo = 1,5) e aparece em pt-BR ("1,5"). Quem salvar de novo grava o número que o motor já usava.
// - "está entre" (faixa) é o operador `entre`, com valor [de, até], os dois incluídos. "é um destes" (`em`/`nao_em`)
//   é lista; os itens são separados por ";" (a vírgula é o decimal).

export type ValorCondicao = string | number | (string | number)[] | null;
export type CondicaoEditavel = { campo: string; op: string; valor: ValorCondicao };
export type TipoCampo = 'numero' | 'texto';

/** Operadores que só aceitam número (o motor recusa a condição se o valor não for número). */
export const OPS_NUMERICOS = ['>', '>=', '<', '<=', 'entre'] as const;
export const OPS_LISTA = ['em', 'nao_em'] as const;
export const SEPARADOR_LISTA = ';';

const EXEMPLO = 'ex.: 1.500,50';

/** Texto digitado em pt-BR -> número, ou a mensagem do que está errado. */
export function lerNumeroBR(texto: unknown): { valor: number } | { erro: string } {
	if (typeof texto === 'number') return Number.isFinite(texto) ? { valor: texto } : { erro: 'Número inválido.' };
	const t = String(texto ?? '').replace(/R\$/gi, '').replace(/[\s ]/g, '');
	if (!t) return { erro: 'Informe um número.' };
	const m = /^([+-]?)(.*)$/.exec(t)!;
	const sinal = m[1] === '-' ? -1 : 1;
	const corpo = m[2];
	let normal: string | null = null;
	if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(corpo)) normal = corpo.replace(/\./g, '').replace(',', '.');   // 1.500 · 1.500,50 · 1.000.000
	else if (/^\d*,\d+$|^\d+,?$/.test(corpo)) normal = corpo.replace(',', '.');                              // 1500 · 1500,5 · ,5
	else if (/^\d*\.\d+$/.test(corpo)) normal = corpo;                                                         // 1500.50 · 1.5 · .5 (1.500 já caiu acima)
	if (normal === null || normal === '.' || normal === '') {
		if (/^[\d.,]+$/.test(corpo) && corpo.includes(',') && corpo.lastIndexOf('.') > corpo.indexOf(',')) {
			return { erro: `Use vírgula para os decimais e ponto para os milhares (${EXEMPLO}).` };
		}
		if (/^[\d.,]+$/.test(corpo)) return { erro: `Número mal escrito: os milhares vão de 3 em 3 e só uma vírgula (${EXEMPLO}).` };
		return { erro: `Não é um número (${EXEMPLO}).` };
	}
	const n = Number(normal) * sinal;
	return Number.isFinite(n) ? { valor: n === 0 ? 0 : n } : { erro: `Não é um número (${EXEMPLO}).` };
}

/** Valor já salvo -> número, do jeito que o motor lê (`motor/cluster.py › numero`). Para não mudar regra antiga. */
export function lerNumeroGravado(v: unknown): number | null {
	if (typeof v === 'number') return Number.isFinite(v) ? v : null;
	if (typeof v !== 'string') return null;
	let s = v.replace(/R\$/gi, '').replace(/[\s ]/g, '');
	if (!s) return null;
	if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
	else if (/^[+-]?\d{1,3}(\.\d{3}){2,}$/.test(s)) s = s.replace(/\./g, '');
	if (!/^[+-]?(\d+\.?\d*|\.\d+)$/.test(s)) return null;
	const n = Number(s);
	return Number.isFinite(n) ? n : null;
}

/** Número -> texto pt-BR. `milhar`: com ponto de milhar (para ler); sem, para editar. */
export function formatarNumeroBR(n: number, milhar = true): string {
	return n.toLocaleString('pt-BR', { useGrouping: milhar, maximumFractionDigits: 10 });
}

function ehNumerica(op: string, tipo: TipoCampo): boolean {
	return (OPS_NUMERICOS as readonly string[]).includes(op) || (tipo === 'numero' && (op === '=' || op === '!='));
}

/** Valor salvo -> texto para o campo de edição (pt-BR, sem ponto de milhar), lido como o motor lê. */
export function textoEdicao(v: unknown): string {
	if (v === null || v === undefined) return '';
	const n = lerNumeroGravado(v);
	return n !== null ? formatarNumeroBR(n, false) : String(v);
}

/** Troca o operador ajustando o formato do valor (faixa = [de, até]; lista = itens; o resto = um valor). */
export function trocarOperador<T extends CondicaoEditavel>(c: T, op: string): T {
	const bruto = Array.isArray(c.valor) ? (c.valor[0] ?? '') : (c.valor ?? '');
	const primeiro = typeof bruto === 'number' ? bruto : String(bruto);
	if (op === 'entre') return { ...c, op, valor: c.op === 'entre' ? c.valor : [primeiro, ''] };
	if ((OPS_LISTA as readonly string[]).includes(op)) {
		return { ...c, op, valor: Array.isArray(c.valor) && c.op !== 'entre' ? c.valor : (String(primeiro).trim() ? [String(primeiro)] : []) };
	}
	if (op === 'vazio' || op === 'preenchido') return { ...c, op, valor: '' };
	return { ...c, op, valor: primeiro };
}

/** Texto da lista ("SP; RJ") -> itens. */
export function lerLista(texto: string): string[] {
	return texto.split(SEPARADOR_LISTA).map(s => s.trim()).filter(Boolean);
}

/** Itens -> texto da lista para o campo. */
export function textoLista(v: ValorCondicao): string {
	return Array.isArray(v) ? v.join(`${SEPARADOR_LISTA} `) : String(v ?? '');
}

/** O que está errado na condição (para mostrar embaixo dela), ou null. */
export function erroCondicao(c: CondicaoEditavel, tipo: TipoCampo): string | null {
	const r = normalizarCondicao(c, tipo);
	return 'erro' in r ? r.erro : null;
}

/** Condição do editor -> condição para gravar (números como número) ou a mensagem de erro em pt-BR. */
export function normalizarCondicao<T extends CondicaoEditavel>(c: T, tipo: TipoCampo): { cond: T } | { erro: string } {
	if (c.op === 'vazio' || c.op === 'preenchido') return { cond: { ...c, valor: null } };
	if (c.op === 'entre') {
		const arr = Array.isArray(c.valor) ? c.valor : [];
		const de = lerNumeroBR(arr[0]);
		const ate = lerNumeroBR(arr[1]);
		if ('erro' in de) return { erro: `"De": ${de.erro}` };
		if ('erro' in ate) return { erro: `"Até": ${ate.erro}` };
		const antigo = (v: unknown, n: number) => (typeof v === 'string' ? (lerNumeroGravado(v) ?? n) : n);
		de.valor = antigo(arr[0], de.valor);
		ate.valor = antigo(arr[1], ate.valor);
		if (de.valor > ate.valor) return { erro: `"De" (${formatarNumeroBR(de.valor)}) precisa ser menor ou igual a "até" (${formatarNumeroBR(ate.valor)}).` };
		return { cond: { ...c, valor: [de.valor, ate.valor] } };
	}
	if ((OPS_LISTA as readonly string[]).includes(c.op)) {
		const itens = Array.isArray(c.valor) ? c.valor.map(v => String(v).trim()).filter(Boolean) : lerLista(String(c.valor ?? ''));
		if (itens.length === 0) return { erro: 'Informe pelo menos um valor (separe com ;).' };
		return { cond: { ...c, valor: itens } };
	}
	if (ehNumerica(c.op, tipo)) {
		const bruto = Array.isArray(c.valor) ? c.valor[0] : c.valor;
		const r = lerNumeroBR(bruto);
		if ('erro' in r) {
			// "=" / "≠" em coluna numérica aceita texto (o motor compara como texto quando não é número).
			if ((c.op === '=' || c.op === '!=') && String(bruto ?? '').trim()) return { cond: { ...c, valor: String(bruto).trim() } };
			return { erro: r.erro };
		}
		// Número digitado já chega como número (CampoNumero). Texto que sobrou é valor antigo, nunca editado:
		// grava o número que o motor já usava ("1.500" antigo = 1,5), para a regra não mudar de sentido.
		return { cond: { ...c, valor: typeof bruto === 'string' ? (lerNumeroGravado(bruto) ?? r.valor) : r.valor } };
	}
	const txt = Array.isArray(c.valor) ? c.valor.join(`${SEPARADOR_LISTA} `) : String(c.valor ?? '');
	return { cond: { ...c, valor: txt.trim() } };
}

/** Todas as condições -> para gravar, ou a 1ª mensagem de erro ("Condição 2: ..."). */
export function normalizarCondicoes<T extends CondicaoEditavel>(conds: T[], tipoDe: (campo: string) => TipoCampo): { condicoes: T[] } | { erro: string } {
	const saida: T[] = [];
	for (let i = 0; i < conds.length; i++) {
		const r = normalizarCondicao(conds[i], tipoDe(conds[i].campo));
		if ('erro' in r) return { erro: `Condição ${i + 1}: ${r.erro}` };
		saida.push(r.cond);
	}
	return { condicoes: saida };
}

/** Como o número digitado foi entendido (ex.: "1.500" -> "1.500"; "1500,5" -> "1.500,5"), ou null se não for número. */
export function lidoComo(texto: unknown): string | null {
	const r = lerNumeroBR(texto);
	return 'erro' in r ? null : formatarNumeroBR(r.valor);
}

/** Valor para as frases de leitura ("Saldo entre 1.500,5 e 3.000"). */
export function fraseValor(c: { op: string; valor: unknown }): string {
	const um = (v: unknown) => (typeof v === 'number' ? formatarNumeroBR(v) : String(v ?? ''));
	if (c.op === 'entre' && Array.isArray(c.valor)) return `${um(c.valor[0])} e ${um(c.valor[1])}`;
	if (Array.isArray(c.valor)) return c.valor.map(um).join('; ');
	return um(c.valor);
}
