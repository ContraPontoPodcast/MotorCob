// Mapeamento das colunas da carga geral (SQL 74): o navegador lê o cabeçalho ANTES do envio, mostra o que reconheceu e
// pede só o que falta. O salvo vai para mapeamento_arquivos (tipo 'base') por salvar_mapeamento_base, e o motor usa
// (vence a detecção automática de motor/detectar.py; a detecção completa o resto). A detecção daqui é a mesma ideia,
// mais simples: nomes usuais de cobrança. Nada de valores das linhas sai do navegador.
import { unzipSync, strFromU8 } from 'fflate';

export type CampoCarga = 'id_cliente' | 'cpf' | 'id_contrato' | 'saldo' | 'dias_atraso' | 'vencimento' | 'telefones' | 'emails';
/** SQL 88 · "Para o agente de voz" (opcionais): só viram código de validação; nunca atributo, segmento ou prévia. */
export type CampoVoz = 'nascimento' | 'documento_validacao';
/** SQL 130 · ofertas prontas do arquivo (até 3 por cliente): lidas como vieram, nunca calculadas nem viram atributo. */
export type CampoOfertaArq = 'id' | 'parcelas' | 'valor_parcela' | 'desconto' | 'entrada' | 'validade' | 'valor_total' | 'vencimento';
export type CampoOferta = `oferta${1 | 2 | 3}_${CampoOfertaArq}`;
export const chaveOferta = (n: 1 | 2 | 3, campo: CampoOfertaArq) => `oferta${n}_${campo}` as CampoOferta;
export const CAMPOS_OFERTA: { campo: CampoOfertaArq; nome: string; obrig?: boolean; formato: string }[] = [
	{ campo: 'parcelas', nome: 'Parcelas', obrig: true, formato: 'número inteiro; 1 = à vista' },
	{ campo: 'valor_parcela', nome: 'Valor da parcela', obrig: true, formato: 'R$, como 1.200,00' },
	{ campo: 'validade', nome: 'Validade', obrig: true, formato: 'DD/MM/AAAA; sem validade a oferta é descartada' },
	{ campo: 'desconto', nome: 'Desconto (%)', formato: 'só em %; R$ não é lido' },
	{ campo: 'entrada', nome: 'Entrada', formato: 'R$' },
	{ campo: 'valor_total', nome: 'Valor total', formato: 'R$; quando vem, a conta é conferida' },
	{ campo: 'vencimento', nome: '1º vencimento', formato: 'DD/MM/AAAA; sem ele, a promessa usa a validade' },
	{ campo: 'id', nome: 'Código da oferta', formato: 'opcional; sem ele vira arq-1, arq-2, arq-3' },
];
export const CHAVES_OFERTA: CampoOferta[] = ([1, 2, 3] as const).flatMap(n => CAMPOS_OFERTA.map(c => chaveOferta(n, c.campo)));
export type ColunasCarga = Partial<Record<Exclude<CampoCarga, 'telefones' | 'emails'> | CampoVoz | CampoOferta, string>> & { telefones?: string[]; emails?: string[] };

export const CAMPOS_VOZ: { key: CampoVoz; nome: string; ajuda: string; formato: string }[] = [
	{ key: 'nascimento', nome: 'Data de nascimento', ajuda: 'dá "dia e mês" e "ano". Reconhece DT_NASC, DATA_NASCIMENTO e parecidos.', formato: 'Formato: DD/MM/AAAA (ou AAAA-MM-DD). Inválida = data que não existe (31/02), futura ou idade fora de 14–110.' },
	{ key: 'documento_validacao', nome: '3 últimos dígitos do documento', ajuda: 'Use o CPF/CNPJ já apontado, ou uma coluna só com os 3 dígitos.', formato: 'Do CPF/CNPJ o motor tira só os 3 últimos dígitos, em memória. O documento continua nunca sendo o id.' },
];
/** Nomes usuais da data de nascimento (os mesmos de motor/entrada.py › NOMES_NASCIMENTO). */
const NASCIMENTOS = ['DATA_NASCIMENTO', 'DT_NASCIMENTO', 'DT_NASC', 'DATA_NASC', 'NASCIMENTO', 'DATANASCIMENTO', 'DT_NASCTO', 'DATA_DE_NASCIMENTO'];
/** O que a carga precisa (um de cada): mesmos códigos do motor (detectar.FALTA_BASE). */
export type Falta = 'cliente' | 'saldo' | 'atraso' | 'contato';

