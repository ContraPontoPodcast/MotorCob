// Constantes da operação MotorCob — nomes usados em todo o site.

/** Nome do estado da TAG na linguagem da operação (página Cliente, etc.). */
export const estadoNome: Record<string, string> = {
	LOC: 'Não localizado',
	NCP: 'Não localizado',
	CPA: 'CPC A',
	CPB: 'CPC B',
	PRE: 'Acordo',
	COL: 'Acordo',
	QBR: 'Acordo',
	LIQ: 'Liquidado',
	BLQ: 'Bloqueado',
};

/** Nome curto do estado para o Mapa da Esteira. */
export const mapaNome: Record<string, string> = {
	LOC: 'Novo · localizando',
	NCP: 'Não CPC',
	CPA: 'CPC A',
	CPB: 'CPC B',
	PRE: 'Preventivo',
	COL: 'Acordo em dia',
	QBR: 'Quebra',
	LIQ: 'Liquidado',
	BLQ: 'Bloqueado',
};

/** Subtítulo de cada caixa do mapa. */
export const mapaSubtitulo: Record<string, string> = {
	LOC: 'Localizando',
	NCP: 'Giro',
	CPA: 'Negociação',
	CPB: 'Tentativas',
	COL: 'Acordo em dia',
	PRE: 'Antes do vencimento',
	QBR: 'Parcela vencida',
	LIQ: 'Quitado',
	BLQ: 'Opt-out / óbito',
};

/** Ordem natural dos estados no mapa (esquerda → direita). */
export const mapaOrdem: string[] = ['LOC', 'NCP', 'CPA', 'CPB', 'COL', 'PRE', 'QBR', 'LIQ', 'BLQ'];

/** Estados que pertencem ao grupo "Acordo" (após a linha tracejada). */
export const grupoAcordo: Set<string> = new Set(['COL', 'PRE', 'QBR']);

/** Funil de 4 blocos do Início (somando estados de ultima_execucao.resumo.estados). */
export const funilGrupos = [
	{ id: 'nao_localizado', label: 'Não localizado', estados: ['LOC', 'NCP'] },
	{ id: 'cpc_a', label: 'CPC A', estados: ['CPA'] },
	{ id: 'cpc_b', label: 'CPC B', estados: ['CPB'] },
	{ id: 'acordo', label: 'Acordo', estados: ['PRE', 'COL', 'QBR'] },
];

/** Estados menores ao lado do funil. */
export const funilLaterais = [
	{ id: 'LIQ', label: 'Liquidado' },
	{ id: 'BLQ', label: 'Bloqueado' },
];

/** Chips de status dos contatos (resumo.contatos). */
export const contatoStatusList = [
	{ id: 'HOT', label: 'Contato principal', className: 'bg-[#2E7D32] text-white' },
	{ id: 'WHATSAPP', label: 'WhatsApp', className: 'bg-[#eaf2f3] text-[#0F4C5C]' },
	{ id: 'RCS', label: 'RCS', className: 'bg-[#eaf2f3] text-[#0F4C5C]' },
	{ id: 'NEUTRO', label: 'Neutro', className: 'bg-[#eaf2f3] text-[#0F4C5C]' },
	{ id: 'INVALIDO', label: 'Inválido', className: 'bg-[#C62828] text-white' },
];

/** Mapa de códigos de canal → nome curto. */
export const canalCodigo: Record<string, string> = {
	WA: 'WhatsApp',
	RC: 'RCS',
	AV: 'Agente virtual',
	DC: 'Discador',
	SM: 'SMS',
	EM: 'E-mail',
	ND: 'Nenhum',
};

/** Canais do filtro do mapa (código → label). */
export const mapaCanais = [
	{ id: 'WA', label: 'WhatsApp' },
	{ id: 'RC', label: 'RCS' },
	{ id: 'AV', label: 'Agente virtual' },
	{ id: 'DC', label: 'Discador' },
	{ id: 'SM', label: 'SMS' },
	{ id: 'EM', label: 'E-mail' },
	{ id: 'ND', label: 'Nenhum' },
];

