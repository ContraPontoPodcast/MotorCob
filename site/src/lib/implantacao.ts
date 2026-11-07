// Assistente de implantação (SQL 74): regras puras da tela (sem React), testadas em implantacao.test.tsx.
// O estado vem do banco numa leitura (implantacao_situacao); aqui só se classifica em verde, âmbar e vermelho.
import { faltam as faltamColunas, mensagemFaltam, type ColunasCarga, type Falta } from './mapeamento-carga';

export type QuemEnvia = 'lista' | 'motorcx' | 'desligado';
export type CanalAssistente = 'whatsapp' | 'sms' | 'email' | 'rcs' | 'discador' | 'agente_voz';
export type Aprovacao = 'todo_dia' | 'primeiro' | 'automatico';

export type Situacao = {
	hoje: string;
	empresa: { id: number | string; nome: string; slug: string; razao_social?: string | null; situacao: string; criada_em?: string };
	progresso: { passo: number; feitos: number[] };
	preco: { preco: number; minimo: number; modelo: string } | null;
	admin: { id?: string | null; convidado: boolean; entrou: boolean; nome?: string | null; email?: string | null };
	recebe_fatura: boolean;
	contatos: { id: number; nome: string; email: string | null; recebe_faturas: boolean }[];
	carteira: { id: number | string; codigo: string; nome: string; entrada_carga: string } | null;
	carteiras: number;
	carga: { id: number; tipo: string; status: string; arquivo: string; enviado_em: string; relatorio: Record<string, unknown> | null } | null;
	mapeamento: { colunas: ColunasCarga | null; confirmado: boolean; cabecalho: string[] | null; sugerido: ColunasCarga | null; arquivo: string | null; visto_em: string | null } | null;
	execucao: { data: string; status: string; terminada_em: string | null; erro: string | null; clientes: number | null; na_carga: number | null; contatos: Record<string, number> | null; fila: Record<string, number> | null; sem_acao: Record<string, number> | null } | null;
	lista: { data: string; acoes: number; clientes: number; por_canal: Record<string, number> | null } | null;
	canais: Partial<Record<CanalAssistente, { ativo: boolean; quem_envia: 'lista' | 'motorcx' | null }>>;
	mensageria: { contratada: boolean; canais: string[]; modo: string | null; aprovar_lotes: boolean | null; aprovar_primeiro: boolean | null; pedido_aberto: boolean };
	agente_voz: boolean;
	frases_sms: string[];
	ocorrencia_mapeada: boolean;
	equipe_convidada: boolean;
	estrategias: number;
	previa: { competencia: string; cpfs: number; preco: number; valor: number } | null;
};

export const PASSOS = [
	{ n: 1, titulo: 'Empresa e contrato', sub: 'Preço por CPF ativo', quem: 'equipe' as const },
	{ n: 2, titulo: 'Carteira', sub: 'Usa a Carteira principal', quem: 'cliente' as const },
	{ n: 3, titulo: 'Primeira carga', sub: 'Colunas conferidas antes', quem: 'cliente' as const },
	{ n: 4, titulo: 'Como acionar', sub: 'Régua padrão e canais', quem: 'cliente' as const },
	{ n: 5, titulo: 'Pronto para rodar', sub: 'O que falta', quem: null },
];

/** Canais do passo 4, na ordem do protótipo, com o padrão (decisão do dono: SMS e e-mail em lista para baixar). */
export const CANAIS_ASSISTENTE: { id: CanalAssistente; nome: string; padrao: QuemEnvia; obs: string; voz?: boolean }[] = [
	{ id: 'whatsapp', nome: 'WhatsApp', padrao: 'lista', obs: 'Lista do dia em arquivo ou pela API' },
	{ id: 'sms', nome: 'SMS', padrao: 'lista', obs: 'Frases padrão prontas' },
	{ id: 'email', nome: 'E-mail', padrao: 'lista', obs: 'Acompanha o SMS' },
	{ id: 'rcs', nome: 'RCS', padrao: 'desligado', obs: 'Sem RCS, vai SMS' },
	{ id: 'discador', nome: 'Discador', padrao: 'desligado', obs: 'Lista do discador na Lista do dia', voz: true },
	{ id: 'agente_voz', nome: 'Agente virtual', padrao: 'desligado', obs: 'Precisa do agente virtual contratado', voz: true },
];

