// Tipos, rótulos e helpers da Mensageria.
// O site NÃO envia mensagens: só acompanha e decide (aprovar, pausar, retomar, cancelar).
// O banco só guarda o destino mascarado — nunca telefone ou e-mail completo.

export type MensageriaModo = 'simulado' | 'real';

export type LoteMensageria = {
	id: string;
	empresa_id: string;
	data: string;
	canal: string;
	credor_nome?: string | null;
	situacao: string;
	janela_inicio: string | null;
	janela_fim: string | null;
	total: number;
	enviadas: number;
	entregues: number;
	falhas: number;
	descadastros: number;
	respostas: number;
	bloqueadas: number;
	motivo?: string | null;
};

export type MensagemMensageria = {
	id: string;
	id_cliente: string;
	destino_mascara: string;
	situacao: string;
	motivo: string | null;
	fornecedor: string | null;
	tentativas: number;
	enviado_em: string | null;
	item: string | null;
	operadora: string | null;
	respondida_em: string | null;
};

export type DescadastroMensageria = {
	id: string;
	empresa_id: string;
	destino_mascara: string;
	canal: string;
	origem: string;
	criado_em: string;
};

export type ModeloEmail = {
	empresa_id: string;
	nome_remetente: string;
	assunto: string;
	texto: string;
};

/** Situação do lote → rótulo, cor do texto e fundo do selo. */
export const SIT_LOTE: Record<string, { label: string; cor: string; bg: string }> = {
	aguardando_aprovacao: { label: 'Aguardando aprovação', cor: '#9a631b', bg: '#FFF3E8' },
	agendado: { label: 'Agendado', cor: '#6E6E73', bg: '#F5F5F7' },
	enviando: { label: 'Enviando', cor: '#0A60D0', bg: 'rgba(10,96,208,.1)' },
	pausado: { label: 'Pausado', cor: '#6E6E73', bg: '#F5F5F7' },
	concluido: { label: 'Concluído', cor: '#248A3D', bg: '#E8F8EC' },
	cancelado: { label: 'Cancelado', cor: '#FF3B30', bg: '#FFE8E6' },
};

/** Situação da mensagem → rótulo. */
export const SIT_MSG: Record<string, string> = {
	pendente: 'Pendente',
	enviada: 'Enviada',
	entregue: 'Entregue',
	falhou: 'Não entregue',
	descadastro: 'Descadastrou',
	bloqueada: 'Bloqueada',
};

/** Origem do descadastro → rótulo. */
export const ORIGEM_DESCADASTRO: Record<string, string> = {
	resposta: 'Respondeu SAIR',
	link: 'Link de descadastro',
	manual: 'Manual',
	reclamacao: 'Reclamação',
};

/** Cor da pílula do canal. */
export const CANAL_COR: Record<string, string> = {
	sms: '#7A4FB0',
	email: '#A2552B',
	rcs: '#3B5BA9',
	whatsapp: '#1F8A4C',
};

/** Nome curto do canal. */
export const CANAL_NOME: Record<string, string> = {
	sms: 'SMS',
	email: 'E-mail',
	rcs: 'RCS',
	whatsapp: 'WhatsApp',
};

/** Canais oferecidos no descadastro manual. */
export const CANAIS_DESCADASTRO = [
	{ id: 'sms', label: 'SMS' },
	{ id: 'email', label: 'E-mail' },
	{ id: 'rcs', label: 'RCS' },
	{ id: 'whatsapp', label: 'WhatsApp' },
];

/** Rótulo do item (tipo) de mensagem. */
export const ITEM_NOME: Record<string, string> = {
	sms: 'SMS',
	email: 'E-mail',
	rcs_basic: 'RCS Basic',
	rcs_single: 'RCS Single',
	rcs_conversacional: 'RCS Conversacional',
	rcs_sessao: 'Na sessão (sem custo)',
};

/** Rótulo da operadora (SMS). */
export const OPERADORA_NOME: Record<string, string> = {
	vivo: 'Vivo',
	claro: 'Claro',
	tim: 'TIM',
	oi: 'Oi',
	outras: 'Outras',
	invalido: 'Número inválido',
};

/** Hora atual (HH:MM) no fuso de São Paulo. */
export const agoraSP = () =>
	new Intl.DateTimeFormat('en-GB', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date());

/** Exporta um CSV no navegador (BOM UTF-8). Nunca inclui contato completo. */
export function exportarCsv(nome: string, cabecalho: string[], linhas: (string | number | null)[][]) {
	const esc = (v: unknown) => {
		const s = String(v ?? '');
		return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
	};
	const csv = [cabecalho, ...linhas].map((l) => l.map(esc).join(';')).join('\r\n');
	const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8;' });
	const url = URL.createObjectURL(blob);
	const a = document.createElement('a');
	a.href = url;
	a.download = nome;
	document.body.appendChild(a);
	a.click();
	a.remove();
	window.setTimeout(() => URL.revokeObjectURL(url), 60000);
}
