// Playbook de frases por canal — tipos, normalização, variáveis e parsing de importação.
import { supabase, friendlyError, type Row } from '@/lib/supabase';

export type Frase = {
	id: string;
	empresa_id: string;
	canal: string;
	nome: string;
	estagio: string | null;
	texto: string;
	origem: 'importado' | 'criado';
	ativo: boolean;
	/** Código do template no provedor (WhatsApp/RCS). Derivado de `texto` (codigo|||preview). */
	codigo_template?: string;
	criado_em?: string;
	atualizado_em?: string;
};

/** Canais que recebem mensagem (sem enriquecimento). */
export const FRASE_CANAIS = [
	{ id: 'whatsapp', label: 'WhatsApp' },
	{ id: 'rcs', label: 'RCS' },
	{ id: 'sms', label: 'SMS' },
	{ id: 'email', label: 'E-mail' },
	{ id: 'agente_voz', label: 'Agente virtual' },
	{ id: 'discador', label: 'Discador' },
] as const;

/** Estágios sugeridos para uma frase. */
export const FRASE_ESTAGIOS = [
	{ id: 'localizacao', label: 'Cliente novo' },
	{ id: 'cpc_a', label: 'CPC A' },
	{ id: 'cpc_b', label: 'CPC B' },
	{ id: 'giro', label: 'Não CPC' },
	{ id: 'preventivo', label: 'Preventivo' },
	{ id: 'quebra', label: 'Quebra' },
	{ id: 'qualquer', label: 'Qualquer' },
] as const;

export const estagioLabel: Record<string, string> = Object.fromEntries(FRASE_ESTAGIOS.map(e => [e.id, e.label]));
export const fraseCanalLabel: Record<string, string> = Object.fromEntries(FRASE_CANAIS.map(c => [c.id, c.label]));

// ---- tipo de mensagem por canal ----
/**
 * Como cada canal escolhe mensagem:
 * - 'template': WhatsApp e RCS — template aprovado no provedor (linha com codigo_template).
 * - 'frase': SMS e Agente virtual — frase da empresa.
 * - 'nenhuma': Discador, E-mail e Enriquecimento — sem mensagem.
 */
export function canalTipoMensagem(canal: string): 'template' | 'frase' | 'nenhuma' {
	if (canal === 'whatsapp' || canal === 'rcs') return 'template';
	if (canal === 'sms' || canal === 'agente_voz') return 'frase';
	return 'nenhuma';
}

/** Canais que têm aba de frases/templates na tela Canais. */
export const CANAIS_COM_MENSAGEM = ['whatsapp', 'rcs', 'sms', 'agente_voz'] as const;

// ---- normalização de apelidos ----
const canalApelidos: Record<string, string> = {
	whatsapp: 'whatsapp', whats: 'whatsapp', wa: 'whatsapp', 'whatsapp business': 'whatsapp',
	rcs: 'rcs',
	sms: 'sms', 'sms curto': 'sms',
	email: 'email', 'e-mail': 'email', 'e mail': 'email', mail: 'email',
	agente_voz: 'agente_voz', 'agente virtual': 'agente_voz', agente: 'agente_voz', voz: 'agente_voz', 'agente de voz': 'agente_voz',
	discador: 'discador', discador_predictivo: 'discador',
};
const estagioApelidos: Record<string, string> = {
	localizacao: 'localizacao', 'cliente novo': 'localizacao', cliente_novo: 'localizacao', novo: 'localizacao',
	cpc_a: 'cpc_a', 'cpc a': 'cpc_a', cpca: 'cpc_a', a: 'cpc_a',
	cpc_b: 'cpc_b', 'cpc b': 'cpc_b', cpcb: 'cpc_b', b: 'cpc_b',
	giro: 'giro', 'nao cpc': 'giro', 'não cpc': 'giro', nao_cpc: 'giro', 'não_cpc': 'giro',
	preventivo: 'preventivo', 'acordo preventivo': 'preventivo',
	quebra: 'quebra', 'acordo quebra': 'quebra',
	qualquer: 'qualquer', todos: 'qualquer', qualquer_estagio: 'qualquer',
};

export function normalizarCanal(v: string | null | undefined): string | null {
	const k = (v ?? '').trim().toLowerCase();
	if (!k) return null;
	return canalApelidos[k] ?? null;
}
export function normalizarEstagio(v: string | null | undefined): string | null {
	const k = (v ?? '').trim().toLowerCase();
	if (!k) return null;
	return estagioApelidos[k] ?? null;
}

