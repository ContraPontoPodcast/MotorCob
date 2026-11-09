// "Como soa no telefone" (PR5 do redesenho; SPEC §2.3 e B6): a fala escrita como vai ser dita, com valores, datas,
// parcelas, porcentagens e horas por extenso em pt-BR. "R$ 1.380,00" → "mil trezentos e oitenta reais", "05/12" →
// "cinco de dezembro", "6×" → "seis vezes". Função pura, sem imports: testada em site/fluxo/fluxo.test.ts com a
// mesma tabela de casos do Python (tests/dados/fala_por_extenso_casos.json, voz/falado.py), para o site e a VM
// dizerem igual quando a normalização entrar no executor (PR10). Nada aqui chama provedor nem guarda texto.

const UNIDADES = ['zero', 'um', 'dois', 'três', 'quatro', 'cinco', 'seis', 'sete', 'oito', 'nove', 'dez', 'onze', 'doze', 'treze',
	'quatorze', 'quinze', 'dezesseis', 'dezessete', 'dezoito', 'dezenove'];
const DEZENAS = ['', '', 'vinte', 'trinta', 'quarenta', 'cinquenta', 'sessenta', 'setenta', 'oitenta', 'noventa'];
const CENTENAS = ['', 'cento', 'duzentos', 'trezentos', 'quatrocentos', 'quinhentos', 'seiscentos', 'setecentos', 'oitocentos', 'novecentos'];
const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

/** No feminino ("duas parcelas", "uma vez", "duzentas horas"): só as unidades 1 e 2 e as centenas mudam. */
function feminino(t: string): string {
	return t.replace(/\bum\b/g, 'uma').replace(/\bdois\b/g, 'duas').replace(/entos\b/g, 'entas');
}

/** 0 a 999. */
function ate999(n: number): string {
	if (n < 20) return UNIDADES[n];
	if (n < 100) return DEZENAS[Math.floor(n / 10)] + (n % 10 ? ` e ${UNIDADES[n % 10]}` : '');
	if (n === 100) return 'cem';
	const c = Math.floor(n / 100), r = n % 100;
	return CENTENAS[c] + (r ? ` e ${ate999(r)}` : '');
}

/** Inteiro de 0 a 999.999.999 por extenso ("mil trezentos e oitenta", "dois milhões e quinhentos mil"). Fora disso, os dígitos. */
export function porExtenso(n: number, fem = false): string {
	if (!Number.isInteger(n) || n < 0 || n > 999_999_999) return String(n);
	if (n === 0) return 'zero';
	const mi = Math.floor(n / 1_000_000), mil = Math.floor((n % 1_000_000) / 1000), un = n % 1000;
	const grupos: { v: number; t: string }[] = [];
	if (mi) grupos.push({ v: mi, t: mi === 1 ? 'um milhão' : `${ate999(mi)} milhões` });
	if (mil) { const t = mil === 1 ? 'mil' : `${ate999(mil)} mil`; grupos.push({ v: mil, t: fem ? feminino(t) : t }); }
	if (un) grupos.push({ v: un, t: fem ? feminino(ate999(un)) : ate999(un) });
	// o "e" vai antes do último grupo quando ele é menor que 100 ou centena redonda ("mil e cem", "mil e vinte")
	return grupos.map((g, i) => (i === 0 ? g.t : (i === grupos.length - 1 && (g.v < 100 || g.v % 100 === 0) ? `e ${g.t}` : g.t))).join(' ');
}

/** Valor em reais por extenso: "mil trezentos e oitenta reais", "um real e cinquenta centavos", "um milhão de reais". */
export function reaisPorExtenso(reais: number, centavos = 0): string {
	const r = reais ? `${porExtenso(reais)} ${reais === 1 ? 'real' : /(milhão|milhões)$/.test(porExtenso(reais)) ? 'de reais' : 'reais'}` : '';
	const c = centavos ? `${porExtenso(centavos)} ${centavos === 1 ? 'centavo' : 'centavos'}` : '';
	return r && c ? `${r} e ${c}` : r || c || 'zero real';
}

/** Data dd/mm (e /aaaa) por extenso: "cinco de dezembro", "primeiro de março de dois mil e vinte e seis". Inválida: null. */
export function dataPorExtenso(dia: number, mes: number, ano?: number): string | null {
	if (!(dia >= 1 && dia <= 31 && mes >= 1 && mes <= 12)) return null;
	return `${dia === 1 ? 'primeiro' : porExtenso(dia)} de ${MESES[mes - 1]}${ano != null ? ` de ${porExtenso(ano)}` : ''}`;
}

const inteiro = (t: string) => Number(t.replace(/\./g, ''));
/** Palavras femininas que podem vir depois do número ("duas parcelas", "uma vez"). */
const FEM_DEPOIS = /^\s+(parcelas?|vez|vezes|horas?|prestaç(?:ão|ões)|semanas?|ofertas?|condições|condição)\b/i;

