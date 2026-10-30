// Tipos, metadados e helpers do produto Jornada (frente MotorCli).

export type MomentoId = 'pre_vencimento' | 'boas_vindas' | 'ativacao' | 'retencao' | 'reativacao';

export type MomentoMeta = {
	id: MomentoId;
	nome: string;
	min: number;
	max: number;
	prefixo: string;
	descricao: string;
};

/** Ordem dos cards na tela Início. */
export const MOMENTOS: MomentoMeta[] = [
	{ id: 'pre_vencimento', nome: 'Pré-vencimento', min: -5, max: 0, prefixo: 'D', descricao: 'Dias até o vencimento' },
	{ id: 'boas_vindas', nome: 'Boas-vindas', min: 0, max: 2, prefixo: 'D+', descricao: 'Dias desde a contratação' },
	{ id: 'ativacao', nome: 'Ativação', min: 3, max: 30, prefixo: 'D+', descricao: 'Dias desde a contratação' },
	{ id: 'retencao', nome: 'Retenção', min: 30, max: 89, prefixo: 'D+', descricao: 'Dias sem atividade' },
	{ id: 'reativacao', nome: 'Reativação', min: 90, max: 365, prefixo: 'D+', descricao: 'Dias sem atividade' },
];

export const MOMENTO_NOME: Record<string, string> = Object.fromEntries(MOMENTOS.map(m => [m.id, m.nome]));

/** regua (acoes_dia) → nome na tela. */
export const REGUA_NOME: Record<string, string> = {
	boas_vindas: 'Boas-vindas',
	ativacao: 'Ativação',
	pre_vencimento: 'Pré-vencimento',
	retencao: 'Retenção',
	reativacao: 'Reativação',
};

/** Canais disponíveis num passo da jornada. */
export const JORNADA_CANAIS = [
	{ id: 'whatsapp', nome: 'WhatsApp' },
	{ id: 'rcs', nome: 'RCS' },
	{ id: 'sms', nome: 'SMS' },
	{ id: 'email', nome: 'E-mail' },
	{ id: 'agente_voz', nome: 'Agente virtual' },
	{ id: 'discador', nome: 'Discador' },
	{ id: 'melhor', nome: 'Melhor canal' },
] as const;

export const CANAL_NOME: Record<string, string> = Object.fromEntries(JORNADA_CANAIS.map(c => [c.id, c.nome]));

/** Um passo da jornada: canal + fallback (senão) opcional. "Melhor canal" traz opcoes.
 *  frase_id aponta para uma frase da empresa (estagio = momento, canal = passo.canal). */
export type PassoJornada = { canal: string; senao?: string; opcoes?: string[]; frase_id?: string };
export type PassosJornada = Record<string, PassoJornada[]>;

/** Orçamento por canal de um momento: { canal: quantidade }. null/undefined = sem limite. */
export type OrcamentoMomento = Record<string, number | null>;

export type MomentoDef = { ativo: boolean; passos?: PassosJornada; orcamento?: OrcamentoMomento; dias_semana?: number[] };

/** Travas da estratégia de jornada (valem para todos os momentos). */
export type TravasJornada = {
	intervalo_horas?: number | null;
	de?: string | null;
	ate?: string | null;
	domingo?: boolean | null;
	por_semana?: number | null;
};

export type DefinicaoJornada = {
	recencia_horas: number;
	hierarquia?: MomentoId[];
	momentos: Partial<Record<MomentoId, MomentoDef>>;
	travas?: TravasJornada;
	etapas?: Record<string, unknown>;
};

/** Ordem padrão dos momentos na hierarquia. */
export const HIERARQUIA_DEFAULT: MomentoId[] = [
	'pre_vencimento', 'boas_vindas', 'ativacao', 'retencao', 'reativacao',
];

/** Padrão do MotorCli (mostrado em cinza quando o momento não está personalizado). */
export const DEFAULT_PASSOS: Record<MomentoId, PassosJornada> = {
	boas_vindas: { '0': [{ canal: 'email' }, { canal: 'rcs', senao: 'sms' }] },
	ativacao: {
		'3': [{ canal: 'whatsapp', senao: 'sms' }],
		'7': [{ canal: 'whatsapp', senao: 'sms' }],
		'15': [{ canal: 'rcs', senao: 'sms' }],
		'30': [{ canal: 'email' }],
	},
	pre_vencimento: {
		'-5': [{ canal: 'rcs', senao: 'sms' }],
		'-2': [{ canal: 'whatsapp' }],
		'0': [{ canal: 'whatsapp' }],
	},
	retencao: {
		'30': [{ canal: 'whatsapp', senao: 'sms' }],
		'45': [{ canal: 'rcs', senao: 'sms' }],
		'60': [{ canal: 'email' }],
		'75': [{ canal: 'sms' }],
	},
	reativacao: {
		'90': [{ canal: 'sms' }],
		'120': [{ canal: 'email' }],
		'180': [{ canal: 'sms' }],
		'270': [{ canal: 'email' }],
	},
};

/** Rótulo do dia conforme o momento (D-5, D0, D+3…). */
export function diaLabel(momento: MomentoId, dia: number): string {
	if (momento === 'pre_vencimento') return `D${dia}`;
	return dia === 0 ? 'D0' : `D+${dia}`;
}