// ---- variáveis ----
/** Variáveis que o MotorCob preenche sozinho. */
export const VARS_MOTORCOB = new Set(['saldo', 'dias_atraso', 'vencimento', 'valor_parcela', 'qtd_parcelas_abertas']);

export const variavelLabel: Record<string, string> = {
	saldo: 'Saldo', dias_atraso: 'Dias de atraso', vencimento: 'Vencimento',
	valor_parcela: 'Valor da parcela', qtd_parcelas_abertas: 'Parcelas abertas',
	nome: 'Nome', link: 'Link',
};

export const exemploValores: Record<string, string> = {
	saldo: 'R$ 1.234,50', dias_atraso: '32', vencimento: '15/10/2026',
	valor_parcela: 'R$ 150,00', qtd_parcelas_abertas: '3',
	nome: 'João', link: 'https://motorcob.online/p',
};

/** Extrai as variáveis {x} do texto, na ordem de aparição, sem repetir. */
export function extrairVariaveis(texto: string): string[] {
	const matches = texto.match(/\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g) ?? [];
	const seen = new Set<string>();
	const out: string[] = [];
	for (const m of matches) {
		const name = m.slice(1, -1).toLowerCase();
		if (!seen.has(name)) { seen.add(name); out.push(name); }
	}
	return out;
}

/** Substitui as variáveis conhecidas pelos valores de exemplo. */
export function previsualizar(texto: string): string {
	return texto.replace(/\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g, (full, name: string) => {
		const k = name.toLowerCase();
		return exemploValores[k] ?? full;
	});
}

/** Conta quantas mensagens SMS (160 chars) o texto gera. */
export function smsMensagens(texto: string): number {
	if (!texto) return 0;
	return Math.max(1, Math.ceil(texto.length / 160));
}

// ---- templates (WhatsApp/RCS): codigo + preview codificados em `texto` ----
// Sem coluna dedicada no banco (não mudar tabelas): o código do template fica
// codificado no campo `texto` como "codigo|||preview".
const TPL_SEP = '|||';
export function packTemplateTexto(codigo: string, preview: string): string {
	return `${codigo}${TPL_SEP}${preview}`;
}
export function unpackTemplateTexto(texto: string): { codigo: string; preview: string } | null {
	if (!texto) return null;
	const idx = texto.indexOf(TPL_SEP);
	if (idx < 0) return null;
	return { codigo: texto.slice(0, idx), preview: texto.slice(idx + TPL_SEP.length) };
}
/** Código do template de uma frase (WhatsApp/RCS), ou '' se não for template. */
export function templateCodigoOf(f: { texto?: string }): string {
	return unpackTemplateTexto(f.texto ?? '')?.codigo ?? '';
}
/** Prévia do texto de uma frase: decodificada para templates, plain para frases. */
export function templatePreviewOf(f: { texto?: string }): string {
	const u = unpackTemplateTexto(f.texto ?? '');
	return u ? u.preview : (f.texto ?? '');
}
/** Prévia de exibição de uma frase (decodifica template quando preciso). */
export function frasePreview(f: Frase): string {
	return canalTipoMensagem(f.canal) === 'template' ? templatePreviewOf(f) : f.texto;
}

// ---- carregar / salvar frases ----
export async function carregarFrases(empresaId: string): Promise<{ frases: Frase[]; error: string }> {
	if (!supabase) return { frases: [], error: 'Configuração ausente.' };
	const { data, error } = await supabase.from('frases').select('*').eq('empresa_id', empresaId).order('canal').order('nome');
	if (error) return { frases: [], error: friendlyError(error) };
	const frases = ((data ?? []) as Frase[]).map(f => {
		if (canalTipoMensagem(f.canal) === 'template') f.codigo_template = templateCodigoOf(f);
		return f;
	});
	return { frases, error: '' };
}

export async function salvarFrase(frase: Partial<Frase> & { empresa_id: string; canal: string; nome: string; texto: string }): Promise<{ frase: Frase | null; error: string }> {
	if (!supabase) return { frase: null, error: 'Configuração ausente.' };
	const isTemplate = canalTipoMensagem(frase.canal) === 'template';
	const textoFinal = isTemplate ? packTemplateTexto((frase.codigo_template ?? '').trim(), frase.texto) : frase.texto;
	const payload = {
		empresa_id: frase.empresa_id, canal: frase.canal, nome: frase.nome.trim(),
		estagio: isTemplate ? null : (frase.estagio || null), texto: textoFinal, origem: frase.origem ?? 'criado',
		ativo: frase.ativo ?? true,
	};
	if (frase.id) {
		const { data, error } = await supabase.from('frases').update({ ...payload, atualizado_em: new Date().toISOString() }).eq('id', frase.id).select('*').single();
		if (error) return { frase: null, error: friendlyError(error) };
		return { frase: data as Frase, error: '' };
	}
	const { data, error } = await supabase.from('frases').insert(payload).select('*').single();
	if (error) return { frase: null, error: friendlyError(error) };
	return { frase: data as Frase, error: '' };
}

