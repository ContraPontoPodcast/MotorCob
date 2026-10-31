// Agente de voz (agente virtual): rótulos, formatos e regras de tela.
// O banco é o SQL 56 (supabase/migrations/20261223000001_voz_base.sql). O site só lê tabelas
// com RLS e escreve por RPC. LGPD: nunca nome, CPF ou telefone em claro — só o ID do cliente
// e o número mascarado (voz_chamadas.destino_mascara, no máximo 4 dígitos à vista).

/** Permissões do agente de voz (permissoes_catalogo, SQL 56). */
export const PERM_VOZ = {
	ouvirGravacoes: 'ouvir_gravacoes',
	verTranscricoes: 'ver_transcricoes',
	aprovarRoteiro: 'aprovar_roteiro_voz',
	editarCanais: 'editar_canais',
	enviarMensagens: 'enviar_mensagens',
} as const;

/** Grupos com menos conversas que isto não mostram percentual (insights_voz devolve null). */
export const MIN_CONVERSAS = 30;

/** Atualização da tela de ligações em curso (sem realtime). */
export const ATUALIZA_MS = 15_000;

/** Caminho previsto no plano para ouvir e ler (Edge Function `gravacoes`). */
export const FUNCAO_GRAVACOES = 'gravacoes';

// ----------------------------------------------------------------------------- resultados
/** Desfechos de voz (desfechos_voz()) → rótulo e tom da pílula. */
export const RESULTADO_VOZ: Record<string, { label: string; tom: Tom }> = {
	promessa: { label: 'Promessa', tom: 'ok' },
	cpc: { label: 'Falou com o titular', tom: 'ok' },
	identidade_confirmada: { label: 'Identidade confirmada', tom: 'ok' },
	retorno_agendado: { label: 'Pediu retorno', tom: 'info' },
	recado: { label: 'Recado', tom: 'info' },
	recusa: { label: 'Recusa', tom: 'neutro' },
	opt_out: { label: 'Pediu para não ligar', tom: 'atencao' },
	atendida_sem_cpc: { label: 'Atendeu outra pessoa', tom: 'neutro' },
	atendida_terceiro_desconhece: { label: 'Terceiro desconhece', tom: 'neutro' },
	caixa_postal: { label: 'Caixa postal', tom: 'neutro' },
	maquina: { label: 'Máquina', tom: 'neutro' },
	nao_atendida: { label: 'Não atendeu', tom: 'neutro' },
	ocupado: { label: 'Ocupado', tom: 'neutro' },
	abandonada: { label: 'Abandono', tom: 'atencao' },
	desligou_sem_conversar: { label: 'Desligou sem conversar', tom: 'neutro' },
	atendeu_desligou: { label: 'Atendeu e desligou', tom: 'neutro' },
	mudo: { label: 'Mudo', tom: 'neutro' },
	fax: { label: 'Fax', tom: 'neutro' },
	numero_inexistente: { label: 'Número inexistente', tom: 'atencao' },
	indisponivel: { label: 'Indisponível', tom: 'neutro' },
	rejeitada: { label: 'Rejeitada', tom: 'neutro' },
	falha_rede: { label: 'Falha de rede', tom: 'erro' },
	falha_operadora: { label: 'Falha da operadora', tom: 'erro' },
	bloqueio_originacao: { label: 'Bloqueio na origem', tom: 'erro' },
	cancelada_discador: { label: 'Cancelada', tom: 'neutro' },
	em_andamento: { label: 'Em andamento', tom: 'info' },
};

export function resultadoVoz(r: unknown): { label: string; tom: Tom } {
	const k = String(r ?? '');
	return RESULTADO_VOZ[k] ?? { label: k ? k.replace(/_/g, ' ') : '—', tom: 'neutro' };
}

// ----------------------------------------------------------------------------- códigos fechados
/** codigos_voz_validos(): rótulos dos valores. Saúde nunca vira código. */
export const MOTIVO_LABEL: Record<string, string> = {
	desemprego: 'Desemprego',
	reducao_renda: 'Redução de renda',
	outras_dividas: 'Outras dívidas',
	esquecimento: 'Esqueceu',
	aguardando_recebimento: 'Aguardando receber',
	nao_reconhece: 'Não reconhece',
	contestacao: 'Contesta a dívida',
	fraude_alegada: 'Alega fraude',
	insatisfacao_servico: 'Insatisfeito com o serviço',
	outro: 'Outro',
};

