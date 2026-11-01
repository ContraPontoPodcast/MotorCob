// Renitência por situação, Resubmit, Reenviar agora e Contato por passada (SQL 65; protótipo aprovado em 01/11/2026).
// Regras puras (sem React, sem Supabase): o site e site/resubmit/resubmit.test.ts usam as mesmas funções.
// O padrão MotorCX é o de public.discagem_padrao() (= motor/discagem.padrao_site(); o teste confere com o SQL).
// Nenhum dado pessoal: a tela só mostra contagens.

export type Prioridade = 'topo' | 'normal' | 'fim';
export type RegraSituacao = { intervalo_minutos: number; max_dia: number; conta_descanso: boolean };
export type RegraFalha = { religar_minutos: number; aviso: number };
export type RegraResubmit = { ativo: boolean; depois_minutos: number; max_dia: number; prioridade: Prioridade; ate: string; outro_numero: boolean };
export type Bloco<T> = Record<string, Partial<T>>;

/** Recorte de credores.discagem que estas telas leem e escrevem (o resto do objeto é preservado). */
export type DiscagemRen = {
	tentativas_numero_dia?: number;
	tentativas_cliente_dia?: number | null;
	intervalo_min_minutos?: number;
	intervalo_ocupado_minutos?: number;
	descanso_nao_atende?: { ativo: boolean; n: number; em_dias: number; descansa_dias: number };
	descanso_recusa?: { ativo: boolean; dias: number };
	promessa_suspende?: { ativo: boolean; dias_sem_data: number };
	inexistente?: { ativo: boolean; modo?: 'so_voz' | 'invalida' } & Record<string, unknown>;
	nao_ligar?: { ativo: boolean };
	retorno_agendado?: { max_dias?: number } & Record<string, unknown>;
	chamadas_curtas?: { falha_conta?: boolean } & Record<string, unknown>;
	por_situacao?: Bloco<RegraSituacao>;
	falhas_tecnicas?: Bloco<RegraFalha>;
	resubmit?: Bloco<RegraResubmit> | null;
};

// ---------------------------------------------------------------- situações (as 8 do dono e as falhas técnicas)
export type Curta = 'sempre' | 'duracao' | 'misto';
export const SITUACOES: { k: string; n: string; sinais: string; chaves: string; curta: Curta }[] = [
	{ k: 'maquina', n: 'Máquina', sinais: 'AMD: máquina ou saudação longa', chaves: 'maquina', curta: 'sempre' },
	{ k: 'nao_atendida', n: 'Não atendeu', sinais: 'tocou ≥ 15 s · SIP 487 · Q.850 19', chaves: 'nao_atendida', curta: 'sempre' },
	{ k: 'ocupado', n: 'Ocupado', sinais: 'SIP 486, 600 · Q.850 17', chaves: 'ocupado', curta: 'sempre' },
	{ k: 'caixa_postal', n: 'Caixa postal', sinais: 'desvio + máquina · anúncio da operadora', chaves: 'caixa_postal', curta: 'sempre' },
	{ k: 'desligou_sem_conversar', n: 'Desligou sem conversar', sinais: 'atendeu e desligou em menos de 5 s', chaves: 'desligou_sem_conversar', curta: 'duracao' },
	{ k: 'retorno_agendado', n: 'Atendeu e pediu retorno', sinais: 'o titular pediu outro horário', chaves: 'retorno_agendado', curta: 'duracao' },
	{ k: 'atendeu_desligou', n: 'Atendeu e desligou', sinais: 'desligou depois de começar a conversa', chaves: 'atendeu_desligou', curta: 'duracao' },
	{ k: 'numero_incorreto', n: 'Número incorreto', sinais: 'não existe (SIP 404, 410, 604) ou pessoa errada', chaves: 'numero_inexistente · atendida_terceiro_desconhece', curta: 'misto' },
];
export const FALHAS: { k: string; n: string; sinais: string; chaves: string; mudaHoje?: boolean }[] = [
	{ k: 'falha_operadora', n: 'Falha da operadora ou rota', sinais: 'SIP 3xx, 400–407, 5xx · Q.850 2, 3, 34–47', chaves: 'falha_operadora' },
	{ k: 'sem_credito', n: 'Sem crédito na operadora', sinais: 'SIP 402 · alerta imediato', chaves: 'falha_operadora (402)' },
	{ k: 'falha_rede', n: 'Falha da nossa rede', sinais: 'Asterisk ou SBC do MotorCX', chaves: 'falha_rede' },
	{ k: 'indisponivel', n: 'Fora de área ou desligado', sinais: 'SIP 408, 480 · Q.850 18, 20, 27', chaves: 'indisponivel', mudaHoje: true },
	{ k: 'bloqueio_originacao', n: 'Bloqueio de originação', sinais: 'Q.850 52/53 · SIP 608, 428, 436–438 · alerta crítico', chaves: 'bloqueio_originacao' },
	{ k: 'cancelada_discador', n: 'Cancelada antes do toque mínimo', sinais: 'menos de 15 s de toque', chaves: 'cancelada_discador' },
	{ k: 'abandonada', n: 'Abandonada (sem pessoa livre)', sinais: 'atendeu e não havia agente ou operador livre', chaves: 'abandonada' },
];
export const SITUACOES_RENITENCIA = ['maquina', 'nao_atendida', 'ocupado', 'caixa_postal', 'desligou_sem_conversar', 'atendeu_desligou'];
export const NOME: Record<string, string> = Object.fromEntries([...SITUACOES, ...FALHAS].map(s => [s.k, s.n]));
export const CURTA_TXT: Record<Curta, string> = {
	sempre: 'Sempre: não completada, máquina ou caixa postal',
	duracao: 'Se durar até 6 s desde o atendimento',
	misto: 'Inexistente: sempre · pessoa errada: até 6 s',
};
export const PRIORIDADES: Record<Prioridade, string> = { topo: 'Topo', normal: 'Normal', fim: 'Fim' };
export const MOTIVO_FORA: Record<string, { n: string; t: string }> = {
	max_dia: { n: 'Já atingiram o máximo do dia', t: 'tentativas por número ou por cliente, contando as voltas' },
	fora_horario: { n: 'Fora do horário', t: 'a janela fecha antes de dar o intervalo da renitência' },
	nao_ligar: { n: 'Pediram “não ligar”', t: 'pedido feito em ligação ou na lista da empresa' },
	promessa: { n: 'Têm promessa', t: 'prometeram hoje; a voz espera a data' },
	inexistente: { n: 'Número inexistente', t: 'a voz está suspensa no número (só a voz)' },
};
/** Mínimo de chamadas para mostrar percentual (contato_por_passada devolve nulo abaixo). */
export const MIN_CHAMADAS = 30;