export async function excluirFrase(id: string): Promise<{ error: string }> {
	if (!supabase) return { error: 'Configuração ausente.' };
	const { error } = await supabase.from('frases').delete().eq('id', id);
	if (error) return { error: friendlyError(error) };
	return { error: '' };
}

export async function toggleFraseAtiva(id: string, ativo: boolean): Promise<{ error: string }> {
	if (!supabase) return { error: 'Configuração ausente.' };
	const { error } = await supabase.from('frases').update({ ativo, atualizado_em: new Date().toISOString() }).eq('id', id);
	if (error) return { error: friendlyError(error) };
	return { error: '' };
}

// ---- contagem de uso em estratégias ----
/** Conta em quantas estratégias a frase é usada (procura "frase_id": <id> em estrategias.definicao). */
export async function contarUsoFrase(empresaId: string, fraseId: string): Promise<number> {
	if (!supabase) return 0;
	const { data } = await supabase.from('estrategias').select('id,definicao').eq('empresa_id', empresaId);
	if (!data) return 0;
	let n = 0;
	const alvo = `"frase_id":"${fraseId}"`;
	const alvo2 = `"frase_id": "${fraseId}"`;
	for (const r of data as Row[]) {
		const def = r.definicao;
		const s = typeof def === 'string' ? def : JSON.stringify(def ?? {});
		if (s.includes(alvo) || s.includes(alvo2)) n++;
	}
	return n;
}

// ---- parsing de importação ----
export type LinhaImport = { canal: string | null; estagio: string | null; nome: string; texto: string; codigo_template: string; linha: number };
export type LinhaPreview = LinhaImport & {
	chave: string | null; // canal normalizado
	estagioChave: string | null;
	erro: string | null;
	acao: 'nova' | 'atualizar' | 'erro';
};

export async function parsePlanilha(file: ArrayBuffer): Promise<LinhaImport[]> {
	const XLSX = await import('xlsx');
	const wb = XLSX.read(file, { type: 'array' });
	const ws = wb.Sheets[wb.SheetNames[0]];
	const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' }) as unknown[][];
	const out: LinhaImport[] = [];
	if (rows.length === 0) return out;
	const header = (rows[0] as unknown[]).map(c => String(c ?? '').trim().toLowerCase());
	const idxCanal = header.findIndex(h => h === 'canal');
	const idxEstagio = header.findIndex(h => h.startsWith('estag') || h.startsWith('estág'));
	const idxNome = header.findIndex(h => h === 'nome');
	const idxTexto = header.findIndex(h => h === 'texto' || h.startsWith('mensa') || h.startsWith('frase'));
	const idxCodigo = header.findIndex(h => h.includes('codigo') || h.includes('código'));
	const startRow = idxNome >= 0 || idxCanal >= 0 ? 1 : 0;
	for (let i = startRow; i < rows.length; i++) {
		const r = rows[i] as unknown[];
		if (!r || r.every(c => c === '' || c == null)) continue;
		const canal = idxCanal >= 0 ? String(r[idxCanal] ?? '').trim() : '';
		const estagio = idxEstagio >= 0 ? String(r[idxEstagio] ?? '').trim() : '';
		const nome = idxNome >= 0 ? String(r[idxNome] ?? '').trim() : String(r[0] ?? '').trim();
		const texto = idxTexto >= 0 ? String(r[idxTexto] ?? '').trim() : '';
		const codigo = idxCodigo >= 0 ? String(r[idxCodigo] ?? '').trim() : '';
		out.push({ canal, estagio, nome, texto, codigo_template: codigo, linha: i + 1 });
	}
	return out;
}

