// Metadata, tipos e helpers da Mensageria por produto (canal).
// O site NÃO envia mensagens: só acompanha e decide. Nunca expõe contato completo.

export type CanalId = 'sms' | 'rcs' | 'email' | 'whatsapp';

export const CANAIS_VALIDOS: CanalId[] = ['sms', 'rcs', 'email', 'whatsapp'];

export function isCanalValido(canal: string | undefined): canal is CanalId {
	return !!canal && (CANAIS_VALIDOS as string[]).includes(canal);
}

export type Produto = { id: CanalId; nome: string; cor: string; descricao: string };

export const PRODUTOS: Produto[] = [
	{ id: 'sms', nome: 'SMS', cor: '#7A4FB0', descricao: 'Mensagens de texto com confirmação de entrega e respostas.' },
	{ id: 'rcs', nome: 'RCS', cor: '#3B5BA9', descricao: 'Mensagens ricas com botões, mídia e carrossel para aparelhos compatíveis.' },
	{ id: 'email', nome: 'E-mail', cor: '#A2552B', descricao: 'Comunicação formal com modelo personalizado da empresa.' },
	{ id: 'whatsapp', nome: 'WhatsApp', cor: '#1F8A4C', descricao: 'Conversas com o cliente no canal mais usado do Brasil.' },
];

export const PRODUTO_MAP: Record<string, { nome: string; cor: string }> = {
	sms: { nome: 'SMS', cor: '#7A4FB0' },
	rcs: { nome: 'RCS', cor: '#3B5BA9' },
	email: { nome: 'E-mail', cor: '#A2552B' },
	whatsapp: { nome: 'WhatsApp', cor: '#1F8A4C' },
};

export const CANAL_STORAGE_KEY = 'motorcob.mensageria.canal';

/** Classes do Radar MotorCob — rótulo e cor. */
export const RADAR_CLASSES: Record<string, { label: string; cor: string }> = {
	cpc_negocio: { label: 'CPC Negócio', cor: '#1F8A4C' },
	cpc: { label: 'CPC', cor: '#0A60D0' },
	alega_pagamento: { label: 'Alega pagamento', cor: '#7A4FB0' },
	judicial: { label: 'Judicial', cor: '#B3261E' },
	desconhece: { label: 'Desconhece', cor: '#8E8E93' },
	baixo_calao: { label: 'Baixo calão', cor: '#A2552B' },
};

export const RADAR_ORDEM = ['cpc_negocio', 'cpc', 'alega_pagamento', 'judicial', 'desconhece', 'baixo_calao'];

/** Situação da campanha → rótulo, cor do texto e fundo do selo. */
export const SIT_CAMPANHA: Record<string, { label: string; cor: string; bg: string }> = {
	analisando: { label: 'Lendo a lista', cor: '#0A60D0', bg: 'rgba(10,96,208,.1)' },
	aguardando_layout: { label: 'Confirme o layout', cor: '#9a631b', bg: '#FFF3E8' },
	pronta: { label: 'Pronta', cor: '#6E6E73', bg: '#F5F5F7' },
	agendada: { label: 'Agendada', cor: '#0A60D0', bg: 'rgba(10,96,208,.1)' },
	em_andamento: { label: 'Enviando', cor: '#0A60D0', bg: 'rgba(10,96,208,.1)' },
	concluida: { label: 'Concluída', cor: '#248A3D', bg: '#E8F8EC' },
	cancelada: { label: 'Cancelada', cor: '#6E6E73', bg: '#F5F5F7' },
	erro: { label: 'Erro', cor: '#FF3B30', bg: '#FFE8E6' },
};

/** Tipo de mídia do template RCS. */
export const TIPO_MIDIA_NOME: Record<string, string> = {
	simples: 'Simples',
	botoes: 'Botões',
	arquivo: 'Arquivo',
	rich_card: 'Rich card',
	carrossel: 'Carrossel',
};

export const CATEGORIA_RCS: { id: string; label: string }[] = [
	{ id: 'autenticacao', label: 'Autenticação' },
	{ id: 'transacional', label: 'Transacional' },
	{ id: 'marketing', label: 'Marketing' },
];

/** Tipo de coluna identificado no layout da campanha. */
export const TIPO_COLUNA_NOME: Record<string, string> = {
	telefone: 'Telefone',
	email: 'E-mail',
	cpf: 'CPF',
	data: 'Data',
	valor: 'Valor',
	numero: 'Número',
	texto: 'Texto',
	vazia: 'Vazia',
};

export const USO_COLUNA: { id: string; label: string }[] = [
	{ id: 'telefone', label: 'Telefone' },
	{ id: 'email', label: 'E-mail' },
	{ id: 'id_cliente', label: 'ID do cliente' },
	{ id: 'variavel', label: 'Variável {{nome}}' },
	{ id: 'ignorar', label: 'Ignorar' },
];