export const ROTULO_QUEM: Record<QuemEnvia, string> = { lista: 'Lista para baixar (seu fornecedor)', motorcx: 'MotorCX envia', desligado: 'Desligado' };

/** Quem envia hoje cada canal (o salvo; sem nada salvo, o padrão do assistente). */
export function quemEnviaAtual(s: Pick<Situacao, 'canais'> | null, canal: CanalAssistente, padrao: QuemEnvia): QuemEnvia {
	const c = s?.canais?.[canal];
	if (!c) return padrao;
	if (!c.ativo) return 'desligado';
	return c.quem_envia === 'motorcx' ? 'motorcx' : 'lista';
}

/** A MotorCX só envia o canal que a Mensageria contratada cobre (e nunca voz por aqui). */
export function podeMotorcx(s: Pick<Situacao, 'mensageria'> | null, canal: CanalAssistente): boolean {
	if (canal === 'discador' || canal === 'agente_voz') return false;
	return !!s?.mensageria?.contratada && (s.mensageria.canais ?? []).includes(canal);
}

/** Frases padrão do SMS por etapa (editáveis no passo 4; viram frases "Padrão MotorCX · <etapa>"). Sem dado pessoal. */
export const FRASES_PADRAO_SMS: { estagio: 'localizacao' | 'cpa' | 'preventivo' | 'quebra'; etapa: string; texto: (empresa: string) => string }[] = [
	{ estagio: 'localizacao', etapa: 'Cliente novo', texto: e => `${e}: temos uma condição especial para o seu débito de {saldo}. Responda este SMS ou fale conosco.` },
	{ estagio: 'cpa', etapa: 'Deu CPC', texto: e => `${e}: como combinado, seu débito de {saldo} tem condições à vista e parcelado. Responda para fechar.` },
	{ estagio: 'preventivo', etapa: 'Acordo · antes do vencimento', texto: e => `${e}: lembrete, sua parcela de {valor_parcela} vence em {vencimento}. Mantenha seu acordo em dia.` },
	{ estagio: 'quebra', etapa: 'Acordo · parcela vencida', texto: e => `${e}: a parcela de {valor_parcela} venceu em {vencimento}. Regularize e mantenha seu acordo.` },
];

/** Régua padrão MotorCX (Playbook), uma linha por etapa: o que o motor faz sem estratégia. */
export const REGUA_PADRAO: { etapa: string; sub: string; passos: { canal: CanalAssistente; texto: string }[] }[] = [
	{ etapa: 'Cliente novo', sub: 'localizar o cliente', passos: [{ canal: 'whatsapp', texto: 'D+1 WhatsApp' }, { canal: 'rcs', texto: 'D+3 RCS' }, { canal: 'agente_voz', texto: 'D+5 voz' }, { canal: 'sms', texto: 'D+7 SMS + e-mail' }] },
	{ etapa: 'Deu CPC', sub: 'negociar no canal que respondeu', passos: [{ canal: 'whatsapp', texto: 'mesmo canal · até 3 vezes' }, { canal: 'sms', texto: 'depois o próximo canal' }] },
	{ etapa: 'Acordo', sub: 'lembrar antes de vencer', passos: [{ canal: 'rcs', texto: 'D-3 RCS (SMS se sem RCS)' }, { canal: 'whatsapp', texto: 'D-1 e D0 WhatsApp' }] },
	{ etapa: 'Quebra', sub: 'parcela venceu sem pagamento', passos: [{ canal: 'whatsapp', texto: 'D+1 WhatsApp' }, { canal: 'discador', texto: 'D+3 discador' }, { canal: 'sms', texto: 'D+5 SMS' }] },
];