/** CSV simples que aceita ; ou , como separador. */
export function parseCsv(text: string): LinhaImport[] {
	const lines = text.split(/\r?\n/).filter(l => l.trim() !== '');
	if (lines.length === 0) return [];
	const sep = (lines[0].match(/;/g)?.length ?? 0) >= (lines[0].match(/,/g)?.length ?? 0) ? ';' : ',';
	function splitRow(line: string): string[] {
		const cells: string[] = [];
		let cur = '';
		let inQuote = false;
		for (let i = 0; i < line.length; i++) {
			const ch = line[i];
			if (ch === '"') { inQuote = !inQuote; continue; }
			if (!inQuote && ch === sep) { cells.push(cur); cur = ''; continue; }
			cur += ch;
		}
		cells.push(cur);
		return cells.map(c => c.trim());
	}
	const header = splitRow(lines[0]).map(h => h.toLowerCase());
	const idxCanal = header.findIndex(h => h === 'canal');
	const idxEstagio = header.findIndex(h => h.startsWith('estag') || h.startsWith('estág'));
	const idxNome = header.findIndex(h => h === 'nome');
	const idxTexto = header.findIndex(h => h === 'texto' || h.startsWith('mensa') || h.startsWith('frase'));
	const idxCodigo = header.findIndex(h => h.includes('codigo') || h.includes('código'));
	const startRow = idxNome >= 0 || idxCanal >= 0 ? 1 : 0;
	const out: LinhaImport[] = [];
	for (let i = startRow; i < lines.length; i++) {
		const cells = splitRow(lines[i]);
		const canal = idxCanal >= 0 ? cells[idxCanal] ?? '' : '';
		const estagio = idxEstagio >= 0 ? cells[idxEstagio] ?? '' : '';
		const nome = idxNome >= 0 ? cells[idxNome] ?? '' : cells[0] ?? '';
		const texto = idxTexto >= 0 ? cells[idxTexto] ?? '' : '';
		const codigo = idxCodigo >= 0 ? cells[idxCodigo] ?? '' : '';
		out.push({ canal, estagio, nome, texto, codigo_template: codigo, linha: i + 1 });
	}
	return out;
}

/** Monta a prévia: classifica cada linha em nova / atualizar / erro. */
export function classificarImport(linhas: LinhaImport[], existentes: Frase[], atualizar: boolean): LinhaPreview[] {
	const existMap = new Map<string, Frase>();
	for (const f of existentes) existMap.set(`${f.canal}|${f.nome.toLowerCase()}`, f);
	return linhas.map(l => {
		const chave = normalizarCanal(l.canal);
		const estagioChave = l.estagio ? normalizarEstagio(l.estagio) : null;
		let erro: string | null = null;
		if (!chave) erro = `canal desconhecido: "${l.canal}"`;
		else if (canalTipoMensagem(chave) === 'nenhuma') erro = `${fraseCanalLabel[chave] ?? chave} não usa frase/template`;
		else if (!l.nome.trim()) erro = 'sem nome';
		else if (!l.texto.trim()) erro = 'sem texto';
		else if (l.texto.length > 2000) erro = `texto com ${l.texto.length} caracteres (máx 2000)`;
		else if (canalTipoMensagem(chave) === 'template' && !l.codigo_template.trim()) erro = 'Cadastre o código do template no provedor';
		const exist = chave ? existMap.get(`${chave}|${l.nome.toLowerCase()}`) : undefined;
		let acao: 'nova' | 'atualizar' | 'erro' = 'nova';
		if (erro) acao = 'erro';
		else if (exist) acao = atualizar ? 'atualizar' : 'nova';
		return { ...l, chave, estagioChave, erro, acao };
	});
}

/** Conteúdo do modelo CSV para download. */
export const MODELO_CSV = 'canal;estagio;nome;codigo_template;texto\nwhatsapp;;Lembrete saldo;modelo_saldo;Olá {nome}, seu saldo é {saldo}. Vence em {vencimento}.\nsms;preventivo;;Lembrete: parcela de {valor_parcela} vence amanhã. {link}\n';

export async function importarFrases(empresaId: string, preview: LinhaPreview[]): Promise<{ gravadas: number; error: string }> {
	if (!supabase) return { gravadas: 0, error: 'Configuração ausente.' };
	const validas = preview.filter(p => p.acao !== 'erro' && p.chave);
	if (validas.length === 0) return { gravadas: 0, error: '' };
	const upserts = validas.map(p => {
		const isTemplate = canalTipoMensagem(p.chave!) === 'template';
		const texto = isTemplate ? packTemplateTexto(p.codigo_template.trim(), p.texto) : p.texto;
		return {
			empresa_id: empresaId, canal: p.chave!, nome: p.nome.trim(),
			estagio: isTemplate ? null : (p.estagioChave ?? null), texto, origem: 'importado' as const, ativo: true,
		};
	});
	const { error } = await supabase.from('frases').upsert(upserts, { onConflict: 'empresa_id,canal,nome' });
	if (error) return { gravadas: 0, error: friendlyError(error) };
	return { gravadas: validas.length, error: '' };
}
