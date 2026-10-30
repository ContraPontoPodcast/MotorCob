// Retorno dos canais — tipos, constantes e padrões de regras.
// As regras de retorno são POR CREDOR, gravadas em credores.regras_retorno (jsonb)
// no formato {"sms": {...}, "rcs": {...}, "whatsapp": {...}, "email": {...}, "voz": {...}}.
// A coluna canais_empresa.regras_retorno não é mais usada.

export type TipoRetornoCanal = 'canal_sms' | 'canal_rcs' | 'canal_whatsapp' | 'canal_email' | 'canal_voz';

/** Os 5 retornos de canal: tipo do envio, canal em canal_codigos, rótulo do card e canal em canais_empresa. */
export const retornoCanais: { tipo: TipoRetornoCanal; canal: string; label: string; canalEmpresa: string; canalEmpresaLabel: string }[] = [
	{ tipo: 'canal_sms', canal: 'sms', label: 'Retorno SMS', canalEmpresa: 'sms', canalEmpresaLabel: 'SMS' },
	{ tipo: 'canal_rcs', canal: 'rcs', label: 'Retorno RCS', canalEmpresa: 'rcs', canalEmpresaLabel: 'RCS' },
	{ tipo: 'canal_whatsapp', canal: 'whatsapp', label: 'Retorno WhatsApp', canalEmpresa: 'whatsapp', canalEmpresaLabel: 'WhatsApp' },
	{ tipo: 'canal_email', canal: 'email', label: 'Retorno e-mail', canalEmpresa: 'email', canalEmpresaLabel: 'E-mail' },
	{ tipo: 'canal_voz', canal: 'voz', label: 'Retorno voz', canalEmpresa: 'discador', canalEmpresaLabel: 'Voz (Discador)' },
];

export const retornoTipoSet = new Set<string>(retornoCanais.map(r => r.tipo));

export function retornoCanalPorTipo(tipo: string) {
	return retornoCanais.find(r => r.tipo === tipo) ?? null;
}

/** Marca interna de um código de status do fornecedor. */
export type MarcaCanal = 'inexistente' | 'temporario' | 'entregue' | 'lido' | 'clique' | 'bloqueio';

/** Marcas genéricas (legado / fallback). */
export const marcaOpts: { value: MarcaCanal; label: string; ajuda: string }[] = [
	{ value: 'inexistente', label: 'Inexistente', ajuda: 'DLR permanente, hard bounce, número não existe' },
	{ value: 'temporario', label: 'Temporário', ajuda: 'aparelho desligado, fora de área, caixa cheia (soft bounce)' },
	{ value: 'entregue', label: 'Entregue', ajuda: 'chegou: o contato existe' },
	{ value: 'lido', label: 'Lido', ajuda: 'leu / abriu' },
	{ value: 'clique', label: 'Clique', ajuda: 'clicou, respondeu, interagiu' },
	{ value: 'bloqueio', label: 'Bloqueio', ajuda: 'opt-out, bloqueio, descadastro' },
];

export const marcaLabel: Record<string, string> = Object.fromEntries(marcaOpts.map(m => [m.value, m.label]));

/**
 * Opções de status POR CANAL — o rótulo que o usuário vê no select, gravando a marca interna.
 * Cada canal devolve os status com o seu próprio nome.
 */
