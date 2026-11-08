// Estado dos canais (SPEC Canais §1.2 e §3.2): o que a RPC estado_canais(empresa) devolve (SQL 84) e como a visão geral
// de Cobrança › Configurações › Canais desenha cada cartão. O banco calcula o estado, o problema e o "o que fazer"; aqui
// ficam só os rótulos, as rotas das ações e a formatação dos números (pt-BR, horário de São Paulo).

export type EstadoCanal = 'funcionando' | 'atencao' | 'com_problema' | 'nao_configurado' | 'pausado';
export type QuemExecuta = 'motorcx' | 'lista' | 'voz_motorcx';
export type GrupoCanal = 'mensagens' | 'voz';

export type SinalCanal = {
	chave: string;
	rotulo: string;
	tipo: 'numero' | 'pct' | 'data' | 'data_dia';
	valor: number | string | null;
	detalhe: string | null;
	ruim: boolean;
};

export type ProblemaCanal = { nivel: EstadoCanal; motivo: string; problema: string; o_que_fazer: string; acao: string };

export type CanalEstado = {
	canal: string;
	grupo: GrupoCanal;
	quem: QuemExecuta;
	estado: EstadoCanal;
	motivo: string | null;
	problema: string | null;
	o_que_fazer: string | null;
	acao: string;
	ultima_atividade: string | null;
	sinais: SinalCanal[];
	problemas: ProblemaCanal[];
};

export type EstadoCanais = {
	empresa_id: number;
	gerado_em: string;
	hoje: string;
	resumo: Partial<Record<EstadoCanal, number>>;
	canais: CanalEstado[];
};

/** Os 6 canais, na ordem da tela (Mensagens e depois Voz). */
export const CANAIS_TELA = ['whatsapp', 'sms', 'rcs', 'email', 'agente_voz', 'discador'] as const;
export type CanalTelaId = (typeof CANAIS_TELA)[number];
export function ehCanalTela(c: string | undefined): c is CanalTelaId {
	return !!c && (CANAIS_TELA as readonly string[]).includes(c);
}

/** Tom do design system (Pilula/Aviso) de cada estado. */
export const ESTADOS: Record<EstadoCanal, { rotulo: string; tom: 'ok' | 'atencao' | 'erro' | 'neutro'; resumo: (n: number) => string }> = {
	funcionando: { rotulo: 'Funcionando', tom: 'ok', resumo: n => `${n} funcionando` },
	com_problema: { rotulo: 'Com problema', tom: 'erro', resumo: n => `${n} com problema` },
	atencao: { rotulo: 'Atenção', tom: 'atencao', resumo: n => `${n} com atenção` },
	pausado: { rotulo: 'Pausado', tom: 'neutro', resumo: n => `${n} ${n === 1 ? 'pausado' : 'pausados'}` },
	nao_configurado: { rotulo: 'Não configurado', tom: 'neutro', resumo: n => `${n} não ${n === 1 ? 'configurado' : 'configurados'}` },
};
/** Ordem dos chips do resumo (a mesma do protótipo aprovado). */
export const ORDEM_RESUMO: EstadoCanal[] = ['funcionando', 'com_problema', 'atencao', 'pausado', 'nao_configurado'];

export function chipsResumo(resumo: EstadoCanais['resumo']): { estado: EstadoCanal; texto: string }[] {
	return ORDEM_RESUMO.filter(e => (resumo[e] ?? 0) > 0).map(e => ({ estado: e, texto: ESTADOS[e].resumo(resumo[e] ?? 0) }));
}

/** Nome, sigla e cor do ícone. O agente de voz muda de nome quando quem liga é o AGV do cliente. */
export function identidade(canal: string, quem?: QuemExecuta): { nome: string; sigla: string; cor: string } {
	switch (canal) {
		case 'whatsapp': return { nome: 'WhatsApp', sigla: 'WA', cor: 'var(--canal-whatsapp)' };
		case 'sms': return { nome: 'SMS', sigla: 'SMS', cor: 'var(--canal-sms)' };
		case 'rcs': return { nome: 'RCS', sigla: 'RCS', cor: 'var(--canal-rcs)' };
		case 'email': return { nome: 'E-mail', sigla: '@', cor: 'var(--canal-email)' };
		case 'agente_voz': return quem === 'lista'
			? { nome: 'Agente de voz do cliente (AGV)', sigla: 'AGV', cor: 'var(--canal-voz)' }
			: { nome: 'Agente de voz', sigla: 'IA', cor: 'var(--canal-voz)' };
		case 'discador': return { nome: 'Discador', sigla: 'DSC', cor: 'var(--canal-discador)' };
		default: return { nome: canal, sigla: canal.slice(0, 3).toUpperCase(), cor: 'var(--base-texto-2)' };
	}
}