export const OBJECAO_LABEL: Record<string, string> = {
	valor_alto: 'Valor alto',
	parcela_alta: 'Parcela alta',
	juros: 'Juros',
	sem_dinheiro_agora: 'Sem dinheiro agora',
	quer_desconto: 'Quer desconto',
	desconfia_golpe: 'Desconfia, achou golpe',
	quer_por_escrito: 'Quer por escrito',
	quer_falar_humano: 'Quer falar com pessoa',
	outro: 'Outro',
};

export const CANAL_PREF_LABEL: Record<string, string> = {
	whatsapp: 'WhatsApp', sms: 'SMS', email: 'E-mail', rcs: 'RCS', agente_voz: 'Agente virtual', discador: 'Discador',
};

export const HORARIO_LABEL: Record<string, string> = { manha: 'manhã', tarde: 'tarde', noite: 'noite', sabado: 'sábado' };

export type CodigosVoz = {
	motivo?: string;
	objecoes?: string[];
	promessa?: { data: string; valor?: number; parcelas?: number };
	retorno?: { quando: string };
	canal_preferido?: string;
	horario_preferido?: string;
};

/** Pílulas "Para a próxima ligação": só códigos fechados, nunca texto livre. */
export function codigosEmPilulas(c: CodigosVoz | null | undefined): string[] {
	if (!c || typeof c !== 'object') return [];
	const out: string[] = [];
	if (c.promessa?.data) out.push(`promessa: ${dataCurta(c.promessa.data)}`);
	if (c.motivo) out.push(`motivo: ${(MOTIVO_LABEL[c.motivo] ?? c.motivo).toLowerCase()}`);
	for (const o of c.objecoes ?? []) out.push(`objeção: ${(OBJECAO_LABEL[o] ?? o).toLowerCase()}`);
	if (c.retorno?.quando) out.push(`retorno: ${dataHoraCurta(c.retorno.quando)}`);
	if (c.horario_preferido) out.push(`horário: ${HORARIO_LABEL[c.horario_preferido] ?? c.horario_preferido}`);
	if (c.canal_preferido) out.push(`canal: ${CANAL_PREF_LABEL[c.canal_preferido] ?? c.canal_preferido}`);
	return out;
}

// ----------------------------------------------------------------------------- rotas
export const TIPO_ROTA: Record<string, string> = {
	fixo_local: 'Fixo local', fixo_ldn: 'Fixo LDN', movel_vc1: 'Móvel VC1', movel_vc2_vc3: 'Móvel VC2/VC3',
};

// ----------------------------------------------------------------------------- roteiro
export const SITUACAO_ROTEIRO: Record<string, string> = {
	rascunho: 'Rascunho', aprovado_empresa: 'Aprovado pela empresa', em_uso: 'Em uso', arquivado: 'Arquivado',
};

export type TipoAgente = 'localizador' | 'negociador' | 'ambos';

export const TIPOS_AGENTE: { id: TipoAgente; nome: string; desc: string }[] = [
	{ id: 'localizador', nome: 'Localizador', desc: 'Confirma que fala com o titular (CPC), atualiza o melhor horário e canal e transfere para o operador negociar. Não fala de valor.' },
	{ id: 'negociador', nome: 'Negociador', desc: 'Já liga para negociar: confirma o titular, apresenta a dívida e as ofertas da carteira e fecha promessa ou acordo. Transfere só nas regras abaixo.' },
	{ id: 'ambos', nome: 'Localizador e negociador', desc: 'Localiza o titular e segue negociando na mesma ligação. Transfere só nas regras abaixo.' },
];

/** regras_transferencia_validas(): esquema fechado. */
export type RegrasTransferencia = {
	cpc: boolean;
	pedido_humano: true;
	ofertas_sem_acordo: number; // 0..5
	fora_alcada: boolean;
	contestacao: boolean;
};

export function regrasPadrao(tipo: TipoAgente): RegrasTransferencia {
	return { cpc: tipo === 'localizador', pedido_humano: true, ofertas_sem_acordo: tipo === 'localizador' ? 0 : 2, fora_alcada: true, contestacao: true };
}