/** Data | porcentagem | R$ | valor com centavos | hora | "6×" | decimal | inteiro (nessa ordem, da esquerda para a direita). */
const PADRAO = new RegExp([
	String.raw`(?<data>(?<![\d/])(?<dd>\d{1,2})\/(?<mm>\d{1,2})(?:\/(?<aa>\d{4}|\d{2}))?(?![\d/]))`,
	String.raw`(?<pct>(?<!\d)(?<pi>\d{1,3})(?:,(?<pd>\d{1,2}))?\s?%)`,
	String.raw`(?<rs>R\$\s?(?<ri>\d{1,3}(?:\.\d{3})+|\d+)(?:,(?<rc>\d{2}))?(?!\d|,\d))`,
	String.raw`(?<vl>(?<![\d.,])(?<vi>\d{1,3}(?:\.\d{3})+|\d+),(?<vc>\d{2})(?!\d|%|,\d))`,
	String.raw`(?<hora>(?<![\d:])(?<hh>\d{1,2})(?:h(?<hm>\d{2})?|:(?<hm2>\d{2}))(?![\d\p{L}]))`,
	String.raw`(?<vezes>(?<![\d.,])(?<vn>\d{1,3})\s?[x×](?![\p{L}\d]))`,
	String.raw`(?<dec>(?<![\d.,])(?<di>\d+),(?<dd2>\d+)(?![\d%]))`,
	String.raw`(?<num>(?<![\d.,])(?<ni>\d{1,3}(?:\.\d{3})+|\d{1,9})(?!\d|,\d))`,
].join('|'), 'gu');

export interface TrechoFalado { de: string; para: string }

/** Os trechos com número e como cada um vai ser dito (para a checagem "números como vão ser lidos"). */
export function trechosFalados(texto: string): TrechoFalado[] {
	const out: TrechoFalado[] = [];
	falar(texto, (de, para) => { if (de !== para) out.push({ de, para }); });
	return out;
}

/** A fala inteira como vai ser dita. Variáveis {{ }} sem valor ficam como estão. */
export function comoSoa(texto: string): string {
	return falar(texto);
}

function falar(texto: string, aviso?: (de: string, para: string) => void): string {
	return texto.replace(PADRAO, (m: string, ...args: unknown[]) => {
		const g = args[args.length - 1] as Record<string, string | undefined>;
		const off = args[args.length - 3] as number;
		const fem = FEM_DEPOIS.test(texto.slice(off + m.length));
		let r: string = m;
		if (g.data) {
			const ano = g.aa ? Number(g.aa.length === 2 ? `20${g.aa}` : g.aa) : undefined;
			r = dataPorExtenso(Number(g.dd), Number(g.mm), ano) ?? m;
		} else if (g.pct) r = `${porExtenso(Number(g.pi))}${g.pd ? ` vírgula ${decimais(g.pd)}` : ''} por cento`;
		else if (g.rs) r = reaisPorExtenso(inteiro(g.ri!), Number(g.rc ?? 0));
		else if (g.vl) r = reaisPorExtenso(inteiro(g.vi!), Number(g.vc));
		else if (g.hora) {
			const h = Number(g.hh), mi = Number(g.hm ?? g.hm2 ?? 0);
			r = h > 23 || mi > 59 ? m : `${h === 1 ? 'uma hora' : h === 0 ? 'meia-noite' : `${porExtenso(h, true)} horas`}${mi ? ` e ${porExtenso(mi)} ${mi === 1 ? 'minuto' : 'minutos'}` : ''}`;
		} else if (g.vezes) r = `${porExtenso(Number(g.vn), true)} ${Number(g.vn) === 1 ? 'vez' : 'vezes'}`;
		else if (g.dec) r = `${porExtenso(Number(g.di))} vírgula ${decimais(g.dd2!)}`;
		else if (g.num) r = porExtenso(inteiro(g.ni!), fem);
		aviso?.(m, r);
		return r;
	});
}

/** Casas decimais ditas como número ("5" → cinco, "05" → zero cinco). */
function decimais(t: string): string {
	return t.startsWith('0') ? t.split('').map(c => UNIDADES[Number(c)]).join(' ') : porExtenso(Number(t));
}

/**
 * Valores de teste para a prévia (os mesmos do simulador: supabase/functions/simular_fluxo_voz/regras.ts ›
 * variaveisTeste, mais uma oferta de exemplo). Fictícios: nenhum dado de cliente.
 */
export function valoresTeste(assessoria: string, credor: string | null): Record<string, string> {
	return {
		primeiro_nome: 'Ana', assessoria, credor: credor ?? 'Credor de teste', saldo: 'R$ 1.380,00', dias_atraso: '45',
		vencimento: '05/11', link_pagamento: 'o link de pagamento', valor_minimo: 'R$ 100,00', parcelas_max: '12', desconto_max: '15%',
		'oferta.parcelas': '6', 'oferta.valor_parcela': 'R$ 230,00', 'oferta.vencimento': '05/12', 'oferta.valor_total': 'R$ 1.380,00',
		'oferta.desconto_pct': '15%', 'oferta.entrada': 'R$ 100,00',
	};
}

/** Troca {{variavel}} pelo valor de teste (como voz/provedores/montagem.py › preencher). Sem valor: fica como está. */
export function preencherTeste(texto: string, vars: Record<string, string>): string {
	// "R$ {{saldo}}" com o valor já em reais não vira "R$ R$ 1.380,00"
	return texto.replace(/\{\{\s*([a-z_.]+)\s*\}\}/g, (m, k: string) => vars[k] ?? m).replace(/R\$\s*R\$\s?/g, 'R$ ');
}