/** "Quem executa" no cartão. */
export function quemTexto(canal: string, quem: QuemExecuta): string {
	if (quem === 'motorcx') return 'MotorCX envia';
	if (quem === 'voz_motorcx') return canal === 'discador' ? 'Voz MotorCX liga e transfere para seus operadores' : 'Voz MotorCX liga';
	if (canal === 'agente_voz') return 'Lista para baixar · o seu AGV liga';
	if (canal === 'discador') return 'Lista para baixar · o discador da sua empresa liga';
	return 'Lista para baixar · seu fornecedor envia';
}

/** Ação principal (código da RPC) → rótulo e rota. Código desconhecido cai em "Configurar". */
export function acaoDe(acao: string, canal: string): { rotulo: string; to: string } {
	const msg = `/mensageria/${canal}`;
	switch (acao) {
		case 'ver_envios': return { rotulo: 'Ver envios', to: `${msg}/lotes` };
		case 'score_entrega': return { rotulo: 'Ver o Score de entrega', to: `${msg}/score` };
		case 'orcamento': return { rotulo: 'Ver o orçamento', to: `${msg}/config` };
		case 'lotes': return { rotulo: 'Ver o lote de hoje', to: `${msg}/lotes` };
		case 'suporte': return { rotulo: canal === 'rcs' ? 'Pedir a verificação' : 'Falar com a equipe', to: '/suporte/novo' };
		case 'estrategias': return { rotulo: 'Ver as estratégias', to: '/estrategias' };
		case 'retomar': return { rotulo: 'Retomar', to: `/canais/${canal}` };
		case 'enviar_retorno': return { rotulo: 'Enviar o retorno', to: '/envios' };
		case 'mapear_codigos': return { rotulo: 'Mapear os códigos', to: '/credores' };
		case 'baixar_lista': return { rotulo: 'Baixar a lista de hoje', to: '/fila' };
		case 'telefonia': return { rotulo: 'Ver em Telefonia', to: '/voz/telefonia' };
		case 'agente_voz': return { rotulo: 'Abrir em Agente Voz/CX', to: '/voz' };
		case 'ligacoes': return { rotulo: 'Ver as ligações', to: '/voz/ligacoes' };
		case 'discagem': return { rotulo: 'Ver a Discagem', to: '/voz/discagem' };
		default: return { rotulo: 'Configurar', to: `/canais/${canal}` };
	}
}

// ------------------------------------------------------------------ formatação (pt-BR, São Paulo)
const TZ = 'America/Sao_Paulo';
const fmtNum = new Intl.NumberFormat('pt-BR');
const fmtPct = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 });
const fmtDiaSP = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
const fmtHoraSP = new Intl.DateTimeFormat('pt-BR', { timeZone: TZ, hour: '2-digit', minute: '2-digit' });

export function numero(v: unknown): string {
	const n = Number(v);
	return v === null || v === undefined || v === '' || !Number.isFinite(n) ? '—' : fmtNum.format(n);
}
export function percentual(v: unknown): string {
	const n = Number(v);
	return v === null || v === undefined || v === '' || !Number.isFinite(n) ? '—' : `${fmtPct.format(n)}%`;
}

function diaAnterior(iso: string): string {
	const d = new Date(`${iso}T12:00:00Z`);
	d.setUTCDate(d.getUTCDate() - 1);
	return d.toISOString().slice(0, 10);
}
/** "2026-11-08" → "hoje" / "ontem" / "05/11" (relativo ao `hoje` da RPC). */
export function dia(iso: string | null | undefined, hoje: string): string {
	if (!iso) return '—';
	const d = String(iso).slice(0, 10);
	if (d === hoje) return 'hoje';
	if (d === diaAnterior(hoje)) return 'ontem';
	return `${d.slice(8, 10)}/${d.slice(5, 7)}`;
}
/** Instante → "hoje, 10:42" / "ontem, 22:05" / "05/11, 21:40" no horário de São Paulo. */
export function instante(ts: string | null | undefined, hoje: string): string {
	if (!ts) return '—';
	const t = new Date(ts);
	if (Number.isNaN(t.getTime())) return '—';
	return `${dia(fmtDiaSP.format(t), hoje)}, ${fmtHoraSP.format(t)}`;
}

