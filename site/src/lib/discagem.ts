// Discagem da carteira: leitura/escrita em credores.discagem (jsonb objeto).
// O site só lê execucoes.resumo/alertas e estrategias.definicao.ligacoes. Nada é criado/alterado no banco.

export type JanelaHorario = { seg_sex: [string, string] | null; sabado: [string, string] | null };
export type HorariosTabela = { hora: 'local'; ufs: Record<string, JanelaHorario>; ddds: Record<string, JanelaHorario> };

export type Discagem = {
	tentativas_numero_dia?: number;
	tentativas_cliente_dia?: number | null;
	intervalo_min_minutos?: number;
	intervalo_ocupado_minutos?: number;
	descanso_nao_atende?: { ativo: boolean; n: number; em_dias: number; descansa_dias: number };
	descanso_recusa?: { ativo: boolean; dias: number };
	promessa_suspende?: { ativo: boolean; dias_sem_data: number };
	inexistente?: { ativo: boolean; modo?: 'so_voz' | 'invalida' };
	nao_ligar?: { ativo: boolean };
	horarios?: { ativo: boolean; tabela?: HorariosTabela | null };
	chamadas_curtas?: {
		ativo: boolean;
		aviso: number; // fração 0.01–1
		corte_ativo: boolean;
		corte: number; // fração 0.01–1
		max_por_numero_dia: number;
		max_total_dia: number;
		segundos: number; // 1–60
		abandono_conta: boolean;
		falha_conta?: boolean; // SQL 65: falha técnica conta como curta (padrão: sim)
	};
	// SQL 65 · Renitência por situação e Resubmit (src/lib/renitencia.ts). Sem a chave = o de hoje.
	retorno_agendado?: { max_dias?: number } & Record<string, unknown>;
	por_situacao?: Record<string, Record<string, unknown>>;
	falhas_tecnicas?: Record<string, Record<string, unknown>>;
	// a edição destes três chega com o redesign; o site só preserva o que estiver salvo
	por_sinalizacao?: Record<string, unknown> | null;
	modo_discagem?: Record<string, unknown> | null;
	reciclagem_auto?: Record<string, unknown> | null;
};

export type LigacoesTrava = {
	ativo?: boolean;
	por_dia?: number;
	por_numero?: number;
	intervalo_min?: number;
	intervalo_ocupado?: number;
};

export type LigacoesInfo = {
	tentativas_cliente_dia?: { nomes: string[]; valor: number };
	tentativas_numero_dia?: { nomes: string[]; valor: number };
	intervalo_min_minutos?: { nomes: string[]; valor: number };
	intervalo_ocupado_minutos?: { nomes: string[]; valor: number };
};

export type DiscagemExecResumo = {
	chamadas_curtas?: {
		medido?: { chamadas: number; curtas: number; fracao: number }[];
		previsao?: { chamadas: number; curtas: number; fracao: number } | null;
		linhas_minimas?: number;
		cortados?: number;
		previsao_depois?: { chamadas: number; curtas: number; fracao: number } | null;
	};
	renitencia?: { recusa?: number; promessa?: number; nao_ligar?: number };
	horario_fora_por_uf?: Record<string, number>;
	// O motor grava (rodar_dia.py): regras_desligadas = {resultado: linhas trocadas hoje}; mailing = nº de linhas
	// do discador_mailing.csv. Execuções antigas podem ter lista; o leitor aceita as duas formas.
	regras_desligadas?: Record<string, number> | string[];
	mailing?: number | string[];
};

const REGRA_DESLIGADA: Record<string, string> = {
	numero_inexistente: 'Bloqueio de inexistente desligado: “número inexistente” contou como falha de rede',
	opt_out: 'Lista “não ligar” desligada: “não ligar” contou como atendida sem CPC',
};

/** Linhas de “Regras desligadas” a partir do que o motor grava ({resultado: quantidade} ou lista antiga). */
export function linhasRegrasDesligadas(rd: DiscagemExecResumo['regras_desligadas']): string[] {
	if (!rd) return [];
	if (Array.isArray(rd)) return rd.map(String);
	return Object.entries(rd)
		.filter(([, n]) => Number(n) > 0)
		.map(([k, n]) => `${REGRA_DESLIGADA[k] ?? k}: ${Number(n).toLocaleString('pt-BR')} ${Number(n) === 1 ? 'linha' : 'linhas'}`);
}

/** Linhas do mailing do discador: o motor grava a quantidade (número); execuções antigas, lista. */
export function linhasMailing(m: DiscagemExecResumo['mailing']): string[] {
	if (m === undefined || m === null) return [];
	if (Array.isArray(m)) return m.map(String);
	const n = Number(m);
	return Number.isFinite(n) ? [`discador_mailing.csv: ${n.toLocaleString('pt-BR')} ${n === 1 ? 'linha' : 'linhas'} (um telefone por linha, na ordem de discagem)`] : [];
}