export const statusCanalOpts: Record<string, { label: string; marca: MarcaCanal }[]> = {
	sms: [
		{ label: 'Entregue', marca: 'entregue' },
		{ label: 'Clique / resposta', marca: 'clique' },
		{ label: 'Não entregue (DLR)', marca: 'inexistente' },
		{ label: 'Falha temporária', marca: 'temporario' },
		{ label: 'Opt-out', marca: 'bloqueio' },
	],
	rcs: [
		{ label: 'Entregue', marca: 'entregue' },
		{ label: 'Lido', marca: 'lido' },
		{ label: 'Clique / interação', marca: 'clique' },
		{ label: 'Sem suporte a RCS', marca: 'inexistente' },
		{ label: 'Falha temporária', marca: 'temporario' },
		{ label: 'Opt-out / bloqueio', marca: 'bloqueio' },
	],
	whatsapp: [
		{ label: 'Entregue', marca: 'entregue' },
		{ label: 'Lido', marca: 'lido' },
		{ label: 'Respondeu / clicou', marca: 'clique' },
		{ label: 'Sem conta no WhatsApp', marca: 'inexistente' },
		{ label: 'Falha temporária', marca: 'temporario' },
		{ label: 'Bloqueou / denunciou', marca: 'bloqueio' },
	],
	email: [
		{ label: 'Entregue', marca: 'entregue' },
		{ label: 'Aberto', marca: 'lido' },
		{ label: 'Clique', marca: 'clique' },
		{ label: 'Hard bounce', marca: 'inexistente' },
		{ label: 'Soft bounce', marca: 'temporario' },
		{ label: 'Descadastro / spam', marca: 'bloqueio' },
	],
	voz: [
		{ label: 'Atendeu', marca: 'clique' },
		{ label: 'Caixa postal', marca: 'entregue' },
		{ label: 'Número inexistente', marca: 'inexistente' },
		{ label: 'Não atende / ocupado / fora de área', marca: 'temporario' },
		{ label: 'Não ligar', marca: 'bloqueio' },
	],
};

/** Rótulo amigável de uma marca, com o nome do canal (para os chips "por_marca"). */
export function marcaLabelPorCanal(canal: string, marca: string): string {
	const opts = statusCanalOpts[canal];
	if (opts) {
		const found = opts.find(o => o.marca === marca);
		if (found) return found.label;
	}
	return marcaLabel[marca] ?? marca;
}

/** Tipo de ação ao receber "inexistente". */
export type AcaoInexistente = 'escalonar' | 'bloquear' | 'retestar' | 'ignorar';

/** Opções de "inexistente" POR CANAL — os rótulos mudam conforme o canal. */
export const inexistenteOptsPorCanal: Record<string, { value: AcaoInexistente; label: string }[]> = {
	sms: [
		{ value: 'escalonar', label: 'Suspensão escalonada' },
		{ value: 'bloquear', label: 'Tirar do SMS e RCS' },
		{ value: 'ignorar', label: 'Não usar' },
	],
	rcs: [
		{ value: 'retestar', label: 'Tirar e testar de novo' },
		{ value: 'bloquear', label: 'Tirar de vez' },
		{ value: 'ignorar', label: 'Não usar' },
	],
	whatsapp: [
		{ value: 'retestar', label: 'Tirar e testar de novo' },
		{ value: 'bloquear', label: 'Tirar de vez' },
		{ value: 'ignorar', label: 'Não usar' },
	],
	email: [
		{ value: 'bloquear', label: 'Tirar de vez' },
		{ value: 'retestar', label: 'Tirar e testar de novo' },
		{ value: 'ignorar', label: 'Não usar' },
	],
	voz: [
		{ value: 'escalonar', label: 'Suspensão escalonada' },
		{ value: 'bloquear', label: 'Tirar de todos os canais de telefone' },
		{ value: 'ignorar', label: 'Não usar' },
	],
};

/** Regras de retorno gravadas em credores.regras_retorno[canal] (jsonb). Vazio = sugestão. */
export type RegrasRetorno = {
	inexistente?: AcaoInexistente;
	escalonamento?: number[];
	dias_rever?: number;
	temporarios_pausa?: number;
	dias_pausa?: number;
	limite_lote?: number;
};

/** Sugestão MotorCob por canal (chave: sms, rcs, whatsapp, email, voz). */
export function regrasPadrao(canal: string): RegrasRetorno {
	switch (canal) {
		case 'sms':
			return { inexistente: 'escalonar', escalonamento: [7, 15, 30, 90, 120], temporarios_pausa: 3, dias_pausa: 30, limite_lote: 0.5 };
		case 'rcs':
			return { inexistente: 'retestar', dias_rever: 60, temporarios_pausa: 3, dias_pausa: 30, limite_lote: 0.5 };
		case 'whatsapp':
			return { inexistente: 'retestar', dias_rever: 15, temporarios_pausa: 3, dias_pausa: 30, limite_lote: 0.5 };
		case 'email':
			return { inexistente: 'bloquear', temporarios_pausa: 3, dias_pausa: 30, limite_lote: 0.5 };
		case 'voz':
			return { inexistente: 'escalonar', escalonamento: [7, 15, 30, 90, 120], temporarios_pausa: 0, dias_pausa: 30, limite_lote: 0.5 };
		default:
			return { temporarios_pausa: 3, dias_pausa: 30, limite_lote: 0.5 };
	}
}