// ---------------------------------------------------------------- padrão MotorCX (= public.discagem_padrao())
const R = (ativo: boolean, depois_minutos: number, max_dia: number, prioridade: Prioridade, ate: string, outro_numero: boolean): RegraResubmit =>
	({ ativo, depois_minutos, max_dia, prioridade, ate, outro_numero });
export const PADRAO = {
	tentativas_numero_dia: 2,
	tentativas_cliente_dia: 3,
	intervalo_min_minutos: 120,
	intervalo_ocupado_minutos: 15,
	por_situacao: {
		maquina: { intervalo_minutos: 120, max_dia: 2, conta_descanso: true },
		nao_atendida: { intervalo_minutos: 120, max_dia: 2, conta_descanso: true },
		ocupado: { intervalo_minutos: 15, max_dia: 2, conta_descanso: true },
		caixa_postal: { intervalo_minutos: 120, max_dia: 2, conta_descanso: true },
		desligou_sem_conversar: { intervalo_minutos: 120, max_dia: 2, conta_descanso: false },
		atendeu_desligou: { intervalo_minutos: 120, max_dia: 2, conta_descanso: false },
	} as Record<string, RegraSituacao>,
	falhas_tecnicas: {
		falha_operadora: { religar_minutos: 120, aviso: 0.15 },
		sem_credito: { religar_minutos: 120, aviso: 0.01 },
		falha_rede: { religar_minutos: 120, aviso: 0.05 },
		indisponivel: { religar_minutos: 120, aviso: 0.2 },
		bloqueio_originacao: { religar_minutos: 120, aviso: 0.01 },
		cancelada_discador: { religar_minutos: 120, aviso: 0.05 },
		abandonada: { religar_minutos: 120, aviso: 0.03 },
	} as Record<string, RegraFalha>,
	resubmit: {
		maquina: R(true, 120, 1, 'fim', '19:00', true),
		nao_atendida: R(true, 60, 2, 'normal', '19:30', true),
		ocupado: R(true, 15, 2, 'topo', '19:30', false),
		caixa_postal: R(true, 120, 1, 'fim', '19:00', true),
		desligou_sem_conversar: R(true, 90, 1, 'normal', '19:00', false),
		retorno_agendado: R(true, 0, 1, 'topo', '20:00', false),
		atendeu_desligou: R(false, 120, 1, 'fim', '18:00', false),
		numero_incorreto: R(false, 30, 1, 'normal', '19:00', true),
		falha_operadora: R(true, 30, 2, 'topo', '19:30', false),
		sem_credito: R(false, 30, 1, 'normal', '19:30', false),
		falha_rede: R(true, 30, 2, 'topo', '19:30', false),
		indisponivel: R(true, 180, 1, 'fim', '19:00', true),
		bloqueio_originacao: R(false, 120, 1, 'normal', '19:00', false),
		cancelada_discador: R(true, 30, 1, 'topo', '19:30', false),
		abandonada: R(true, 60, 1, 'topo', '19:30', false),
	} as Record<string, RegraResubmit>,
	retorno_agendado: { max_dias: 7 },
	chamadas_curtas: { falha_conta: true },
};

