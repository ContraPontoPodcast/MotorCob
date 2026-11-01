// Agente de voz (SQL 56, supabase/migrations/20261223000001_voz_base.sql): rótulos, formatos, validações e
// cálculos usados pelas telas do Console, da Empresa, da Cobrança e da Mensageria. O banco é a fonte da verdade:
// o site só lê tabelas com RLS e escreve por RPC. LGPD: nunca nome, CPF ou telefone em claro — só o ID do cliente
// e o número mascarado (no máximo 4 dígitos à vista).

/** IPs fixos de saída do Asterisk do MotorCX (São Paulo): a operadora que autentica por IP libera estes. */
export const IPS_SAIDA_MOTORCX = ['35.198.40.10', '34.39.217.31'] as const;

export const PROVEDORES_VOZ: { id: string; nome: string; desc: string }[] = [
	{ id: 'montagem_motorcx', nome: 'Montagem MotorCX', desc: 'Pipeline próprio ligado ao Asterisk: fala para texto, modelo de linguagem e voz neural pt-BR. Cada peça é trocável.' },
	{ id: 'elevenlabs', nome: 'ElevenLabs', desc: 'Agente pronto da ElevenLabs, ligado ao Asterisk por SIP.' },
	{ id: 'simulador', nome: 'Simulador', desc: 'Nada é falado de verdade: respostas simuladas para testar a régua.' },
];

export const MODOS_VOZ: { id: 'simulado' | 'teste' | 'real'; nome: string; desc: string }[] = [
	{ id: 'simulado', nome: 'Simulado', desc: 'Nada liga. O Simulador responde.' },
	{ id: 'teste', nome: 'Só números de teste', desc: 'Liga de verdade, mas só para os números de teste da equipe.' },
	{ id: 'real', nome: 'Real', desc: 'Liga para a Lista do dia, dentro das janelas por UF e DDD.' },
];

export const TIPOS_ROTA: Record<string, string> = {
	fixo_local: 'Fixo local',
	fixo_ldn: 'Fixo LDN',
	movel_vc1: 'Móvel VC1',
	movel_vc2_vc3: 'Móvel VC2/VC3',
};

export const TRANSPORTES = ['udp', 'tcp', 'tls'] as const;

export const FORMATOS_DISCAGEM: { id: string; nome: string; exemplo: string }[] = [
	{ id: 'tech_ddd_numero', nome: 'Tech prefix + DDD + número', exemplo: '1021 11 9••••-••••' },
	{ id: 'tech_0_csp_ddd_numero', nome: 'Tech prefix + 0 + CSP + DDD + número', exemplo: '1021 0 15 11 9••••-••••' },
	{ id: 'tech_55_ddd_numero', nome: 'Tech prefix + 55 + DDD + número', exemplo: '1021 55 11 9••••-••••' },
];

export const CODECS = ['alaw', 'ulaw', 'g729', 'g722', 'opus'] as const;

/** Itens que o MotorCX fatura do agente de voz (cobranca_itens, produto agente_voz). Telefonia não é item. */
export const ITENS_FATURA_VOZ = ['voz_plataforma', 'voz_minuto_ia', 'voz_minuto_ia_pico', 'voz_transcricao', 'gestao_tronco_sip'] as const;

/** Mesma regra de public.segundos_tarifados: sem carência; 0 se não atendeu; o mínimo inicial; depois, blocos. */
export function segundosTarifados(billsec: number, inicial: number, incremento: number): number {
	if (!Number.isFinite(billsec) || billsec <= 0) return 0;
	if (inicial < 1 || incremento < 1) return 0;
	if (billsec <= inicial) return inicial;
	return inicial + Math.ceil((billsec - inicial) / incremento) * incremento;
}

/** Mesma regra de public.custo_voz: segundos × preço do minuto ÷ 60, com 5 casas. */
export function custoVoz(segundos: number, precoMinuto: number): number {
	return Math.round((segundos * precoMinuto / 60) * 100000) / 100000;
}

export const cadenciaTxt = (ini: unknown, inc: unknown) => `${Number(ini)}/${Number(inc)}`;

/** R$ com N casas (preço do minuto de telefonia costuma ter 3 a 5). */
export function reais(v: unknown, casas = 2): string {
	return Number(v ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: casas, maximumFractionDigits: casas });
}

/** Número inteiro em pt-BR. */
export const inteiro = (v: unknown) => Math.round(Number(v ?? 0)).toLocaleString('pt-BR');

/** Lê número digitado em pt-BR ("0,055" ou "1.234,5"). NaN se vazio ou inválido. */
export function lerNumero(v: string): number {
	let s = String(v ?? '').trim();
	if (!s) return NaN;
	if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
	const n = Number(s);
	return Number.isFinite(n) ? n : NaN;
}