/** Normaliza o que veio do banco para o esquema fechado (chaves ausentes = padrão do tipo). */
export function regrasDe(tipo: TipoAgente, r: unknown): RegrasTransferencia {
	const p = regrasPadrao(tipo);
	if (!r || typeof r !== 'object') return p;
	const o = r as Record<string, unknown>;
	const n = Number(o.ofertas_sem_acordo);
	return {
		cpc: tipo === 'localizador' ? true : typeof o.cpc === 'boolean' ? o.cpc : p.cpc,
		pedido_humano: true,
		ofertas_sem_acordo: Number.isInteger(n) && n >= 0 && n <= 5 ? n : p.ofertas_sem_acordo,
		fora_alcada: typeof o.fora_alcada === 'boolean' ? o.fora_alcada : p.fora_alcada,
		contestacao: typeof o.contestacao === 'boolean' ? o.contestacao : p.contestacao,
	};
}

/** variaveis_voz(): o que pode ir para o provedor. Nunca CPF, endereço, contrato, e-mail. */
export const VARIAVEIS_VOZ: { id: string; desc: string; sempre?: boolean }[] = [
	{ id: 'primeiro_nome', desc: 'Só o primeiro nome, para a saudação', sempre: true },
	{ id: 'credor', desc: 'Nome do credor', sempre: true },
	{ id: 'saldo', desc: 'Valor atualizado; só é dito depois de confirmar a identidade' },
	{ id: 'dias_atraso', desc: 'Dias de atraso; só depois de confirmar a identidade' },
	{ id: 'vencimento', desc: 'Vencimento do acordo, se houver' },
	{ id: 'link_pagamento', desc: 'Link rastreável da ação, mandado por SMS se a pessoa pedir' },
	{ id: 'valor_minimo', desc: 'Menor valor que a carteira aceita (alçada)' },
	{ id: 'parcelas_max', desc: 'Máximo de parcelas da carteira (alçada)' },
	{ id: 'desconto_max', desc: 'Desconto máximo da carteira (alçada)' },
];

/** Começo fixo da primeira fala; a frase de assistente virtual é opção do roteiro. */
export function aberturaFixa(virtual: boolean, avisoGravacao: boolean): string {
	return `Olá, aqui é ${virtual ? 'a assistente virtual' : 'a central'} da {{assessoria}}, em nome de {{credor}}.${avisoGravacao ? ' Esta ligação é gravada.' : ''} Falo com {{primeiro_nome}}?`;
}

// ----------------------------------------------------------------------------- lote
export const SIT_LOTE_VOZ: Record<string, { label: string; tom: Tom }> = {
	aguardando_aprovacao: { label: 'Aguardando aprovação', tom: 'atencao' },
	agendado: { label: 'Agendado', tom: 'info' },
	ligando: { label: 'Em curso', tom: 'info' },
	pausado: { label: 'Pausado', tom: 'atencao' },
	concluido: { label: 'Concluído', tom: 'ok' },
	cancelado: { label: 'Cancelado', tom: 'neutro' },
};

export const SIT_ONDA: Record<string, { label: string; tom: Tom }> = {
	aguardando: { label: 'Aguardando a janela', tom: 'neutro' },
	ligando: { label: 'Em curso', tom: 'info' },
	encerrada: { label: 'Concluída', tom: 'ok' },
	cancelada: { label: 'Cancelada', tom: 'neutro' },
};

/** Agrupa o resumo_lote_voz() no funil "Resultado até agora". */
export function funilDoResumo(linhas: { resultado: string; chamadas: number }[]) {
	const soma = (ks: string[]) => linhas.filter(l => ks.includes(l.resultado)).reduce((t, l) => t + Number(l.chamadas || 0), 0);
	const total = linhas.reduce((t, l) => t + Number(l.chamadas || 0), 0);
	const andamento = soma(['em_andamento']);
	const encerradas = total - andamento;
	const naoAtendeu = soma(['nao_atendida', 'ocupado', 'numero_inexistente', 'indisponivel', 'rejeitada', 'falha_rede', 'falha_operadora', 'bloqueio_originacao', 'cancelada_discador']);
	const caixa = soma(['caixa_postal', 'maquina', 'fax']);
	const identidade = soma(['cpc', 'identidade_confirmada', 'promessa', 'recusa', 'retorno_agendado', 'opt_out']);
	return {
		total, andamento, encerradas,
		atendidas: Math.max(0, encerradas - naoAtendeu),
		identidade,
		promessas: soma(['promessa']),
		retorno: soma(['retorno_agendado']),
		naoLigar: soma(['opt_out']),
		caixa,
		abandono: soma(['abandonada']),
	};
}