// ---------------------------------------------------------------- valores efetivos (o que o motor e a VM usam)
export type Efetivo = {
	tnum: number; tcli: number;
	naOn: boolean; naN: number; naDias: number; naDesc: number;
	promessa: boolean; promDias: number; recusa: boolean; recusaDias: number; nl: boolean; falhaCurta: boolean;
	retornoDias: number; inexistente: 'so_voz' | 'invalida' | 'nao';
	ren: Record<string, RegraSituacao>;
	tec: Record<string, RegraFalha>;
	res: Record<string, RegraResubmit> | null;
};

/** O que vale para a carteira: chave ausente = o de hoje (globais) e, no Resubmit, null = a retentativa de hoje. */
export function efetivo(d: DiscagemRen | null | undefined, travaTcli?: number): Efetivo {
	const x = d ?? {};
	const tnum = x.tentativas_numero_dia ?? PADRAO.tentativas_numero_dia;
	const im = x.intervalo_min_minutos ?? PADRAO.intervalo_min_minutos;
	const io = x.intervalo_ocupado_minutos ?? PADRAO.intervalo_ocupado_minutos;
	const ren: Record<string, RegraSituacao> = {};
	for (const k of SITUACOES_RENITENCIA) {
		const p = x.por_situacao?.[k] ?? {};
		const base = PADRAO.por_situacao[k];
		ren[k] = {
			intervalo_minutos: p.intervalo_minutos ?? (k === 'ocupado' ? io : im),
			max_dia: Math.min(p.max_dia ?? tnum, tnum),
			conta_descanso: p.conta_descanso ?? base.conta_descanso,
		};
	}
	const tec: Record<string, RegraFalha> = {};
	for (const f of FALHAS) {
		const p = x.falhas_tecnicas?.[f.k] ?? {};
		tec[f.k] = { religar_minutos: p.religar_minutos ?? im, aviso: fracao(p.aviso) ?? PADRAO.falhas_tecnicas[f.k].aviso };
	}
	let res: Record<string, RegraResubmit> | null = null;
	if (x.resubmit != null) {
		res = {};
		for (const [k, base] of Object.entries(PADRAO.resubmit)) res[k] = { ...base, ...(x.resubmit[k] ?? {}) } as RegraResubmit;
		res.retorno_agendado = { ...res.retorno_agendado, ativo: true, max_dia: 1, prioridade: 'topo', outro_numero: false };
		res.numero_incorreto = { ...res.numero_incorreto, max_dia: 1 };
	}
	const dn = x.descanso_nao_atende;
	return {
		tnum, tcli: travaTcli ?? x.tentativas_cliente_dia ?? PADRAO.tentativas_cliente_dia,
		naOn: dn?.ativo ?? false, naN: dn?.n ?? 6, naDias: dn?.em_dias ?? 3, naDesc: dn?.descansa_dias ?? 7,
		promessa: x.promessa_suspende?.ativo ?? false, promDias: x.promessa_suspende?.dias_sem_data ?? 7,
		recusa: x.descanso_recusa?.ativo ?? false, recusaDias: x.descanso_recusa?.dias ?? 7,
		nl: x.nao_ligar?.ativo ?? true, falhaCurta: x.chamadas_curtas?.falha_conta ?? true,
		retornoDias: x.retorno_agendado?.max_dias ?? PADRAO.retorno_agendado.max_dias,
		inexistente: x.inexistente?.ativo === false ? 'nao' : x.inexistente?.modo === 'invalida' ? 'invalida' : 'so_voz',
		ren, tec, res,
	};
}