export type DiscagemProps = {
	draft: Discagem;
	update: (patch: Partial<Discagem>) => void;
	reverter: (key: keyof Discagem) => void;
	canEdit: boolean;
};

// Sugestões do MotorCX (chave ausente = estes valores).
export const SUGESTOES: Discagem = {
	tentativas_numero_dia: 2,
	tentativas_cliente_dia: undefined,
	intervalo_min_minutos: 120,
	intervalo_ocupado_minutos: 15,
	descanso_nao_atende: { ativo: false, n: 6, em_dias: 3, descansa_dias: 7 },
	descanso_recusa: { ativo: false, dias: 7 },
	promessa_suspende: { ativo: false, dias_sem_data: 7 },
	inexistente: { ativo: true },
	nao_ligar: { ativo: true },
	horarios: { ativo: false, tabela: null },
	chamadas_curtas: { ativo: true, aviso: 0.75, corte_ativo: false, corte: 0.80, max_por_numero_dia: 900, max_total_dia: 9000, abandono_conta: true, segundos: 6 },
};

// Prévia MotorCX de horários por UF/DDD (seg–sex / sábado). "não" = null. Fonte: Portal ContraPonto, 28/01/2026.
const j = (ss: [string, string] | null, sab: [string, string] | null): JanelaHorario => ({ seg_sex: ss, sabado: sab });
export const PREVIA_UFS: Record<string, JanelaHorario> = {
	SP: j(['08:00', '19:50'], ['08:00', '13:50']),
	RJ: j(['09:00', '18:50'], null),
	MG: j(['08:00', '19:50'], null),
	RS: j(['08:00', '18:50'], null),
	ES: j(['08:00', '18:50'], null),
	CE: j(['08:00', '18:50'], null),
	PR: j(['08:00', '18:50'], ['08:00', '12:50']),
	DF: j(['08:00', '17:50'], ['08:00', '13:50']),
	PA: j(['08:00', '17:50'], ['08:00', '13:50']),
	GO: j(['08:00', '17:50'], ['08:00', '12:50']),
	PE: j(['08:00', '18:50'], ['08:00', '14:50']),
	PI: j(['08:00', '18:50'], ['08:00', '13:50']),
	AL: j(['08:00', '19:50'], ['08:00', '13:50']),
	AM: j(['08:00', '17:50'], ['08:00', '13:50']),
	MT: j(['08:00', '19:50'], ['09:00', '14:50']),
	MS: j(['08:00', '19:50'], ['09:00', '14:50']),
	RO: j(['08:00', '19:50'], ['09:00', '14:50']),
	RR: j(['08:00', '19:50'], ['09:00', '14:50']),
	AC: j(['08:00', '18:50'], ['09:00', '13:50']),
	BA: j(['07:00', '20:50'], ['09:00', '15:50']),
	MA: j(['07:00', '20:50'], ['09:00', '15:50']),
	PB: j(['07:00', '20:50'], ['09:00', '15:50']),
	SC: j(['07:00', '20:50'], ['09:00', '15:50']),
	SE: j(['07:00', '20:50'], ['09:00', '15:50']),
	TO: j(['07:00', '20:50'], ['09:00', '15:50']),
	AP: j(['07:00', '20:50'], ['09:00', '15:50']),
	RN: j(['08:00', '18:50'], null),
};
export const PREVIA_DDDS: Record<string, JanelaHorario> = {
	'48': j(['08:00', '18:50'], ['08:00', '13:50']),
	'84': j(['08:00', '18:50'], null),
};
// UFs com DDD próprio na prévia (para avisar ao ajustar a UF).
export const UF_DDD_PREVIA: Record<string, string> = { SC: '48', RN: '84' };