// ----------------------------------------------------------------------------- importação
export const ADAPTADORES: { id: string; nome: string }[] = [
	{ id: 'aspect', nome: 'Aspect' },
	{ id: 'olos', nome: 'Olos' },
	{ id: '2cx', nome: '2CX (Call Flex)' },
	{ id: '3cplus', nome: '3C+' },
	{ id: 'totalip', nome: 'Total IP' },
	{ id: 'tactium', nome: 'Tactium' },
	{ id: 'fastway', nome: 'Fastway' },
	{ id: 'generico', nome: 'Genérico (SFTP, URL, API)' },
];

export const FORMA_IMPORT: Record<string, string> = {
	sftp: 'SFTP ou bucket', url: 'URL por chamada', api: 'API própria', arquivo: 'Arquivo em Cargas',
};

export const MOTIVO_QUARENTENA: Record<string, string> = {
	sem_par: 'Sem par na Lista do dia',
	par_ambiguo: 'Mais de um par possível: não casa no palpite',
	nome_com_dado_pessoal: 'Nome do arquivo com telefone ou CPF (nome descartado)',
	formato: 'Formato não suportado ou arquivo corrompido',
	outro: 'Outro motivo',
};

// ----------------------------------------------------------------------------- formatos
export type Tom = 'ok' | 'info' | 'atencao' | 'erro' | 'neutro';

const TZ = 'America/Sao_Paulo';

/** "3:12" ou "—". */
export function duracao(s: unknown): string {
	const n = Number(s);
	if (s == null || !Number.isFinite(n) || n <= 0) return '—';
	const m = Math.floor(n / 60);
	return `${m}:${String(Math.round(n % 60)).padStart(2, '0')}`;
}

/** "3 min 12 s". */
export function duracaoExtensa(s: unknown): string {
	const n = Math.round(Number(s) || 0);
	if (n <= 0) return '0 s';
	const m = Math.floor(n / 60);
	const r = n % 60;
	return m ? `${m} min${r ? ` ${r} s` : ''}` : `${r} s`;
}

export function dataCurta(iso: unknown): string {
	if (!iso) return '—';
	const s = String(iso);
	const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
	if (m) return `${m[3]}/${m[2]}`;
	try { return new Intl.DateTimeFormat('pt-BR', { timeZone: TZ, day: '2-digit', month: '2-digit' }).format(new Date(s)); } catch { return '—'; }
}

export function dataHoraCurta(iso: unknown): string {
	if (!iso) return '—';
	try {
		return new Intl.DateTimeFormat('pt-BR', { timeZone: TZ, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(String(iso))).replace(',', '');
	} catch { return '—'; }
}

export function horaCurta(iso: unknown): string {
	if (!iso) return '—';
	try { return new Intl.DateTimeFormat('pt-BR', { timeZone: TZ, hour: '2-digit', minute: '2-digit' }).format(new Date(String(iso))); } catch { return '—'; }
}

export function inteiro(n: unknown): string {
	return Math.round(Number(n) || 0).toLocaleString('pt-BR');
}

export function reais(n: unknown, casas = 2): string {
	return `R$ ${Number(n || 0).toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas })}`;
}

export function pct(n: unknown, casas = 1): string {
	const v = Number(n);
	if (!Number.isFinite(v)) return '—';
	return `${v.toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas })}%`;
}

/** Defesa extra de LGPD: se a máscara vier com mais de 4 dígitos à vista, mostra só os 2 últimos. */
export function numeroMascarado(m: unknown): string {
	const s = String(m ?? '').trim();
	if (!s) return '—';
	const digitos = s.replace(/\D/g, '');
	if (digitos.length <= 4) return s;
	return `••••-••${digitos.slice(-2)}`;
}

/** Dias inteiros até a data (0 se passou). */
export function diasAte(iso: unknown, agora = Date.now()): number {
	if (!iso) return 0;
	const t = new Date(String(iso)).getTime();
	if (!Number.isFinite(t)) return 0;
	return Math.max(0, Math.ceil((t - agora) / 86_400_000));
}

/** Data ISO (AAAA-MM-DD) no fuso de São Paulo, deslocada em dias. */
export function diaISO(deslocamento = 0, base = new Date()): string {
	const d = new Date(base.getTime() + deslocamento * 86_400_000);
	return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}