/**
 * Bina (número da própria empresa, nunca do devedor). Na tela sai mascarada como no protótipo,
 * com DDD e os 2 últimos dígitos: "(11) 3•••-••00". O banco guarda inteira porque o Asterisk origina com ela.
 */
export function binaMascara(b: unknown): string {
	const d = String(b ?? '').replace(/\D/g, '');
	if (d.length < 6) return d ? '••••' : '—';
	if (/^0[3589]00/.test(d) || /^[34]00/.test(d)) return `${d.slice(0, 4)} •••-••${d.slice(-2)}`;
	return `(${d.slice(0, 2)}) ${d.slice(2, 3)}•••-••${d.slice(-2)}`;
}

// ---------------------------------------------------------------- validações (iguais aos checks do SQL 56)
export const RE_REFERENCIA = /^[a-z0-9][a-z0-9_-]{1,39}$/;
export const RE_IP = /^([0-9]{1,3}\.){3}[0-9]{1,3}$/;
export const RE_HOST = /^[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/;
export const RE_SEGREDO = /^[A-Za-z0-9_\-/.]{1,120}$/;
export const RE_USUARIO = /^[A-Za-z0-9_.\-+]{1,64}$/;
export const RE_DDD = /^[1-9][1-9]$/;
export const RE_BINA = /^([1-9][1-9][2-9][0-9]{7,8}|0[3589]00[0-9]{6,7}|[34]00[0-9][0-9]{4})$/;
export const RE_TECH = /^[0-9]{1,8}$/;
export const RE_CSP = /^[0-9]{2}$/;
export const RE_DESTINO_SIP = /^sips?:[A-Za-z0-9_.+-]{1,64}@[A-Za-z0-9.-]{1,253}(:[0-9]{1,5})?(;transport=(udp|tcp|tls))?$/;

/** ID do cliente no pedido do titular: nunca CPF, telefone ou nome (sequência de 10+ dígitos é recusada). */
export function idClienteValido(v: string): boolean {
	const s = v.trim();
	if (s.length < 1 || s.length > 60) return false;
	if (/[0-9]{10,}/.test(s.replace(/[.\-\s/()]/g, ''))) return false;
	if (/\s/.test(s)) return false;
	return true;
}

/**
 * Hash do número de teste no navegador (sha-256 em hex), com a mesma normalização de nuvem/mensageria.py
 * (só dígitos, sem o 55 do país). O número nunca vai para o banco.
 */
export async function hashNumeroTeste(numero: string): Promise<string | null> {
	let d = numero.replace(/\D/g, '');
	if (/^55\d{10,11}$/.test(d)) d = d.slice(2);
	if (!/^[1-9][1-9]\d{8,9}$/.test(d)) return null;
	if (typeof crypto === 'undefined' || !crypto.subtle) return null;
	const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(d));
	return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

/** Primeiro dia do mês (AAAA-MM-01) de uma data ISO. */
export const inicioMes = (iso: string) => `${iso.slice(0, 7)}-01`;

/** Últimas N competências (AAAA-MM-01), da atual para trás. */
export function competencias(hojeIso: string, n = 6): string[] {
	const [a, m] = hojeIso.slice(0, 7).split('-').map(Number);
	const out: string[] = [];
	for (let i = 0; i < n; i++) {
		const d = new Date(Date.UTC(a, m - 1 - i, 1));
		out.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-01`);
	}
	return out;
}

/** Linhas para CSV (separador ";", decimal com vírgula, como o Excel em pt-BR abre). */
export function paraCsv(cabecalho: string[], linhas: (string | number | null | undefined)[][]): string {
	const cel = (v: string | number | null | undefined) => {
		if (v == null) return '';
		const s = typeof v === 'number' ? String(v).replace('.', ',') : String(v);
		return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
	};
	return '﻿' + [cabecalho.join(';'), ...linhas.map(l => l.map(cel).join(';'))].join('\r\n') + '\r\n';
}

export function baixarTexto(nome: string, texto: string, tipo = 'text/csv;charset=utf-8') {
	const url = URL.createObjectURL(new Blob([texto], { type: tipo }));
	const a = document.createElement('a');
	a.href = url; a.download = nome;
	document.body.appendChild(a); a.click(); a.remove();
	window.setTimeout(() => URL.revokeObjectURL(url), 60000);
}

// ================================================================ telas da Cobrança e da Mensageria

/** Permissões do agente de voz (permissoes_catalogo, SQL 56). */
export const PERM_VOZ = {
	ouvirGravacoes: 'ouvir_gravacoes',
	verTranscricoes: 'ver_transcricoes',
	aprovarRoteiro: 'aprovar_roteiro_voz',
	editarCanais: 'editar_canais',
	enviarMensagens: 'enviar_mensagens',
	reenviarLote: 'reenviar_lote_voz', // SQL 65 · Reenviar agora (padrão: Admin e Operação)
	reciclarLote: 'reciclar_lote_voz', // SQL 65 · Reciclar mailing (padrão: Admin e Operação)
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
