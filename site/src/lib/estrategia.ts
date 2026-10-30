// Tipos, playbook e helpers para a página de Estratégias.

export type Contatos = {
	whatsapp?: boolean;
	rcs?: boolean;
	pertence?: boolean;
	sem_nao_perturbe?: boolean;
	score_bureau_min?: number;
	status?: string[];
	origem?: string[];
};

/** Referência de mensagem: texto próprio (string) ou frase do playbook ({ frase_id }). */
export type MensagemRef = string | { frase_id: string };
/**
 * Mensagem de uma ação de dia:
 * - canal comum:  "texto" | { frase_id }
 * - persona (canal só se define na rodada): mapa por canal { whatsapp: { frase_id }, sms: "texto" }
 * - CPC: { cpa: ..., cpb: ... } ou "texto" | { frase_id } (mesma frase para A e B)
 */
export type MensagemAcao = MensagemRef | Record<string, MensagemRef>;

export type Acao = {
	canal: string;
	modo?: string; // ausente nas ações da ordem do CPC
	contatos?: Contatos;
	numeros?: number; // undefined = padrão do canal; 99 = todos; 1/2/3
	personas?: string[]; // ids das personas do usuário que recebem esta ação; ausente = Todos
	mensagem?: MensagemAcao; // frase/texto do dia; ausente = sem mensagem no arquivo
};

/** Prioridade dos telefones — gravada em definicao.prioridade_contatos. */
export type CriterioPrioridade = { campo: string; sentido: 'asc' | 'desc' };
export type PrioridadeContatos = { criterios: CriterioPrioridade[]; score_minimo?: number | null; ranking_maximo?: number | null };

export type Passos = Record<string, Acao[]>;

/** Orçamento por canal de uma fase (definicao.<fase>.orcamento). */
export type OrcamentoCanal = { max_dia?: number | null; max_mes?: number | null };
export type OrcamentoFase = { canais?: Record<string, OrcamentoCanal> };

/** Travas próprias de uma fase (definicao.<fase>.travas) — só estas 3 aceitam valor por fase. */
export type TravasFase = { intervalo_horas?: number | null; acoes_dia?: number | null; de?: string | null; ate?: string | null };

/** Travas da estratégia (definicao.travas) — valem para todas as fases. */
export type TravasEstrategia = {
	intervalo_horas?: number | null;
	acoes_dia?: number | null;
	de?: string | null;
	ate?: string | null;
	domingo?: boolean | null;
	por_semana?: number | null;
	discador?: boolean | null;
	nao_perturbe?: boolean | null;
	freio_whatsapp?: number | null;
};

/** Célula de mensagem: ou aponta para uma frase do playbook, ou guarda um texto próprio. */
export type MensagemCelula = { frase_id?: string; texto?: string };
/** mensagens[estagio][canal] = { frase_id } | { texto }. */
export type Mensagens = Record<string, Record<string, MensagemCelula>>;

export type Definicao = {
	localizacao?: { passos: Passos; dias_sem_contato_para_ncp?: number; ativo?: boolean; orcamento?: OrcamentoFase; travas?: TravasFase };
	cpc?: { ordem: Acao[]; junto: Acao[]; tentativas_por_canal?: number; intervalo_cpa?: number; intervalo_cpb?: number; ativo?: boolean; mensagem_hot?: Record<string, MensagemAcao>; orcamento?: OrcamentoFase; travas?: TravasFase };
	giro?: { passos: Passos; ciclo_dias?: number; max_ciclos?: number; ativo?: boolean; orcamento?: OrcamentoFase; travas?: TravasFase };
	preventivo?: { passos: Passos; ativo?: boolean; orcamento?: OrcamentoFase; travas?: TravasFase };
	quebra?: { passos: Passos; dias_para_estoque?: number; ativo?: boolean; carencia?: number; orcamento?: OrcamentoFase; travas?: TravasFase };
	prioridade_contatos?: PrioridadeContatos;
	mensagens?: Mensagens;
	whatsapp?: Record<string, unknown>;
	travas?: TravasEstrategia;
	/** Ordem de prioridade dos estágios (ids de etapas + ids das 5 fases). */
	ordem_etapas?: string[];
	/** Etapas personalizadas criadas pelo usuário. */
	etapas?: Etapa[];
	/** Rótulos de tela das 5 fases (o motor ignora esta chave). */
	rotulos_fases?: Partial<Record<FaseId, string>>;
};