export const CAMPOS_CARGA: { key: CampoCarga; nome: string; ajuda?: string; multi?: boolean; falta?: Falta }[] = [
	{ key: 'id_cliente', nome: 'Código do cliente', ajuda: 'ou o CPF', falta: 'cliente' },
	{ key: 'id_contrato', nome: 'Contrato', ajuda: 'opcional' },
	{ key: 'saldo', nome: 'Saldo', falta: 'saldo' },
	{ key: 'dias_atraso', nome: 'Dias de atraso', ajuda: 'ou o vencimento', falta: 'atraso' },
	{ key: 'vencimento', nome: 'Vencimento', ajuda: 'se não tiver os dias de atraso' },
	{ key: 'telefones', nome: 'Telefones', multi: true, ajuda: 'um ou mais', falta: 'contato' },
	{ key: 'emails', nome: 'E-mail', multi: true, ajuda: 'opcional se houver telefone' },
	{ key: 'cpf', nome: 'CPF/CNPJ', ajuda: 'opcional: só para agrupar a mesma pessoa' },
];

export const NOME_FALTA: Record<Falta, string> = {
	cliente: 'o código do cliente (ou o CPF)',
	saldo: 'o saldo',
	atraso: 'os dias de atraso (ou o vencimento)',
	contato: 'o telefone ou o e-mail',
};