function fracao(v: number | undefined): number | undefined {
	if (v == null) return undefined;
	return v > 1 ? v / 100 : v;
}

/** O que vale no Resubmit para a situação: o maior entre "depois de" e o intervalo da renitência, e quantas voltas cabem. */
export function resubmitEfetivo(e: Efetivo, k: string) {
	const r = e.res?.[k] ?? PADRAO.resubmit[k];
	const intRen = e.ren[k]?.intervalo_minutos ?? e.tec[k]?.religar_minutos ?? 0;
	const maxNum = Math.min(e.ren[k]?.max_dia ?? e.tnum, e.tnum);
	const cabe = r.outro_numero ? Math.max(0, e.tcli - 1) : Math.max(0, maxNum - 1);
	return { intRen, efDep: k === 'retorno_agendado' ? 0 : Math.max(r.depois_minutos, intRen), cabe, efMax: Math.min(r.max_dia, cabe) };
}

// ---------------------------------------------------------------- edição (só grava o que mudou do padrão)
function semVazios<T extends object>(b: Record<string, Partial<T>>): Record<string, Partial<T>> | undefined {
	const out: Record<string, Partial<T>> = {};
	for (const [k, v] of Object.entries(b)) if (v && Object.keys(v).length) out[k] = v;
	return Object.keys(out).length ? out : undefined;
}

/** Muda um campo de uma situação; igual ao padrão (o de hoje) sai do bloco. */
export function mudarCampo(d: DiscagemRen, bloco: 'por_situacao' | 'falhas_tecnicas' | 'resubmit', k: string, campo: string, valor: unknown): DiscagemRen {
	const atual = { ...((d[bloco] ?? {}) as Record<string, Record<string, unknown>>) };
	const linha = { ...(atual[k] ?? {}) };
	const e = efetivo({ ...d, [bloco]: bloco === 'resubmit' ? (d.resubmit ?? {}) : {} });
	const padrao = bloco === 'por_situacao' ? (e.ren[k] as Record<string, unknown>)[campo]
		: bloco === 'falhas_tecnicas' ? (e.tec[k] as Record<string, unknown>)[campo]
		: (PADRAO.resubmit[k] as Record<string, unknown>)[campo];
	if (valor === padrao) delete linha[campo]; else linha[campo] = valor;
	atual[k] = linha;
	const limpo = semVazios(atual);
	const out = { ...d };
	if (bloco === 'resubmit') out.resubmit = limpo ?? {};          // resubmit ligado continua ligado, mesmo no padrão
	else if (limpo) out[bloco] = limpo as never; else delete out[bloco];
	return out;
}

/** Volta uma linha ao padrão MotorCX (tira a situação do bloco). */
export function voltarLinha(d: DiscagemRen, bloco: 'por_situacao' | 'falhas_tecnicas' | 'resubmit', k: string): DiscagemRen {
	const atual = { ...((d[bloco] ?? {}) as Record<string, unknown>) };
	delete atual[k];
	const out = { ...d };
	if (bloco === 'resubmit') out.resubmit = atual as Bloco<RegraResubmit>;
	else if (Object.keys(atual).length) out[bloco] = atual as never; else delete out[bloco];
	return out;
}

export function linhaAlterada(d: DiscagemRen, bloco: 'por_situacao' | 'falhas_tecnicas' | 'resubmit', k: string): boolean {
	const b = d[bloco] as Record<string, object> | null | undefined;
	return !!b && !!b[k] && Object.keys(b[k]).length > 0;
}