/** Ids das 5 fases do motor. */
export type FaseId = 'localizacao' | 'cpc' | 'giro' | 'preventivo' | 'quebra';

/** Ordem das fases no rodapé de ordem_etapas (etapas primeiro, depois esta ordem). */
export const FASES_ORDEM: FaseId[] = ['quebra', 'preventivo', 'cpc', 'giro', 'localizacao'];

/** Rótulo padrão de cada fase quando não há rotulos_fases. */
export const FASE_DEFAULT_LABEL: Record<FaseId, string> = {
	localizacao: 'Ainda sem contato',
	cpc: 'Contatado (CPC)',
	giro: 'Sem contato após as tentativas',
	preventivo: 'Acordo em dia',
	quebra: 'Acordo atrasado',
};

/** Estados do enquadramento que cada fase abrange (para a prévia de clientes). */
export const FASE_ESTADO: Record<FaseId, string[]> = {
	localizacao: ['LOC'],
	cpc: ['CPA', 'CPB'],
	giro: ['NCP'],
	preventivo: ['PRE'],
	quebra: ['QBR'],
};

/** Condição de uma etapa (mesmo formato das condições de cluster). */
export type CondicaoEtapa = { campo: string; op: string; valor: string | string[] | null };

/** Como contar o prazo de uma etapa. */
export type ContandoJanela = { tipo: 'entrada' | 'atraso' | 'vencimento' | 'coluna'; coluna?: string };
/** Janela de tempo de uma etapa. */
export type JanelaEtapa = { de: number; ate: number; contando: ContandoJanela; ciclo?: { dias: number; vezes: number } };
/** Destino de uma saída de etapa. */
export type DestinoSaida = 'fica' | 'sai' | 'padrao' | string; // string = `etapa:<id>`
/** Saídas de uma etapa por evento. */
export type SaidasEtapa = Partial<Record<'cpc' | 'acordo' | 'pagamento' | 'fim_janela', DestinoSaida>>;

/** Etapa personalizada criada pelo usuário.
 *  O prazo fica direto na etapa (referencia/de/ate/ciclo), sem o objeto "janela". */
export type Etapa = {
	id: string;
	nome: string;
	ativo: boolean;
	condicoes: CondicaoEtapa[];
	referencia?: ContandoJanela;
	de?: number;
	ate?: number;
	ciclo?: { dias: number; vezes: number };
	saidas?: SaidasEtapa;
	passos?: Passos;
	/** Aviso de tela (não lido pelo motor). Ex.: rascunho vindo da Matriz. */
	aviso?: string;
};

export type Estrategia = {
	id: string;
	empresa_id: string;
	nome: string;
	descricao: string | null;
	definicao: Definicao | null;
	padrao: boolean;
	frente?: string;
	atualizado_em?: string;
};

export const canalOpts = [
	{ id: 'whatsapp', label: 'WhatsApp' },
	{ id: 'rcs', label: 'RCS' },
	{ id: 'agente_voz', label: 'Agente virtual' },
	{ id: 'discador', label: 'Discador' },
	{ id: 'sms', label: 'SMS' },
	{ id: 'email', label: 'E-mail' },
	{ id: 'enriquecimento', label: 'Enriquecimento (bureau)' },
];

export const canalLabel: Record<string, string> = Object.fromEntries(canalOpts.map(c => [c.id, c.label]));

export const modoOpts = [
	{ id: 'sempre', label: 'Sempre', desc: 'Sempre: vai se houver contato que passe no filtro' },
	{ id: 'senao', label: 'Senão', desc: 'Senão: só se nada acima (desde o último "Sempre") foi' },
	{ id: 'junto', label: 'Junto', desc: 'Junto: vai junto com a ação de cima, se ela foi' },
	{ id: 'reserva', label: 'Reserva', desc: 'Reserva: se a de cima foi, só se ela não contatar no dia; se não foi, vai no lugar dela' },
];

export const modoLabel: Record<string, string> = Object.fromEntries(modoOpts.map(m => [m.id, m.label]));
export const modoDesc: Record<string, string> = Object.fromEntries(modoOpts.map(m => [m.id, m.desc]));

export const statusCert = [
	{ id: 'CERTIFICADO', label: 'Certificado' },
	{ id: 'PROVAVEL', label: 'Provável' },
	{ id: 'NAO_CONFIRMADO', label: 'Não confirmado' },
	{ id: 'DESCONHECIDO', label: 'Sem histórico' },
];