/** Normaliza o nome da coluna como o motor (sem acento, maiúsculas, _ no lugar do resto). */
export function normalizar(nome: string): string {
	return (nome ?? '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

const IDS = ['COD_CLIENTE', 'CODIGO_CLIENTE', 'ID_CLIENTE', 'CLIENTE_ID', 'CD_CLIENTE', 'COD_CLI', 'COD_DEVEDOR', 'ID_DEVEDOR', 'CODIGO_DEVEDOR', 'CD_DEVEDOR', 'MATRICULA', 'ID_CONSUMIDOR', 'COD_CONSUMIDOR', 'CLIENTE', 'ID'];
const CONTRATOS = ['CONTRATO', 'NUM_CONTRATO', 'NR_CONTRATO', 'NUMERO_CONTRATO', 'ID_CONTRATO', 'COD_CONTRATO', 'N_CONTRATO', 'NO_CONTRATO', 'NRO_CONTRATO', 'CONTRATO_ID', 'CD_CONTRATO', 'NUMERO_DO_CONTRATO'];
const CPFS = ['CPF', 'CPF_CNPJ', 'CPFCNPJ', 'CNPJ_CPF', 'CNPJ', 'CPF_CLIENTE', 'CPF_DEVEDOR', 'DOCUMENTO', 'NR_DOCUMENTO', 'NUM_DOCUMENTO', 'NUMERO_DOCUMENTO', 'DOC', 'CPF_CNPJ_CLIENTE'];
const SALDOS = ['SALDO', 'SALDO_DEVEDOR', 'SALDO_ATUAL', 'SALDO_ATUALIZADO', 'SALDO_DEVEDOR_ATUAL', 'VALOR_SALDO', 'VL_SALDO', 'VLR_SALDO', 'VALOR_DIVIDA', 'VL_DIVIDA', 'VLR_DIVIDA', 'VALOR_ATUALIZADO', 'VALOR_EM_ABERTO', 'VALOR_ABERTO', 'VALOR_DEVIDO', 'VALOR_TOTAL', 'VL_TOTAL', 'DIVIDA', 'VALOR', 'VALOR_ORIGINAL'];
const ATRASOS = ['DIAS_ATRASO', 'ATRASO', 'QTD_DIAS_ATRASO', 'QT_DIAS_ATRASO', 'DIAS_EM_ATRASO', 'DIAS_DE_ATRASO', 'AGING', 'DIAS'];
const VENCS = ['VENCIMENTO', 'DT_VENCIMENTO', 'DATA_VENCIMENTO', 'DT_VENC', 'DATA_VENC', 'VENC', 'DT_VENCTO', 'VENCTO', 'DATA_VENCTO', 'VENCIMENTO_ORIGINAL', 'DT_VENCIMENTO_ORIGINAL', 'PRIMEIRO_VENCIMENTO'];
const NAO_FONE = ['TIPO', 'OPERADORA', 'RANKING', 'SCORE', 'DDD', 'POSSUI', 'PERTURBE', 'STATUS', 'FLAG', 'WHATS', 'QTD', 'DATA', 'DT_', 'RCS', 'HOT', 'CEP'];

function achar(nomes: string[], usados: Set<string>, exatos: string[], contem: string[] = [], evitar: string[] = []): string | undefined {
	const livres = nomes.filter(c => c && !usados.has(c));
	for (const e of exatos) { const c = livres.find(x => normalizar(x) === e); if (c) return c; }
	for (const k of contem) { const c = livres.find(x => { const n = normalizar(x); return n.includes(k) && !evitar.some(v => n.includes(v)); }); if (c) return c; }
	return undefined;
}

/** O que o MotorCX reconhece sozinho pelo cabeçalho (a mesma ordem do motor). */
export function reconhecer(cabecalho: string[]): ColunasCarga {
	const usados = new Set<string>();
	const r: ColunasCarga = {};
	const pega = (k: Exclude<CampoCarga, 'telefones' | 'emails'>, c: string | undefined) => { if (c) { usados.add(c); r[k] = c; } };
	pega('cpf', achar(cabecalho, usados, CPFS));
	pega('id_cliente', achar(cabecalho, usados, IDS));
	pega('id_contrato', achar(cabecalho, usados, CONTRATOS, ['CONTRATO'], ['TIPO', 'DATA', 'DT_', 'QTD', 'STATUS']));
	pega('saldo', achar(cabecalho, usados, SALDOS, ['SALDO', 'VALOR', 'VL_', 'VLR'], ['PARCELA', 'PAGO', 'MINIMO']));
	pega('dias_atraso', achar(cabecalho, usados, ATRASOS, ['ATRASO']));
	if (!r.dias_atraso) pega('vencimento', achar(cabecalho, usados, VENCS, ['VENC']));
	const tels: string[] = [], mails: string[] = [];
	for (const c of cabecalho) {
		if (!c || usados.has(c)) continue;
		const n = normalizar(c);
		if ((n.includes('EMAIL') || n.includes('E_MAIL')) && !n.includes('VALID')) { mails.push(c); continue; }
		if (['TEL', 'FONE', 'CELULAR', 'CEL', 'WHATSAPP_NUMERO', 'NUMERO_TELEFONE'].some(k => n.includes(k)) && !NAO_FONE.some(x => n.includes(x))) tels.push(c);
	}
	if (tels.length) r.telefones = tels;
	if (mails.length) r.emails = mails;
	const nasc = achar(cabecalho.filter(c => !tels.includes(c) && !mails.includes(c)), usados, NASCIMENTOS);
	if (nasc) r.nascimento = nasc;
	return r;
}

/** Junta o salvo (vence) com o reconhecido; coluna salva que não está no arquivo cai fora. */
export function combinar(salvo: ColunasCarga | null | undefined, reconhecido: ColunasCarga, cabecalho: string[]): ColunasCarga {
	const tem = (c: string) => !cabecalho.length || cabecalho.includes(c);
	const r: ColunasCarga = { ...reconhecido };
	for (const [k, v] of Object.entries(salvo ?? {})) {
		if (Array.isArray(v)) { const l = v.filter(tem); if (l.length) (r as Record<string, unknown>)[k] = l; }
		else if (typeof v === 'string' && v && tem(v)) (r as Record<string, unknown>)[k] = v;
	}
	if (salvo?.vencimento && !salvo.dias_atraso && tem(salvo.vencimento)) delete r.dias_atraso;
	return r;
}

/** O que ainda falta para a carga entrar (mesmos códigos do motor). */
export function faltam(c: ColunasCarga): Falta[] {
	const f: Falta[] = [];
	if (!c.id_cliente && !c.cpf) f.push('cliente');
	if (!c.saldo) f.push('saldo');
	if (!c.dias_atraso && !c.vencimento) f.push('atraso');
	if (!(c.telefones?.length) && !(c.emails?.length)) f.push('contato');
	return f;
}

/** "Faltou apontar 2 colunas: o saldo e o telefone ou o e-mail." ('' quando nada falta). */
export function mensagemFaltam(f: Falta[]): string {
	if (!f.length) return '';
	const itens = f.map(x => NOME_FALTA[x]);
	const lista = itens.length === 1 ? itens[0] : `${itens.slice(0, -1).join(', ')} e ${itens[itens.length - 1]}`;
	return `Faltou apontar ${itens.length} coluna${itens.length > 1 ? 's' : ''}: ${lista}.`;
}

/** Erro de validação em português ('' = pode salvar). As mesmas regras de salvar_mapeamento_base. */
export function validar(c: ColunasCarga, cabecalho: string[]): string {
	const usadas: string[] = [];
	for (const [k, v] of Object.entries(c)) {
		if (k === 'documento_validacao' && v && v === c.cpf) continue;   // "usar o CPF/CNPJ já apontado"
		for (const col of Array.isArray(v) ? v : v ? [v] : []) {
			if (usadas.includes(col)) return `A coluna "${col}" foi apontada para mais de um campo. Cada campo usa uma coluna.`;
			if (cabecalho.length && !cabecalho.includes(col)) return `A coluna "${col}" não está no arquivo. Escolha uma das colunas do arquivo.`;
			usadas.push(col);
		}
	}
	return mensagemFaltam(faltam(c));
}

/** Só o que vai para o banco (sem vazios). */
export function paraSalvar(c: ColunasCarga): ColunasCarga {
	const r: ColunasCarga = {};
	for (const [k, v] of Object.entries(c)) {
		if (Array.isArray(v)) { if (v.length) (r as Record<string, unknown>)[k] = v; }
		else if (v) (r as Record<string, unknown>)[k] = v;
	}
	return r;
}

/** Exemplo da coluna para a tela: dado pessoal sempre mascarado (CPF, telefone, e-mail). */
export function exemplo(campo: CampoCarga | CampoVoz, valor: string | undefined): string {
	const v = (valor ?? '').trim();
	if (!v) return '';
	if (campo === 'cpf') return '•••.•••.•••-••';
	if (campo === 'nascimento') return '••/••/••••';      // dado de validação: nunca aparece, nem de exemplo
	if (campo === 'documento_validacao') return '•••';
	if (campo === 'telefones') { const d = v.replace(/\D/g, ''); return d.length >= 4 ? `(••) •••••-••${d.slice(-2)}` : '••••'; }
	if (campo === 'emails') return '••••@' + (v.split('@')[1] ?? '••••');
	return v.length > 24 ? v.slice(0, 24) + '…' : v;
}

export type LeituraArquivo = { cabecalho: string[]; linhas: string[][]; separador: string; total?: number };

function separadorDe(primeira: string): string {
	return [';', ',', '\t', '|'].reduce((a, b) => (primeira.split(b).length > primeira.split(a).length ? b : a), ';');
}

function partirCsv(linha: string, sep: string): string[] {
	const out: string[] = []; let atual = ''; let aspas = false;
	for (let i = 0; i < linha.length; i++) {
		const ch = linha[i];
		if (ch === '"') { if (aspas && linha[i + 1] === '"') { atual += '"'; i++; } else aspas = !aspas; }
		else if (ch === sep && !aspas) { out.push(atual.trim()); atual = ''; }
		else atual += ch;
	}
	out.push(atual.trim());
	return out;
}

/** Lê o começo de um CSV/TXT (UTF-8 ou Latin-1). */
export function lerCsv(bytes: Uint8Array, maxLinhas = 20): LeituraArquivo {
	let texto = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
	if (texto.includes('�')) texto = new TextDecoder('latin1').decode(bytes);
	texto = texto.replace(/^﻿/, '');
	const linhasTxt = texto.split(/\r?\n/).filter(l => l.trim());
	const sep = separadorDe(linhasTxt[0] ?? '');
	const cabecalho = partirCsv(linhasTxt[0] ?? '', sep);
	return { cabecalho, linhas: linhasTxt.slice(1, maxLinhas + 1).map(l => partirCsv(l, sep)), separador: sep === '\t' ? 'tab' : sep };
}

const ENTIDADES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
/** Entidades do XML numa passada só (nunca decodifica duas vezes). */
export function decodificarXml(t: string): string {
	return t.replace(/&(amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);/g, (_, e: string) =>
		e[0] === '#' ? String.fromCodePoint(e[1] === 'x' ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : ENTIDADES[e]);
}

/** Lê a 1ª aba de um .xlsx (cabeçalho + primeiras linhas) sem biblioteca de planilha. */
export function lerXlsx(bytes: Uint8Array, maxLinhas = 20): LeituraArquivo {
	const zip = unzipSync(bytes, { filter: f => f.name === 'xl/sharedStrings.xml' || /^xl\/worksheets\/sheet1\.xml$/.test(f.name) || f.name === 'xl/workbook.xml' });
	const strings: string[] = [];
	const ss = zip['xl/sharedStrings.xml'] ? strFromU8(zip['xl/sharedStrings.xml']) : '';
	for (const si of ss.match(/<si>[\s\S]*?<\/si>/g) ?? []) strings.push(Array.from(si.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g), m => decodificarXml(m[1])).join(''));
	const sheet = zip['xl/worksheets/sheet1.xml'] ? strFromU8(zip['xl/worksheets/sheet1.xml']) : '';
	const linhas: string[][] = [];
	const col = (ref: string) => { const l = ref.replace(/\d+/g, ''); let n = 0; for (const ch of l) n = n * 26 + (ch.charCodeAt(0) - 64); return n - 1; };
	for (const row of sheet.match(/<row[\s\S]*?<\/row>/g) ?? []) {
		if (linhas.length > maxLinhas) break;
		const vals: string[] = [];
		for (const c of row.match(/<c [^>]*?(\/>|>[\s\S]*?<\/c>)/g) ?? []) {
			const ref = /r="([A-Z]+\d+)"/.exec(c)?.[1] ?? '';
			const tipo = /t="([a-zA-Z]+)"/.exec(c)?.[1];
			const v = decodificarXml(/<v>([\s\S]*?)<\/v>/.exec(c)?.[1] ?? (/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/.exec(c)?.[1] ?? ''));
			vals[ref ? col(ref) : vals.length] = tipo === 's' ? (strings[Number(v)] ?? '') : v;
		}
		linhas.push(Array.from(vals, x => (x ?? '').trim()));
	}
	return { cabecalho: linhas[0] ?? [], linhas: linhas.slice(1), separador: 'planilha' };
}

/** Lê o cabeçalho e as 20 primeiras linhas do arquivo escolhido (CSV, TXT ou XLSX). Nada sai do navegador. */
export async function lerArquivo(file: File): Promise<LeituraArquivo> {
	const ehXlsx = /\.xlsx$/i.test(file.name);
	const bytes = new Uint8Array(await (ehXlsx ? file.arrayBuffer() : file.slice(0, 256 * 1024).arrayBuffer()));
	return ehXlsx ? lerXlsx(bytes) : lerCsv(bytes);
}