/** True se o dia está dentro da faixa permitida do momento. */
export function diaValido(momento: MomentoId, dia: number): boolean {
	const m = MOMENTOS.find(x => x.id === momento)!;
	return dia >= m.min && dia <= m.max;
}

/** Frase curta de um passo (canal [senão x] [+ opções]). */
export function passoFrase(p: PassoJornada): string {
	const c = CANAL_NOME[p.canal] ?? p.canal;
	let s = c;
	if (p.senao) s += ` senão ${CANAL_NOME[p.senao] ?? p.senao}`;
	if (p.canal === 'melhor' && p.opcoes?.length) s += ` (${p.opcoes.map(o => CANAL_NOME[o] ?? o).join(', ')})`;
	return s;
}

/** Frase dos passos de um dia. */
export function diaPassosFrase(passos: PassoJornada[]): string {
	return passos.map(passoFrase).join(' + ');
}

/** Normaliza uma definição vinda do banco para a forma esperada (preserva travas/etapas). */
export function normalizarDefinicao(d: unknown): DefinicaoJornada {
	const obj = (d ?? {}) as Record<string, unknown>;
	const rec = Number(obj.recencia_horas);
	const momentos = (obj.momentos ?? {}) as Record<string, unknown>;
	const out: DefinicaoJornada = { recencia_horas: Number.isFinite(rec) && rec > 0 ? rec : 48, momentos: {} };
	if (Array.isArray(obj.hierarquia)) {
		out.hierarquia = (obj.hierarquia as string[]).filter((x): x is MomentoId =>
			HIERARQUIA_DEFAULT.includes(x as MomentoId));
	}
	for (const m of MOMENTOS) {
		const raw = momentos[m.id] as MomentoDef | undefined;
		if (!raw) continue;
		const passos = raw.passos ?? {};
		const normPassos: PassosJornada = {};
		for (const [k, v] of Object.entries(passos)) {
			if (Array.isArray(v)) normPassos[k] = (v as PassoJornada[]).map(p => ({
				canal: p.canal, senao: p.senao, opcoes: p.opcoes, frase_id: p.frase_id,
			})).filter(p => p.canal);
		}
		out.momentos[m.id] = { ativo: raw.ativo !== false, passos: normPassos, orcamento: raw.orcamento ?? undefined, dias_semana: Array.isArray(raw.dias_semana) ? raw.dias_semana as number[] : undefined };
	}
	if (obj.travas && typeof obj.travas === 'object') out.travas = obj.travas as TravasJornada;
	if (obj.etapas && typeof obj.etapas === 'object') out.etapas = obj.etapas as Record<string, unknown>;
	return out;
}

/** Definição padrão (todos os momentos ligados, sem passos personalizados). */
export function definicaoPadrao(): DefinicaoJornada {
	return { recencia_horas: 48, hierarquia: [...HIERARQUIA_DEFAULT], momentos: {} };
}

/** Hierarquia efetiva: a salva, ou a padrão. Garante os 5 momentos, cada um uma vez. */
export function hierarquiaEfetiva(d: DefinicaoJornada): MomentoId[] {
	const h = d.hierarquia?.length ? d.hierarquia : [...HIERARQUIA_DEFAULT];
	const seen = new Set<MomentoId>();
	const out: MomentoId[] = [];
	for (const m of h) { if (!seen.has(m)) { seen.add(m); out.push(m); } }
	for (const m of HIERARQUIA_DEFAULT) { if (!seen.has(m)) { seen.add(m); out.push(m); } }
	return out;
}

/** Texto legível do dia de um passo ("5 dias antes do vencimento"). */
export function diaTexto(momento: MomentoId, dia: number): string {
	const abs = Math.abs(dia);
	const plural = abs === 1 ? '' : 's';
	if (momento === 'pre_vencimento') {
		if (dia === 0) return 'No dia do vencimento';
		return `${abs} dia${plural} antes do vencimento`;
	}
	if (momento === 'boas_vindas') {
		if (dia === 0) return 'No dia da contratação';
		return `${abs} dia${plural} depois da contratação`;
	}
	if (momento === 'ativacao') return `${abs} dia${plural} depois da contratação`;
	if (momento === 'retencao') return `${abs} dia${plural} sem atividade`;
	return `${abs} dia${plural} sem atividade`;
}

/** True se o momento está personalizado (tem passos não vazios). */
export function momentoPersonalizado(d: DefinicaoJornada, m: MomentoId): boolean {
	const p = d.momentos[m]?.passos;
	if (!p) return false;
	return Object.keys(p).length > 0;
}

/** True se o momento está ligado (default: ligado). */
export function momentoAtivo(d: DefinicaoJornada, m: MomentoId): boolean {
	const v = d.momentos[m];
	return v ? v.ativo !== false : true;
}

/** Valida os dias de todos os momentos personalizados. Retorna mensagem de erro ou ''. */
export function validarDias(d: DefinicaoJornada): string {
	for (const m of MOMENTOS) {
		const passos = d.momentos[m.id]?.passos;
		if (!passos) continue;
		for (const dia of Object.keys(passos)) {
			const n = Number(dia);
			if (!Number.isFinite(n) || !diaValido(m.id, n)) {
				return `${MOMENTO_NOME[m.id]}: dia ${dia} fora da faixa permitida (${MOMENTOS.find(x => x.id === m.id)!.min} a ${MOMENTOS.find(x => x.id === m.id)!.max}).`;
			}
		}
	}
	return '';
}