export const origemOpts = [
	{ id: 'cliente', label: 'cliente' },
	{ id: 'bureau', label: 'bureau' },
	{ id: 'enriquecimento', label: 'enriquecimento' },
];

export const fases = [
	{ id: 'localizacao', label: 'Cliente novo', prefixo: 'D+' },
	{ id: 'cpc', label: 'CPC (já teve contato)', prefixo: '' },
	{ id: 'giro', label: 'Não CPC (giro)', prefixo: 'D+' },
	{ id: 'preventivo', label: 'Preventivo', prefixo: 'D-' },
	{ id: 'quebra', label: 'Quebra', prefixo: 'D+' },
] as const;

export function emptyDefinicao(): Definicao {
	return {};
}

export function isVazia(d: Definicao | null | undefined): boolean {
	if (!d) return true;
	return !d.localizacao && !d.cpc && !d.giro && !d.preventivo && !d.quebra;
}

function a(canal: string, modo?: string, extras?: Partial<Acao>): Acao {
	return { canal, modo, ...extras };
}

/** Playbook MotorCob atual, como ações. */
export function playbookDefinicao(): Definicao {
	const locPassos: Passos = {
		'1': [a('whatsapp', 'sempre', { contatos: { whatsapp: true } })],
		'3': [a('rcs', 'sempre', { contatos: { rcs: true, pertence: true } }), a('sms', 'senao'), a('email', 'junto')],
		'5': [a('agente_voz', 'sempre'), a('discador', 'reserva')],
		'7': [a('sms', 'sempre'), a('email', 'junto')],
	};
	return {
		localizacao: { passos: locPassos, dias_sem_contato_para_ncp: 8 },
		cpc: {
			ordem: [a('whatsapp'), a('rcs'), a('agente_voz'), a('discador'), a('sms')],
			junto: [],
			tentativas_por_canal: 3,
		},
		giro: { passos: locPassos, ciclo_dias: 8, max_ciclos: 3 },
		preventivo: {
			passos: {
				'-3': [a('rcs', 'sempre'), a('sms', 'senao'), a('email', 'junto')],
				'-1': [a('whatsapp', 'sempre')],
				'0': [a('whatsapp', 'sempre')],
			},
		},
		quebra: {
			passos: {
				'1': [a('whatsapp', 'sempre')],
				'3': [a('discador', 'sempre')],
				'5': [a('discador', 'sempre'), a('sms', 'sempre'), a('email', 'junto')],
			},
			dias_para_estoque: 6,
		},
	};
}

function contatosFrase(c?: Contatos): string {
	if (!c) return '';
	const parts: string[] = [];
	if (c.whatsapp) parts.push('só com WhatsApp');
	if (c.rcs) parts.push('só com RCS');
	if (c.pertence) parts.push('que pertence');
	if (c.sem_nao_perturbe) parts.push('fora do Não Perturbe');
	if (c.score_bureau_min) parts.push(`score ≥ ${c.score_bureau_min}`);
	if (c.status?.length) parts.push(`cert. ${c.status.join(', ')}`);
	if (c.origem?.length) parts.push(`origem ${c.origem.join(', ')}`);
	return parts.length ? ` (${parts.join(', ')})` : '';
}

function numerosFrase(n?: number): string {
	if (n === undefined) return '';
	if (n === 99) return ' (todos)';
	return ` (${n} número${n > 1 ? 's' : ''})`;
}

export function acaoFrase(ac: Acao): string {
	const canal = canalLabel[ac.canal] ?? ac.canal;
	const cont = contatosFrase(ac.contatos);
	const num = numerosFrase(ac.numeros);
	return `${canal}${cont}${num}`;
}

/** Monta a prévia em frase de um dia (lista de ações). */
export function diaFrase(acoes: Acao[]): string {
	if (!acoes.length) return '';
	const parts: string[] = [];
	acoes.forEach((ac, i) => {
		const prefix = i === 0 ? '' : ac.modo === 'junto' ? ' + junto ' : ac.modo === 'reserva' ? ' / reserva ' : ' → senão ';
		parts.push(`${prefix}${acaoFrase(ac)}`);
	});
	return parts.join('');
}