/** Opções de "números por cliente" na Lista do dia e Canais. */
export const numerosPorClienteOpts = [
	{ id: '1', label: '1 (recomendado)' },
	{ id: '2', label: '2' },
	{ id: '3', label: '3' },
	{ id: '99', label: 'Todos' },
];

/** Meses abreviados em português (jan, fev, …). */
export const mesesAbrev = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

/** Rótulos legíveis de estado (rotulo_estado). Texto idêntico ao do banco. */
export const rotuloEstado: Record<string, string> = {
	LOC: 'Cliente novo',
	NCP: 'Não CPC',
	CPA: 'CPC · em negociação',
	CPB: 'CPC · sem resposta',
	PRE: 'Acordo · antes do vencimento',
	COL: 'Acordo em dia',
	QBR: 'Acordo · parcela vencida',
	LIQ: 'Quitado',
	BLQ: 'Bloqueado',
};

/** Rótulo de ciclo (rotulo_ciclo). Texto idêntico ao do banco. */
export function rotuloCiclo(estado: string, ciclo: string): string {
	if (!ciclo) return '';
	if (ciclo === 'RE') return 'Parado · aguarda enriquecimento';
	let m = /^G(\d+)$/i.exec(ciclo);
	if (m) return `${m[1]}º ciclo`;
	m = /^T(\d+)$/i.exec(ciclo);
	if (m) return `${m[1]}ª tentativa`;
	m = /^L(\d+)$/i.exec(ciclo);
	if (m) return `D+${m[1]}`;
	m = /^D(\d+)$/i.exec(ciclo);
	if (m) return `D+${m[1]}`;
	return ciclo;
}

/** Rótulo de passo (rotulo_passo). Texto idêntico ao do banco. */
export function rotuloPasso(passo: string): string {
	if (!passo) return '—';
	const s = passo.trim();
	let m = /^G(\d+)-dia(\d+)$/i.exec(s);
	if (m) return `${m[1]}º ciclo · dia ${m[2]}`;
	m = /^CPC\s*B\b\s*[·\-]?\s*T(\d+)$/i.exec(s);
	if (m) return `CPC · sem resposta · ${m[1]}ª tentativa`;
	m = /^CPC\s*A\b\s*[·\-]?\s*T(\d+)$/i.exec(s);
	if (m) return `CPC · em negociação · ${m[1]}ª tentativa`;
	m = /^(G\d+|T\d+|L\d+|D\d+|RE)$/i.exec(s);
	if (m) return rotuloCiclo('', s);
	return s;
}

/** Converte uma TAG (S260801-A1-CPB-WA-T2) em frase legível. */
export function tagToPhrase(tag: string): string {
	if (!tag) return '—';
	const parts = tag.split(/[-_.|]/);
	const safra = parts.find(x => /^S\d{6}$/.test(x)) ?? '';
	const cluster = parts.find(x => /^[AB][123]$/.test(x)) ?? '';
	const estado = parts.find(x => rotuloEstado[x]) ?? '';
	const canal = parts.find(x => canalCodigo[x]) ?? '';
	const ciclo = parts.find(x => /^(G\d+|T\d+|L\d+|D\d+|RE)$/i.test(x)) ?? '';
	const bits: string[] = [];
	if (estado) bits.push(rotuloEstado[estado] ?? estado);
	if (ciclo) bits.push(`${rotuloCiclo(estado, ciclo)}${canal ? ' no ' + (canalCodigo[canal] ?? canal) : ''}`);
	else if (canal) bits.push(`no ${canalCodigo[canal] ?? canal}`);
	if (cluster) bits.push(`segmento ${cluster}`);
	if (safra) {
		const mm = Number(safra.slice(3, 5));
		const yy = safra.slice(1, 3);
		bits.push(`entrou em ${mesesAbrev[mm - 1] ?? String(mm)}/${yy}`);
	}
	return bits.join(' · ') || tag;
}