/** Operadores de filtro por tipo de campo (relatórios). */
export const OPERADOR_TIPO: Record<string, { id: string; label: string }[]> = {
	texto: [
		{ id: 'igual', label: 'igual' },
		{ id: 'diferente', label: 'diferente' },
		{ id: 'contem', label: 'contém' },
		{ id: 'em', label: 'está em' },
		{ id: 'vazio', label: 'vazio' },
		{ id: 'preenchido', label: 'preenchido' },
	],
	numero: [
		{ id: 'igual', label: 'igual' },
		{ id: 'maior', label: 'maior que' },
		{ id: 'menor', label: 'menor que' },
	],
	data: [
		{ id: 'igual', label: 'igual' },
		{ id: 'maior', label: 'maior que' },
		{ id: 'menor', label: 'menor que' },
	],
	booleano: [{ id: 'igual', label: 'Sim/Não' }],
};

export const PERIODO_OPCOES = [
	{ id: 'hoje', label: 'Hoje' },
	{ id: '7d', label: '7 dias' },
	{ id: '30d', label: '30 dias' },
	{ id: 'mes_atual', label: 'Mês atual' },
	{ id: 'mes_anterior', label: 'Mês anterior' },
	{ id: 'personalizado', label: 'Personalizado' },
];

/** Calcula o intervalo de datas (ISO AAAA-MM-DD) de um período. */
export function periodoDatas(periodo: string, customDe?: string, customAte?: string): { de: string; ate: string } {
	const fmt = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
	const hoje = new Date();
	const ate = fmt(hoje);
	let de = ate;
	switch (periodo) {
		case '7d': { const d = new Date(hoje); d.setDate(d.getDate() - 6); de = fmt(d); break; }
		case '30d': { const d = new Date(hoje); d.setDate(d.getDate() - 29); de = fmt(d); break; }
		case 'mes_atual': { de = fmt(new Date(hoje.getFullYear(), hoje.getMonth(), 1)); break; }
		case 'mes_anterior': { const ini = new Date(hoje.getFullYear(), hoje.getMonth() - 1, 1); const fim = new Date(hoje.getFullYear(), hoje.getMonth(), 0); de = fmt(ini); return { de, ate: fmt(fim) }; }
		case 'personalizado': return { de: customDe ?? ate, ate: customAte ?? ate };
		default: de = ate; // hoje
	}
	return { de, ate };
}

/** Aba de lista de contato. */
export const TIPO_LISTA: Record<string, { label: string; descricao: string }> = {
	bloqueio: { label: 'Bloqueio', descricao: 'Suspeitos e números que nunca devem receber mensagem.' },
	favoritos: { label: 'Favoritos', descricao: 'Passam direto pela validação de formato e de operadora (descadastro e bloqueio continuam valendo). Use para números da sua equipe e de teste.' },
};

/** Máscara simples de telefone/e-mail: mostra só os últimos dígitos. */
export function mascararDestino(destino: string): string {
	if (!destino) return '—';
	const s = destino.trim();
	if (s.includes('@')) {
		const [u, d] = s.split('@');
		return `${u.slice(0, 2)}•••@${d}`;
	}
	const digits = s.replace(/\D/g, '');
	if (digits.length <= 4) return '••••';
	return `•••• ${digits.slice(-4)}`;
}

/** Formata número com separador de milhar pt-BR. */
export function num(v: unknown): string {
	return Number(v ?? 0).toLocaleString('pt-BR');
}

/** Formata percentual: 1 casa decimal (2 casas abaixo de 1%); total 0 → "—". */
export function pct(v: number, total: number): string {
	if (!total) return '—';
	const p = (v / total) * 100;
	const dec = p < 1 ? 2 : 1;
	return `${p.toLocaleString('pt-BR', { minimumFractionDigits: dec, maximumFractionDigits: dec })}%`;
}

/** Preço unitário para o cliente: abaixo de R$ 0,10 aparece por mil
 *  ("R$ 4,20 por mil números"); caso contrário, valor normal com 2 casas.
 *  O Console e o banco continuam com 4 casas. */
export function precoCliente(v: number, unidade = 'números'): string {
	const n = Number(v ?? 0);
	if (n > 0 && n < 0.1) {
		const porMil = (n * 1000).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
		return `R$ ${porMil} por mil ${unidade}`;
	}
	return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Tipo do histórico de formação do Score (rpc score_formacao). */
export type ScoreFormacao = {
	inicio: string;
	janela_dias: number;
	completa_em: string;
	completa: boolean;
};