export function passosFrase(passos: Passos | undefined, prefixo: string): string {
	if (!passos) return '';
	const dias = Object.keys(passos).map(Number).sort((a, b) => a - b);
	return dias.map(d => `${prefixo}${d}: ${diaFrase(passos[String(d)])}`).join('  ·  ');
}

/** Definição "vazia": as 5 fases desligadas. NUNCA grave definicao = {}
 *  (o motor lê {} como o playbook MotorCX inteiro). */
export function definicaoVazia(): Definicao {
	return {
		localizacao: { ativo: false },
		cpc: { ativo: false },
		giro: { ativo: false },
		preventivo: { ativo: false },
		quebra: { ativo: false },
	} as unknown as Definicao;
}

/** Modelo "Estágios clássicos": as 5 fases ligadas, com as réguas do motor. */
export function modeloClassicos(): Definicao {
	return {
		localizacao: { ativo: true },
		cpc: { ativo: true },
		giro: { ativo: true },
		preventivo: { ativo: true },
		quebra: { ativo: true },
	} as unknown as Definicao;
}

/** Devolve o id de uma fase a partir de um id de ordem (ou null se for etapa). */
export function isFaseId(id: string): id is FaseId {
	return id === 'localizacao' || id === 'cpc' || id === 'giro' || id === 'preventivo' || id === 'quebra';
}

/** Rótulo de tela de uma fase (rotulos_fases ou padrão). */
export function faseLabel(def: Definicao, fase: FaseId): string {
	return def.rotulos_fases?.[fase] ?? FASE_DEFAULT_LABEL[fase];
}

/** Lista ordenada de ids de estágios (etapas + 5 fases), garantindo todos presentes. */
export function ordemStages(def: Definicao): string[] {
	const etapasIds = (def.etapas ?? []).map(e => e.id);
	const explicit = def.ordem_etapas ?? [...etapasIds, ...FASES_ORDEM];
	const seen = new Set<string>();
	const out: string[] = [];
	const etapasSet = new Set(etapasIds);
	for (const id of explicit) {
		if (seen.has(id)) continue;
		if (isFaseId(id) || etapasSet.has(id)) { seen.add(id); out.push(id); }
	}
	for (const id of etapasIds) if (!seen.has(id)) { seen.add(id); out.push(id); }
	for (const f of FASES_ORDEM) if (!seen.has(f)) { seen.add(f); out.push(f); }
	return out;
}

/** Gera um id estável para uma etapa a partir do nome (só ao criar). */
export function gerarIdEtapa(nome: string, existentes: string[]): string {
	const reserved = new Set<string>(['quebra', 'preventivo', 'cpc', 'giro', 'localizacao']);
	const taken = new Set<string>([...existentes, ...reserved]);
	let base = nome.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
	if (!base) base = 'etapa';
	if (!/^[a-z0-9]/.test(base)) base = 'e-' + base;
	base = base.slice(0, 40);
	let id = base;
	let n = 2;
	while (taken.has(id)) { id = `${base}-${n}`.slice(0, 40); n++; }
	return id;
}

/** Modelo "Só digital": 5 fases ligadas, sem agente_voz e discador; cpc.ordem só canais digitais. */
export function modeloSoDigital(): Definicao {
	const pb = playbookDefinicao();
	const semVoz = (arr: Acao[]) => arr.filter(a => a.canal !== 'agente_voz' && a.canal !== 'discador');
	const fixFirst = (arr: Acao[]) => arr.map((a, i) => i === 0 ? { ...a, modo: 'sempre' } : a);
	const filtrarPassos = (passos: Passos): Passos => {
		const out: Passos = {};
		for (const [k, arr] of Object.entries(passos)) {
			const f = fixFirst(semVoz(arr));
			if (f.length) out[k] = f;
		}
		return out;
	};
	return {
		localizacao: { ...pb.localizacao!, ativo: true, passos: filtrarPassos(pb.localizacao!.passos) },
		cpc: { ...pb.cpc!, ativo: true, ordem: semVoz(pb.cpc!.ordem) },
		giro: { ...pb.giro!, ativo: true, passos: filtrarPassos(pb.giro!.passos) },
		preventivo: { ...pb.preventivo!, ativo: true, passos: filtrarPassos(pb.preventivo!.passos) },
		quebra: { ...pb.quebra!, ativo: true, passos: filtrarPassos(pb.quebra!.passos) },
	};
}