// Feriados nacionais = regras/regua.json › janela.feriados (o teste confere que são os mesmos).
export const FERIADOS = ['2026-01-01', '2026-04-03', '2026-04-21', '2026-05-01', '2026-09-07', '2026-10-12', '2026-11-02', '2026-11-15', '2026-11-20', '2026-12-25', '2027-01-01', '2027-03-26', '2027-04-21', '2027-05-01', '2027-09-07', '2027-10-12', '2027-11-02', '2027-11-15', '2027-11-20', '2027-12-25'];

const DIAS = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];

function somarDia(iso: string, n: number): string {
	const d = new Date(`${iso}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10);
}
export function diaComLista(iso: string): boolean {
	return new Date(`${iso}T12:00:00Z`).getUTCDay() !== 0 && !FERIADOS.includes(iso);
}
function diaBR(iso: string): string { const [a, m, d] = iso.split('-'); void a; return `${d}/${m}`; }

/** Quando sai a próxima Lista do dia. A rotina roda minutos depois de cada carga e todo dia útil às 06:00 (domingo e
 *  feriado não têm ação). Nunca "às 6h da manhã seguinte" para a 1ª carga (era o texto errado, B7). */
export function proximaLista(s: Pick<Situacao, 'hoje' | 'carga' | 'lista'>): string {
	const hoje = s.hoje;
	if (s.carga && (s.carga.status === 'pendente')) return 'minutos depois da carga (a rotina já está na fila)';
	if (!s.carga) return 'minutos depois da primeira carga; depois, todo dia às 06:00';
	if (s.carga.status === 'aguardando') return 'minutos depois de apontar as colunas que faltam';
	let d = somarDia(hoje, 1);
	for (let i = 0; i < 10 && !diaComLista(d); i++) d = somarDia(d, 1);
	const quando = d === somarDia(hoje, 1) ? 'amanhã' : DIAS[new Date(`${d}T12:00:00Z`).getUTCDay()];
	return `${quando}, ${diaBR(d)}, às 06:00 (domingo e feriado não têm ação)`;
}

export type Estado = 'ok' | 'atencao' | 'bloqueia' | 'info';
export type Acao = { rotulo: string; to?: string; passo?: number; fazer?: 'contato_fatura' | 'reenviar_convite' };
export type Item = { id: string; titulo: string; detalhe: string; estado: Estado; acao?: Acao; equipe?: boolean };
export type Grupo = { titulo: string; itens: Item[] };

const moeda = (v: number | null | undefined, casas = 2) => (v == null ? '—' : Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: casas, maximumFractionDigits: Math.max(casas, 2) }));
const num = (v: number | null | undefined) => (v == null ? '—' : Number(v).toLocaleString('pt-BR'));
const NOME_CANAL: Record<string, string> = { whatsapp: 'WhatsApp', sms: 'SMS', email: 'E-mail', rcs: 'RCS', discador: 'Discador', agente_voz: 'Agente virtual' };

/** Carga em palavras simples (passo 3 e checklist). */
export function resumoCarga(s: Situacao): { estado: Estado; titulo: string; detalhe: string; faltam: Falta[] } {
	const c = s.carga;
	if (!c) return { estado: 'bloqueia', titulo: 'Ainda não chegou a primeira carga', detalhe: 'Envie a carteira do jeito que o credor manda.', faltam: [] };
	if (c.status === 'aguardando') {
		const rel = (c.relatorio ?? {}) as { faltam?: Falta[]; aguardando?: string };
		const f = rel.faltam ?? faltamColunas(s.mapeamento?.colunas ?? s.mapeamento?.sugerido ?? {});
		return { estado: 'bloqueia', titulo: mensagemFaltam(f) || 'A carga espera as colunas', detalhe: 'O arquivo está guardado: ele entra assim que você apontar as colunas.', faltam: f };
	}
	if (c.status === 'pendente') return { estado: 'atencao', titulo: 'Carga recebida: processando', detalhe: 'A rotina roda em poucos minutos. Esta tela atualiza sozinha.', faltam: [] };
	if (c.status === 'erro') {
		const erro = String((c.relatorio as { erro?: string } | null)?.erro ?? 'A carga voltou com erro.');
		return { estado: 'bloqueia', titulo: 'A carga voltou com erro', detalhe: erro, faltam: [] };
	}
	const e = s.execucao;
	const clientes = e?.na_carga ?? (c.relatorio as { na_carga?: number } | null)?.na_carga ?? null;
	return { estado: 'ok', titulo: 'Carga processada', detalhe: `${s.carteira?.nome ?? 'Carteira'} · ${num(clientes)} clientes em cobrança`, faltam: [] };
}

/** Clientes com algum contato para acionar (na carga − sem contato válido). */
export function comContato(s: Situacao): { total: number; com: number; pct: number } | null {
	const e = s.execucao;
	if (!e || e.na_carga == null) return null;
	const sem = Number(e.sem_acao?.sem_contato ?? 0);
	const total = Number(e.na_carga);
	const com = Math.max(0, total - sem);
	return { total, com, pct: total ? Math.round((com / total) * 100) : 0 };
}

/** A lista "O que falta para rodar": cada linha vem do banco (ninguém marca à mão). */
export function checklist(s: Situacao, opts: { equipe: boolean }): Grupo[] {
	const grupos: Grupo[] = [];
	const rodar: Item[] = [];
	rodar.push(s.preco
		? { id: 'preco', titulo: 'Empresa criada e preço por CPF ativo', detalhe: `${moeda(s.preco.preco)} por CPF${Number(s.preco.minimo) > 0 ? ` · mínimo ${moeda(s.preco.minimo)}` : ''}`, estado: 'ok' }
		: { id: 'preco', titulo: 'Preço da Orquestração por CPF ativo', detalhe: 'Sem preço, a fatura do mês não sai. Quem define é a equipe MotorCX.', estado: 'bloqueia', equipe: true, acao: opts.equipe ? { rotulo: 'Definir preço', to: '/empresa/contratacao' } : undefined });
	const rc = resumoCarga(s);
	rodar.push({ id: 'carga', titulo: rc.estado === 'ok' ? 'Carteira com carga processada' : rc.titulo, detalhe: rc.estado === 'ok' ? `${rc.detalhe}${s.execucao?.terminada_em ? ` · ${new Date(s.execucao.terminada_em).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}` : ''}` : rc.detalhe, estado: rc.estado, acao: rc.estado === 'ok' ? undefined : { rotulo: rc.faltam.length ? 'Apontar colunas' : 'Abrir a carga', passo: 3 } });
	const cc = comContato(s);
	if (cc) rodar.push(cc.com > 0
		? { id: 'contatos', titulo: 'Contatos para acionar', detalhe: `${cc.pct}% dos clientes têm telefone ou e-mail válido`, estado: cc.pct >= 50 ? 'ok' : 'atencao' }
		: { id: 'contatos', titulo: 'Nenhum cliente com contato válido', detalhe: 'Confira as colunas de telefone e e-mail da carga.', estado: 'bloqueia', acao: { rotulo: 'Conferir colunas', passo: 3 } });
	const ligados = CANAIS_ASSISTENTE.filter(c => quemEnviaAtual(s, c.id, c.padrao) !== 'desligado');
	rodar.push(ligados.length
		? { id: 'canais', titulo: 'Canais e régua', detalhe: `${s.estrategias > 0 ? 'Régua própria (Orquestração)' : 'Régua padrão MotorCX'} · ${ligados.map(c => `${c.nome} ${quemEnviaAtual(s, c.id, c.padrao) === 'motorcx' ? 'pela MotorCX' : 'em lista'}`).join(' · ')}`, estado: 'ok' }
		: { id: 'canais', titulo: 'Nenhum canal ligado', detalhe: 'Ligue ao menos um canal para a Lista do dia ter ações.', estado: 'bloqueia', acao: { rotulo: 'Escolher canais', passo: 4 } });
	grupos.push({ titulo: 'Para rodar', itens: rodar });

	const motorcx = CANAIS_ASSISTENTE.filter(c => quemEnviaAtual(s, c.id, c.padrao) === 'motorcx');
	if (motorcx.length) {
		const msg: Item[] = [];
		if (motorcx.some(c => c.id === 'sms')) {
			const tem = FRASES_PADRAO_SMS.filter(f => s.frases_sms.includes(f.estagio)).length;
			msg.push({ id: 'frases', titulo: 'Frases do SMS em todas as etapas', detalhe: `${tem} de ${FRASES_PADRAO_SMS.length} etapas com frase`, estado: tem === FRASES_PADRAO_SMS.length ? 'ok' : 'bloqueia', acao: tem === FRASES_PADRAO_SMS.length ? undefined : { rotulo: 'Usar as frases padrão', passo: 4 } });
		}
		const real = s.mensageria.modo === 'real';
		msg.push(real
			? { id: 'real', titulo: `Envio real ${motorcx.map(c => c.nome === 'E-mail' ? 'do e-mail' : `do ${c.nome}`).join(' e ')}`, detalhe: 'Ligado: as mensagens chegam aos clientes.', estado: 'ok' }
			: { id: 'real', titulo: `Envio real ${motorcx.map(c => c.nome === 'E-mail' ? 'do e-mail' : `do ${c.nome}`).join(' e ')}`, detalhe: 'Hoje os lotes saem em simulação: nada chega aos clientes. Quem liga é a equipe MotorCX.', estado: 'bloqueia', equipe: true, acao: opts.equipe ? { rotulo: 'Ligar envio real', to: '/console/implantacao' } : s.mensageria.pedido_aberto ? undefined : { rotulo: 'Pedir envio real', to: `/mensageria/${motorcx[0].id}` } });
		const aprova = s.mensageria.aprovar_lotes !== false && !s.mensageria.aprovar_primeiro;
		msg.push({ id: 'aprovacao', titulo: 'Aprovação dos lotes', detalhe: s.mensageria.aprovar_lotes === false ? 'Automática: os lotes saem sozinhos.' : s.mensageria.aprovar_primeiro ? 'Aprovar só o primeiro lote; depois, automático.' : 'Todo dia o lote espera alguém aprovar: parece que o canal não envia.', estado: aprova ? 'atencao' : 'ok', acao: aprova ? { rotulo: 'Mudar', passo: 4 } : undefined });
		grupos.push({ titulo: 'Para as mensagens saírem', itens: msg });
	}
	const listas = CANAIS_ASSISTENTE.filter(c => quemEnviaAtual(s, c.id, c.padrao) === 'lista');
	if (listas.length) grupos.push({ titulo: 'Listas para o seu fornecedor', itens: listas.map(c => ({ id: `lista_${c.id}`, titulo: `Lista do ${c.nome === 'E-mail' ? 'e-mail' : c.nome}`, detalhe: `Arquivo ${c.id}.csv todo dia útil às 06:00 (e minutos depois de cada carga) · baixar na Lista do dia ou pela API`, estado: 'ok' as Estado, acao: s.lista ? { rotulo: 'Abrir a Lista do dia', to: '/fila' } : undefined })) });

	const fat: Item[] = [];
	fat.push(s.recebe_fatura
		? { id: 'fatura', titulo: 'Quem recebe a fatura', detalhe: s.contatos.filter(c => c.recebe_faturas).map(c => c.email).filter(Boolean).join(', ') || 'Definido', estado: 'ok' }
		: { id: 'fatura', titulo: 'Quem recebe a fatura', detalhe: 'Sem esse contato, a fatura do mês não tem para quem ir.', estado: 'atencao', acao: { rotulo: 'Salvar', fazer: 'contato_fatura' } });
	fat.push(s.admin.entrou
		? { id: 'admin', titulo: 'Admin da empresa entrou', detalhe: s.admin.nome ?? 'Admin', estado: 'ok' }
		: { id: 'admin', titulo: 'Admin da empresa ainda não entrou', detalhe: s.admin.convidado ? 'O convite foi enviado; o link vale por alguns dias.' : 'O convite ainda não saiu.', estado: 'atencao', acao: opts.equipe ? { rotulo: 'Reenviar convite', fazer: 'reenviar_convite' } : undefined });
	grupos.push({ titulo: 'Para a fatura', itens: fat });

	grupos.push({ titulo: 'Pode ficar para depois', itens: [
		{ id: 'ocorrencia', titulo: 'Arquivo de ocorrência', detalhe: s.ocorrencia_mapeada ? 'Colunas conferidas.' : 'Sem ele o motor não aprende quem deu CPC fora dos nossos canais. Quando o primeiro chegar, conferimos as colunas com você.', estado: s.ocorrencia_mapeada ? 'ok' : 'info', acao: s.ocorrencia_mapeada ? undefined : { rotulo: 'Enviar agora', to: '/envios' } },
		{ id: 'equipe', titulo: 'Convidar a equipe', detalhe: 'Planejamento, Operação e Gestão', estado: s.equipe_convidada ? 'ok' : 'info', acao: s.equipe_convidada ? undefined : { rotulo: 'Convidar', to: '/empresa/pessoas?aba=pessoas' } },
		{ id: 'orquestracao', titulo: 'Personalizar a régua, segmentos e personas', detalhe: 'Na Orquestração, quando houver uma semana de resultado.', estado: 'info', acao: { rotulo: 'Abrir', to: '/orquestracao' } },
	] });
	return grupos;
}

/** Frase do topo do passo 5. */
export function heroi(grupos: Grupo[]): string {
	const rodar = grupos.find(g => g.titulo === 'Para rodar')?.itens.filter(i => i.estado === 'bloqueia').length ?? 0;
	const msg = grupos.find(g => g.titulo === 'Para as mensagens saírem')?.itens.filter(i => i.estado === 'bloqueia').length ?? 0;
	const coisa = (n: number) => `${n} coisa${n > 1 ? 's' : ''}`;
	if (rodar) return `Falta ${coisa(rodar)} para a Orquestração rodar.`;
	if (msg) return `A Orquestração já está rodando. Falta ${coisa(msg)} para as mensagens saírem de verdade.`;
	return 'Tudo pronto: a Orquestração está rodando.';
}

/** Em que passo abrir: onde a pessoa parou (salvo no banco), sem passar do primeiro passo que ainda falta. */
export function passoInicial(s: Situacao | null): number {
	if (!s) return 1;
	const feitos = passosFeitos(s);
	const primeiro = [2, 3, 4].find(p => !feitos.has(p)) ?? 5;
	return Math.max(2, Math.min(primeiro, s.progresso?.passo || primeiro));
}

/** Passos concluídos (para a barra do lado): 1 sempre que a empresa existe; 3 quando a carga foi processada. */
export function passosFeitos(s: Situacao | null): Set<number> {
	const f = new Set<number>(s?.progresso?.feitos ?? []);
	if (s) f.add(1);
	if (s?.carga?.status === 'processado') f.add(3);
	if (s && f.has(2) && f.has(3) && f.has(4)) {
		const g = checklist(s, { equipe: false });
		if (!g.find(x => x.titulo === 'Para rodar')?.itens.some(i => i.estado === 'bloqueia')) f.add(5);
	}
	return f;
}

/** Fatura prevista do mês: CPFs ativos × preço (o mínimo, se houver, entra na prévia do banco). */
export function textoPrevia(s: Situacao): { cpfs: string; valor: string; conta: string } | null {
	if (!s.previa || !s.preco) return null;
	return { cpfs: num(s.previa.cpfs), valor: moeda(s.previa.valor), conta: `${num(s.previa.cpfs)} × ${moeda(s.preco.preco)}${Number(s.preco.minimo) > 0 ? ` (mínimo ${moeda(s.preco.minimo)})` : ''}` };
}

export { NOME_CANAL };