export function valorSinal(s: SinalCanal, hoje: string): string {
	if (s.valor === null || s.valor === undefined) return '—';
	if (s.tipo === 'pct') return percentual(s.valor);
	if (s.tipo === 'numero') return numero(s.valor);
	if (s.tipo === 'data') return instante(String(s.valor), hoje);
	return dia(String(s.valor), hoje);
}

/** Pedaços de texto; `b` = número em destaque. */
export type Trecho = { t: string; b?: boolean };

function sinal(c: CanalEstado, chave: string): SinalCanal | undefined {
	return c.sinais.find(s => s.chave === chave);
}

/** As 2 linhas de "última atividade" do cartão, a partir dos sinais da RPC. */
export function linhasAtividade(c: CanalEstado, hoje: string): Trecho[][] {
	if (c.estado === 'pausado') {
		const desde = sinal(c, 'pausado_desde');
		return [
			[{ t: 'Pausado desde ' }, { t: dia(desde?.valor ? String(desde.valor).slice(0, 10) : null, hoje), b: true }, { t: '.' }],
			[{ t: 'Enquanto pausado, nenhuma estratégia usa este canal.' }],
		];
	}
	if (c.quem === 'motorcx') {
		const ult = sinal(c, 'ultimo_envio');
		const env = sinal(c, 'enviadas_24h');
		const ent = sinal(c, 'entregues_24h');
		if (!ult?.valor) return [[{ t: 'Nunca enviou.' }]];
		const l2: Trecho[] = [{ t: numero(env?.valor ?? 0), b: true }, { t: ' enviadas em 24 h' }];
		if (ent?.valor !== null && ent?.valor !== undefined) l2.push({ t: ' · ' }, { t: percentual(ent.valor), b: true }, { t: ' entregues' });
		return [[{ t: 'Último envio: ' }, { t: instante(String(ult.valor), hoje), b: true }], l2];
	}
	if (c.quem === 'voz_motorcx') {
		const lote = sinal(c, 'lote_hoje');
		const lig = sinal(c, 'ligacoes_24h');
		const at = sinal(c, 'atendidas_24h');
		const tr = sinal(c, 'transferidas_24h');
		const l1: Trecho[] = lote?.detalhe === 'ligando agora' && lote.valor !== null
			? [{ t: 'Ligando agora: ' }, { t: `lote de hoje, ${percentual(lote.valor)}`, b: true }]
			: c.ultima_atividade
				? [{ t: 'Última ligação: ' }, { t: instante(c.ultima_atividade, hoje), b: true }]
				: [{ t: 'Nenhuma ligação nos últimos 30 dias.' }];
		const l2: Trecho[] = [{ t: numero(lig?.valor ?? 0), b: true }, { t: ' ligações em 24 h' }];
		if (at?.valor !== null && at?.valor !== undefined) l2.push({ t: ' · ' }, { t: percentual(at.valor), b: true }, { t: ' atendidas' });
		if (tr && Number(tr.valor) > 0) l2.push({ t: ' · ' }, { t: numero(tr.valor), b: true }, { t: ' transferidas a operador' });
		return [l1, l2];
	}
	const lista = sinal(c, 'ultima_lista');
	const ret = sinal(c, 'ultimo_retorno');
	const l1: Trecho[] = lista?.valor
		? [{ t: 'Última lista: ' }, { t: dia(String(lista.valor), hoje), b: true }, ...(lista.detalhe ? [{ t: ` · ${lista.detalhe}` }] : [])]
		: [{ t: 'Nenhuma lista gerada ainda.' }];
	const l2: Trecho[] = ret?.valor
		? [{ t: 'Último retorno: ' }, { t: instante(String(ret.valor), hoje), b: true }]
		: [{ t: 'O retorno do fornecedor nunca chegou.' }];
	return [l1, l2];
}