/** Converte etapas antigas com "janela" para o formato novo (referencia/de/ate/ciclo).
 *  Retorna a definição convertida e se houve mudança (para marcar "Alterações não salvas"). */
export function migrarEtapas(def: Definicao): { def: Definicao; mudou: boolean } {
	const etapas = def.etapas;
	if (!etapas || etapas.length === 0) return { def, mudou: false };
	let mudou = false;
	const next = etapas.map(e => {
		const raw = e as unknown as { janela?: JanelaEtapa };
		if (!raw.janela) return e;
		mudou = true;
		const janela = raw.janela;
		const { janela: _drop, ...rest } = raw;
		const conv = { ...rest, referencia: janela.contando, de: janela.de, ate: janela.ate } as Etapa;
		if (janela.ciclo) conv.ciclo = janela.ciclo;
		return conv;
	});
	return { def: { ...def, etapas: next }, mudou };
}

/** Faixa de dias válida para a régua de uma etapa. */
export function faixaDiasEtapa(e: Etapa): { min: number; max: number } {
	if (e.ciclo) return { min: 1, max: e.ciclo.dias };
	return { min: e.de ?? 1, max: e.ate ?? 30 };
}

/** Dias da régua que ficaram fora do prazo da etapa. */
export function diasForaDoPrazo(e: Etapa): number[] {
	const passos = e.passos ?? {};
	const dias = Object.keys(passos).map(Number).filter(n => !Number.isNaN(n));
	if (dias.length === 0) return [];
	const { min, max } = faixaDiasEtapa(e);
	return dias.filter(d => d < min || d > max).sort((a, b) => a - b);
}

/** Rótulo de um dia da régua conforme a referência da etapa. */
export function diaLabelEtapa(e: Etapa, d: number): string {
	const tipo = e.referencia?.tipo ?? 'entrada';
	const ciclo = e.ciclo;
	if (ciclo) return `Dia ${d} do ciclo`;
	if (tipo === 'atraso') return `Atraso ${d}`;
	if (tipo === 'vencimento') return d === 0 ? 'D0' : d > 0 ? `D+${d}` : `D${d}`;
	return `Dia ${d}`;
}

export type ErroEtapa = { id: string; nome: string; mensagens: string[] };

/** Validação que bloqueia o Salvar (uma entrada por etapa com problemas). */
export function validarEtapas(def: Definicao): ErroEtapa[] {
	const erros: ErroEtapa[] = [];
	for (const e of def.etapas ?? []) {
		const msgs: string[] = [];
		if (!e.condicoes || e.condicoes.length === 0) {
			msgs.push('Precisa de pelo menos uma condição.');
		} else {
			for (const c of e.condicoes) {
				if (c.campo === 'propensao') {
					const vals = Array.isArray(c.valor) ? c.valor : (c.valor ? [c.valor] : []);
					if (vals.length === 0) msgs.push('A condição "Propensão a pagamento" precisa de pelo menos uma faixa (A–E).');
					continue;
				}
				if (['>', '>=', '<', '<='].includes(c.op)) {
					const v = Array.isArray(c.valor) ? c.valor[0] : c.valor;
					if (v === null || v === undefined || v === '' || Number.isNaN(Number(v))) {
						msgs.push(`A condição "${c.campo} ${c.op}" precisa de um número.`);
					}
				}
			}
		}
		const de = e.de ?? 1;
		const ate = e.ate ?? 30;
		if (de > ate) msgs.push('"de" precisa ser menor ou igual a "até".');
		if (ate - de > 730) msgs.push('A janela pode ter no máximo 730 dias.');
		if (e.ciclo) {
			if (e.ciclo.dias < 2 || e.ciclo.dias > 60) msgs.push('Ciclo: dias de 2 a 60.');
			if (e.ciclo.vezes < 1 || e.ciclo.vezes > 24) msgs.push('Ciclo: vezes de 1 a 24.');
		}
		if (e.referencia?.tipo === 'coluna' && !e.referencia.coluna) {
			msgs.push('Escolha a coluna da data em “Por quanto tempo”.');
		}
		const fora = diasForaDoPrazo(e);
		if (fora.length) msgs.push(`Dia(s) da régua fora do prazo: ${fora.join(', ')}.`);
		if (msgs.length) erros.push({ id: e.id, nome: e.nome, mensagens: msgs });
	}
	return erros;
}