/** Descrição curta da sugestão de "inexistente" para mostrar no bloco. */
export function inexistentePadraoTexto(canal: string): string {
	switch (canal) {
		case 'sms': return 'Escalonar (7/15/30/90/120)';
		case 'voz': return 'Escalonar (7/15/30/90/120)';
		case 'email': return 'Bloquear';
		case 'rcs': return 'Retestar em 60 dias';
		case 'whatsapp': return 'Retestar em 15 dias';
		default: return '—';
	}
}

/** True se as regras atuais do canal diferem da sugestão (para destacar "você mudou"). */
export function regrasMudou(canal: string, r: RegrasRetorno | null | undefined): boolean {
	if (!r) return false;
	const padrao = regrasPadrao(canal);
	return JSON.stringify(normalizarRegras(r)) !== JSON.stringify(padrao);
}

function normalizarRegras(r: RegrasRetorno): RegrasRetorno {
	const out: RegrasRetorno = {};
	if (r.inexistente) out.inexistente = r.inexistente;
	if (r.escalonamento && r.escalonamento.length) out.escalonamento = [...r.escalonamento];
	if (r.dias_rever != null) out.dias_rever = r.dias_rever;
	if (r.temporarios_pausa != null) out.temporarios_pausa = r.temporarios_pausa;
	if (r.dias_pausa != null) out.dias_pausa = r.dias_pausa;
	if (r.limite_lote != null) out.limite_lote = r.limite_lote;
	return out;
}

/** Limpa regras vazias de um canal antes de gravar (null = sugestão). */
export function limparRegras(r: RegrasRetorno | null | undefined): RegrasRetorno | null {
	if (!r) return null;
	const n = normalizarRegras(r);
	return Object.keys(n).length ? n : null;
}

/** Limpa o objeto inteiro de regras por canal antes de gravar em credores.regras_retorno.
 *  Remove canais que voltaram à sugestão. */
export function limparRegrasCredor(regras: Record<string, RegrasRetorno | null> | null): Record<string, RegrasRetorno> | null {
	if (!regras) return null;
	const out: Record<string, RegrasRetorno> = {};
	for (const [canal, r] of Object.entries(regras)) {
		if (!regrasMudou(canal, r)) continue;
		const limpo = limparRegras(r);
		if (limpo) out[canal] = limpo;
	}
	return Object.keys(out).length ? out : null;
}

// --- Tabela de retornos esperados por canal (parte "a" do card) ---

export type CampoRegra = 'inexistente' | 'escalonamento' | 'dias_rever' | 'temporarios_pausa' | 'dias_pausa';

export type RetornoRow = {
	evento: string;
	regra: string;
	campos?: CampoRegra[];
};