export const UFS = ['AC', 'AL', 'AM', 'AP', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MG', 'MT', 'MS', 'PA', 'PB', 'PE', 'PI', 'PR', 'RJ', 'RN', 'RO', 'RR', 'RS', 'SC', 'SE', 'SP', 'TO'];
export const DDDS_VALIDOS = ['11', '12', '13', '14', '15', '16', '17', '18', '19', '21', '22', '24', '27', '28', '31', '32', '33', '34', '35', '37', '38', '41', '42', '43', '44', '45', '46', '47', '48', '49', '51', '53', '54', '55', '61', '62', '63', '64', '65', '66', '67', '68', '69', '71', '73', '74', '75', '77', '79', '81', '82', '83', '84', '85', '86', '87', '88', '89', '91', '92', '93', '94', '95', '96', '97', '98', '99'];

/** Igualdade profunda estável (ordem de chaves não importa). */
export function stableEqual(a: unknown, b: unknown): boolean {
	if (a === b) return true;
	if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false;
	if (Array.isArray(a) || Array.isArray(b)) {
		if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
		return a.every((v, i) => stableEqual(v, b[i]));
	}
	const ka = Object.keys(a as object).sort();
	const kb = Object.keys(b as object).sort();
	if (ka.length !== kb.length || !ka.every((k, i) => k === kb[i])) return false;
	return ka.every(k => stableEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
}

/** Definição efetiva = sugestões mescladas com os overrides gravados. */
export function effectiveDiscagem(stored: Record<string, unknown> | null | undefined): Discagem {
	return { ...SUGESTOES, ...(stored as Discagem) };
}

/** Calcula a saída de horários: ativo false → omitir; ativo true → { ativo, tabela? }. */
function computarHorariosSaida(h: Discagem['horarios']): Record<string, unknown> | null {
	const ativo = h?.ativo ?? false;
	if (!ativo) return null; // ausente = sugestão
	const tabela = h?.tabela;
	const ufs: Record<string, JanelaHorario> = {};
	const ddds: Record<string, JanelaHorario> = {};
	for (const [uf, jan] of Object.entries(tabela?.ufs ?? {})) {
		const prev = PREVIA_UFS[uf];
		if (!prev || !stableEqual(jan, prev)) ufs[uf] = jan;
	}
	for (const [dd, jan] of Object.entries(tabela?.ddds ?? {})) {
		const prev = PREVIA_DDDS[dd];
		if (!prev || !stableEqual(jan, prev)) ddds[dd] = jan;
	}
	const hasOv = Object.keys(ufs).length > 0 || Object.keys(ddds).length > 0;
	return hasOv ? { ativo: true, tabela: { hora: 'local', ufs, ddds } } : { ativo: true };
}

/** Diff: só as chaves que diferem da sugestão. Preserva chaves desconhecidas. Nunca grava null
 *  (exceto tentativas_cliente_dia, que aceita null/"" = valor da estratégia → aqui omitido). */
export function computeDiff(draft: Discagem): Record<string, unknown> {
	const out: Record<string, unknown> = {};
	const keys = new Set<string>([...Object.keys(SUGESTOES), ...Object.keys(draft)]);
	for (const key of keys) {
		const k = key as keyof Discagem;
		if (k === 'tentativas_cliente_dia') {
			const v = draft.tentativas_cliente_dia;
			if (v != null) out[k] = v;
			continue;
		}
		if (k === 'por_situacao' || k === 'falhas_tecnicas') {
			const b = draft[k];
			if (b && Object.keys(b).length) out[k] = b;
			continue;
		}
		if (k === 'por_sinalizacao' || k === 'modo_discagem' || k === 'reciclagem_auto') {
			if (draft[k] != null) out[k] = draft[k]; // preservados como estão salvos (a edição chega com o redesign)
			continue;
		}
		if (k === 'retorno_agendado') {
			const b = draft.retorno_agendado;
			if (b && Object.keys(b).length) out.retorno_agendado = b;
			continue;
		}
		if (k === 'horarios') {
			const saida = computarHorariosSaida(draft.horarios);
			if (saida) out.horarios = saida;
			continue;
		}
		const dv = (draft as Record<string, unknown>)[k];
		const sv = (SUGESTOES as Record<string, unknown>)[k];
		if (dv === undefined && sv === undefined) continue;
		if (!stableEqual(dv, sv)) out[k] = dv;
	}
	return out;
}

/** Lê as travas "ligacoes" das estratégias usadas pelos segmentos da carteira. */
export function computeLigacoes(estrategias: { id: string; nome: string; definicao: Record<string, unknown> | null }[]): LigacoesInfo {
	const info: LigacoesInfo = {};
	const campos: { key: keyof LigacoesInfo; trav: 'por_dia' | 'por_numero' | 'intervalo_min' | 'intervalo_ocupado' }[] = [
		{ key: 'tentativas_cliente_dia', trav: 'por_dia' },
		{ key: 'tentativas_numero_dia', trav: 'por_numero' },
		{ key: 'intervalo_min_minutos', trav: 'intervalo_min' },
		{ key: 'intervalo_ocupado_minutos', trav: 'intervalo_ocupado' },
	];
	for (const { key, trav } of campos) {
		const nomes: string[] = [];
		let valor: number | undefined;
		for (const e of estrategias) {
			const lig = (e.definicao?.ligacoes ?? null) as LigacoesTrava | null;
			if (!lig || !lig.ativo) continue;
			const v = lig[trav];
			if (v == null) continue;
			nomes.push(e.nome);
			valor = v;
		}
		if (nomes.length && valor != null) info[key] = { nomes, valor };
	}
	return info;
}

export function filtrarAlertas(alertas: string[] | undefined, prefixos: string[]): string[] {
	if (!alertas) return [];
	return alertas.filter(a => prefixos.some(p => a.toUpperCase().startsWith(p)));
}

export function pct(f: number | undefined): string {
	if (f == null) return '—';
	return `${Math.round(f * 100)}%`;
}