// ---------------------------------------------------------------- resumo das mudanças (histórico de versões)
const LBL_LIM: [keyof Efetivo, string][] = [
	['tnum', 'Tentativas por número no dia'], ['tcli', 'Tentativas por cliente no dia'], ['naOn', 'Descanso por não atende'],
	['naN', 'Descanso: não atende seguidos'], ['naDias', 'Descanso: em até (dias)'], ['naDesc', 'Descanso: descansa (dias)'],
	['promessa', 'Promessa suspende ligações'], ['promDias', 'Promessa sem data: dias'], ['recusa', 'Descanso por recusa'],
	['recusaDias', 'Recusa: dias'], ['nl', 'Lista de “não ligar”'], ['falhaCurta', 'Falha técnica conta como curta'],
	['retornoDias', 'Retorno agendado: máx. dias'], ['inexistente', 'Número inexistente invalida'],
];
const LBL_F: Record<string, string> = {
	intervalo_minutos: 'intervalo (min)', max_dia: 'máx. no dia', conta_descanso: 'conta no descanso', religar_minutos: 'religar depois de (min)',
	aviso: 'alerta (%)', ativo: 'volta ao mailing', depois_minutos: 'depois de (min)', prioridade: 'prioridade', ate: 'horário limite',
	outro_numero: 'outro número',
};
const INV: Record<string, string> = { so_voz: 'só a voz, após 2 confirmações', invalida: 'todos os canais (regra antiga)', nao: 'não invalida' };
function fmt(v: unknown, campo?: string): string {
	if (v === true) return 'ligado';
	if (v === false) return 'desligado';
	if (v === null || v === undefined) return '—';
	if (campo === 'aviso' && typeof v === 'number') return `${Math.round(v * 100)}%`;
	return PRIORIDADES[v as Prioridade] ?? INV[v as string] ?? String(v);
}

/** Linhas "Seção › Situação › campo: antes → depois" entre duas regras. */
export function resumoMudancas(antes: DiscagemRen | null | undefined, depois: DiscagemRen | null | undefined): string[] {
	const a = efetivo(antes), b = efetivo(depois), out: string[] = [];
	for (const [k, n] of LBL_LIM) if (a[k] !== b[k]) out.push(`Limites › ${n}: ${fmt(a[k])} → ${fmt(b[k])}`);
	for (const k of SITUACOES_RENITENCIA) for (const f of Object.keys(LBL_F)) {
		const va = (a.ren[k] as Record<string, unknown>)[f], vb = (b.ren[k] as Record<string, unknown>)[f];
		if (va !== undefined && va !== vb) out.push(`Renitência › ${NOME[k]} › ${LBL_F[f]}: ${fmt(va, f)} → ${fmt(vb, f)}`);
	}
	for (const s of FALHAS) for (const f of ['religar_minutos', 'aviso']) {
		const va = (a.tec[s.k] as Record<string, unknown>)[f], vb = (b.tec[s.k] as Record<string, unknown>)[f];
		if (va !== vb) out.push(`Falhas técnicas › ${s.n} › ${LBL_F[f]}: ${fmt(va, f)} → ${fmt(vb, f)}`);
	}
	if (!!a.res !== !!b.res) out.push(`Resubmit: ${a.res ? 'ligado' : 'só a retentativa de hoje'} → ${b.res ? 'ligado' : 'só a retentativa de hoje'}`);
	if (a.res && b.res) for (const k of Object.keys(PADRAO.resubmit)) for (const f of Object.keys(PADRAO.resubmit[k])) {
		const va = (a.res[k] as Record<string, unknown>)[f], vb = (b.res[k] as Record<string, unknown>)[f];
		if (va !== vb) out.push(`Resubmit › ${NOME[k]} › ${LBL_F[f]}: ${fmt(va)} → ${fmt(vb)}`);
	}
	return out;
}

/** Notas de uma linha do Resubmit (o que vale quando a regra pede mais do que a régua deixa). */
export function notasResubmit(e: Efetivo, k: string): { tom: 'atencao' | 'info'; texto: string }[] {
	const r = e.res?.[k];
	if (!r || !r.ativo || k === 'retorno_agendado' || k === 'numero_incorreto') return [];
	const ef = resubmitEfetivo(e, k), out: { tom: 'atencao' | 'info'; texto: string }[] = [];
	if (r.depois_minutos < ef.intRen) out.push({ tom: 'atencao', texto: `Vale ${ef.efDep} min: o intervalo da renitência (${ef.intRen} min) é maior. Para voltar antes, baixe o intervalo em Renitência por situação.` });
	if (ef.cabe === 0) out.push({ tom: 'atencao', texto: `Com ${e.tnum} ${e.tnum === 1 ? 'tentativa' : 'tentativas'} por número${e.ren[k] ? ` (ou ${e.ren[k].max_dia} nesta situação)` : ''}, não sobra volta no mesmo número. Ligue “outro número” ou suba o limite.` });
	else if (r.max_dia > ef.cabe) out.push({ tom: 'atencao', texto: `A régua corta em ${ef.cabe} ${ef.cabe === 1 ? 'volta' : 'voltas'}: ${r.outro_numero ? `${e.tcli} tentativas por cliente no dia` : `${Math.min(e.tnum, e.ren[k]?.max_dia ?? e.tnum)} tentativas por número no dia`}.` });
	if (k === 'bloqueio_originacao') out.push({ tom: 'atencao', texto: 'Religar com a linha bloqueada piora o bloqueio. Recomendado deixar desligado até a equipe confirmar.' });
	if (k === 'atendeu_desligou') out.push({ tom: 'info', texto: 'A pessoa atendeu e desligou: religar no mesmo dia tende a gerar reclamação. Ligado por escolha de vocês.' });
	return out;
}