/** Retornos esperados e regras por canal — alimenta a tabela editável do card. */
export const retornosPorCanal: Record<string, RetornoRow[]> = {
	sms: [
		{ evento: 'Entregue (DELIVRD)', regra: 'Zera as falhas e desfaz suspensão/pausa.' },
		{ evento: 'Clique / resposta', regra: 'Zera as falhas.' },
		{ evento: 'Não entregue (DLR) — UNDELIV, REJECTD, número inválido', regra: 'Suspensão escalonada do número em tudo que vai para o celular.', campos: ['inexistente', 'escalonamento'] },
		{ evento: 'Falha temporária — EXPIRED, desligado, fora de área', regra: 'Seguidas → pausa.', campos: ['temporarios_pausa', 'dias_pausa'] },
		{ evento: 'Opt-out (SAIR/STOP)', regra: 'Nunca mais SMS.' },
	],
	rcs: [
		{ evento: 'Entregue', regra: 'Zera as falhas.' },
		{ evento: 'Lido', regra: 'Zera as falhas.' },
		{ evento: 'Clique / interação', regra: 'Zera as falhas.' },
		{ evento: 'Sem suporte a RCS', regra: 'Sai do RCS e segue por SMS, WhatsApp e/ou voz.', campos: ['inexistente', 'dias_rever'] },
		{ evento: 'Falha temporária', regra: 'Seguidas → pausa.', campos: ['temporarios_pausa', 'dias_pausa'] },
		{ evento: 'Opt-out / bloqueio', regra: 'Nunca mais RCS.' },
	],
	whatsapp: [
		{ evento: 'Entregue', regra: 'Zera as falhas.' },
		{ evento: 'Lido', regra: 'Zera as falhas.' },
		{ evento: 'Respondeu / clicou', regra: 'Zera as falhas.' },
		{ evento: 'Sem conta no WhatsApp', regra: 'Sai do WhatsApp; testa de novo depois.', campos: ['inexistente', 'dias_rever'] },
		{ evento: 'Falha temporária', regra: 'Seguidas → pausa.', campos: ['temporarios_pausa', 'dias_pausa'] },
		{ evento: 'Bloqueou / denunciou', regra: 'Nunca mais WhatsApp.' },
	],
	email: [
		{ evento: 'Entregue', regra: 'Zera as falhas.' },
		{ evento: 'Aberto', regra: 'Zera as falhas.' },
		{ evento: 'Clique', regra: 'Zera as falhas.' },
		{ evento: 'Hard bounce', regra: 'Sai este e-mail, vai o próximo do cliente.', campos: ['inexistente', 'dias_rever'] },
		{ evento: 'Soft bounce (caixa cheia)', regra: 'Seguidos → pausa.', campos: ['temporarios_pausa', 'dias_pausa'] },
		{ evento: 'Descadastro / spam', regra: 'Nunca mais e-mail para o endereço.' },
	],
	voz: [
		{ evento: 'Atendeu', regra: 'Zera as falhas (inclusive as do SMS).' },
		{ evento: 'Caixa postal', regra: 'Zera as falhas (inclusive as do SMS).' },
		{ evento: 'Número inexistente', regra: 'Suspende só a voz nesse número na mesma escada; se o SMS também falhou, as falhas somam e a suspensão vale para tudo do celular.', campos: ['inexistente', 'escalonamento'] },
		{ evento: 'Não atende / ocupado / fora de área', regra: 'Sugestão: não pausar.', campos: ['temporarios_pausa', 'dias_pausa'] },
		{ evento: 'Não ligar', regra: 'Nunca mais voz.' },
	],
};

// --- Saúde dos contatos (execucoes.resumo.retorno_canal) ---

export type CanalSaude = {
	inexistente?: number;
	temporario?: number;
	entregue?: number;
	lido?: number;
	clique?: number;
	bloqueio?: number;
	contatos_suspensos?: number;
	contatos_inexistentes?: number;
	contatos_em_pausa?: number;
	contatos_bloqueados?: number;
	contatos_ativos?: number;
};

export type RetornoCanalResumo = {
	resumo?: Record<string, CanalSaude>;
	oxigenados?: Record<string, number>;
	contatos_fora?: Record<string, number>;
	economia_por_rodada?: number;
	higienizacao?: number;
};

/** Soma de contatos fora de um canal (suspensos + inexistentes + em pausa + bloqueados). */
export function contatosForaCanal(s: CanalSaude | undefined): number {
	if (!s) return 0;
	return Number(s.contatos_suspensos ?? 0) + Number(s.contatos_inexistentes ?? 0) + Number(s.contatos_em_pausa ?? 0) + Number(s.contatos_bloqueados ?? 0);
}

/** Nome amigável do canal a partir do id de canais_empresa. */
export function canalEmpresaNome(canalEmpresa: string): string {
	const map: Record<string, string> = { sms: 'SMS', rcs: 'RCS', whatsapp: 'WhatsApp', email: 'E-mail', discador: 'Voz' };
	return map[canalEmpresa] ?? canalEmpresa;
}