// ---------------------------------------------------------------- contato por passada
export type LinhaPassada = { passada: number; chamadas: number; contatos: number; taxa: number | null; curtas: number; curtas_pct: number | null; minutos_ia: number; custo_operadora: number; sem_custo: number };
export type PassadaCalc = LinhaPassada & { custo: number | null; cpc: number | null; acum: number; ok: boolean };

/** Custo = minuto de IA × preço (se a pessoa vê o preço) + telefonia estimada; por contato só com 30+ chamadas. */
export function calcularPassadas(linhas: LinhaPassada[], precoMinuto: number | null): PassadaCalc[] {
	let acum = 0;
	return [...linhas].sort((a, b) => a.passada - b.passada).map(l => {
		acum += l.contatos;
		const ok = l.chamadas >= MIN_CHAMADAS;
		const custo = precoMinuto != null ? l.minutos_ia * precoMinuto + l.custo_operadora : l.custo_operadora;
		return { ...l, ok, custo, cpc: ok && l.contatos > 0 ? custo / l.contatos : null, acum, taxa: ok ? l.taxa : null, curtas_pct: ok ? l.curtas_pct : null };
	});
}

/** Sugestão (quem decide é o cliente): a 1ª passada das voltas abaixo de 1,5% de contato ou custando mais de 3× o contato da 1ª. */
export function passadaRuim(rows: PassadaCalc[]): PassadaCalc | null {
	const p1 = rows.find(r => r.passada === 1);
	return rows.find(r => r.passada > 1 && r.ok && ((r.taxa ?? 0) < 1.5 || (r.cpc != null && p1?.cpc != null && r.cpc > 3 * p1.cpc))) ?? null;
}

// ---------------------------------------------------------------- ondas e reenvio
export type OndaVoz = { id: number; janela: string; tentativa: number; total: number; encerradas: number; situacao: string; abre_em: string | null; fecha_em: string | null; origem?: string | null; passada?: number | null; situacao_origem?: string | null; prioridade?: string | null; reenvio_id?: number | null };

export function nomeOnda(o: OndaVoz): { nome: string; detalhe: string } {
	const pri = o.prioridade ? ` · prioridade ${PRIORIDADES[o.prioridade as Prioridade]?.toLowerCase() ?? o.prioridade}` : '';
	if (o.origem === 'regua') return o.passada && o.passada > 1
		? { nome: `Retentativa · ${NOME[o.situacao_origem ?? ''] ?? 'sem contato'}`, detalhe: `${o.passada}ª tentativa` }
		: { nome: '1ª passada', detalhe: 'janela UF/DDD de cada número' };
	if (o.origem === 'resubmit') return { nome: `Resubmit · ${NOME[o.situacao_origem ?? ''] ?? '—'}`, detalhe: `automático · ${o.passada ?? o.tentativa}ª tentativa${pri}` };
	if (o.origem === 'manual') return { nome: 'Reenvio manual', detalhe: `${NOME[o.situacao_origem ?? ''] ?? ''} · ${o.passada ?? o.tentativa}ª tentativa${pri}` };
	return { nome: o.janela, detalhe: `${o.tentativa}ª tentativa` };
}

export type Previa = { selecionados: number; volta: number; volta_outro_numero: number; espera_intervalo: number; fora: Record<string, number> };
export function totalFora(p: Previa | null): number {
	return p ? Object.values(p.fora ?? {}).reduce((t, n) => t + Number(n || 0), 0) : 0;
}

/** Chip "Falha técnica" do lote = todas as falhas técnicas. */
export const CHIPS_LOTE: { k: string; n: string; sits: string[] }[] = [
	...['nao_atendida', 'maquina', 'caixa_postal', 'ocupado', 'desligou_sem_conversar', 'atendeu_desligou', 'numero_incorreto'].map(k => ({ k, n: NOME[k], sits: [k] })),
	{ k: 'falha', n: 'Falha técnica', sits: FALHAS.map(f => f.k) },
];
