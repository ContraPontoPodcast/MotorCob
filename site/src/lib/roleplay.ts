// Speech Analytics › Roleplay (treino de operadores humanos com cliente simulado). Banco: SQL 90
// (supabase/migrations/20270126000001_treino_operadores.sql). Este arquivo tem só regras e rótulos das telas (sem
// banco): rotas e trilha, filtros da biblioteca, situação de cada pessoa num treino (a mesma conta de
// situacao_treino_operador), "Precisa de ação", indicadores do Painel e a validação do Cadastro para treino.
// Linguagem da monitoria (SPEC §2.5): "Item crítico", "Meta", "Cadastro para treino", "Treinos atribuídos",
// "Cliente simulado(a)", "Tipo de cliente". Os códigos do banco nunca aparecem na tela.
// LGPD: operador só com apelido, equipe e (opcional) o ID do discador; cenário só com ficção.
import { dataBR, textoTemDadoPessoal } from './speech';

// ------------------------------------------------------------------ rotas
export const ROTA_RP = '/speech-analytics/roleplay';
export const ROTA_RP_CENARIOS = `${ROTA_RP}/cenarios`;
export const ROTA_RP_CADASTRO = `${ROTA_RP}/operadores`;
export const rotaCenarioRP = (id: number | string) => `${ROTA_RP_CENARIOS}/${encodeURIComponent(String(id))}`;
export const rotaPessoaRP = (id: number | string) => `${ROTA_RP_CADASTRO}/${encodeURIComponent(String(id))}`;
export const ROTA_RP_NOVO_CENARIO = `${ROTA_RP_CENARIOS}/novo`;
/** Novo a partir dos padrões das ligações (SQL 122): a mesma rota do novo, com ?de=insights. */
export const ROTA_RP_NOVO_INSIGHTS = `${ROTA_RP_NOVO_CENARIO}?de=insights`;
export const ROTA_RP_ATRIBUICOES = `${ROTA_RP}/atribuicoes`;
export const ROTA_RP_ATRIBUIR = `${ROTA_RP}/atribuir`;
/** Evolução (SQL 121): empresa ou equipe (?eq=), no período (?d=). */
export const ROTA_RP_EVOLUCAO = `${ROTA_RP}/evolucao`;
export const rotaAtribuicaoRP = (id: number | string) => `${ROTA_RP_ATRIBUICOES}/${encodeURIComponent(String(id))}`;
/** Sessão de uma pessoa (resultado, "Revisar avaliação", feedback 1:1) e o treino lado a lado (SQL 100). */
export const rotaSessaoRP = (atr: number | string, sessao: number | string) => `${rotaAtribuicaoRP(atr)}/sessoes/${encodeURIComponent(String(sessao))}`;
export const rotaLadoALadoRP = (atr: number | string, op: number | string) => `${rotaAtribuicaoRP(atr)}/lado-a-lado/${encodeURIComponent(String(op))}`;
/** Teste do cenário pela Qualidade e o resultado do teste (nada conta para operador). */
export const rotaTestarRP = (cen: number | string) => `${rotaCenarioRP(cen)}/testar`;
export const rotaTesteRP = (cen: number | string, sessao: number | string) => `${rotaCenarioRP(cen)}/teste/${encodeURIComponent(String(sessao))}`;
/** "Atribuir treino" com quem originou pré-marcado (?cen=&ops=&sug=). */
export function rotaAtribuir(x: { cen?: number | null; ops?: number[]; sug?: number | null } = {}): string {
	const q = new URLSearchParams();
	if (x.cen != null) q.set('cen', String(x.cen));
	if (x.ops?.length) q.set('ops', x.ops.join(','));
	if (x.sug != null) q.set('sug', String(x.sug));
	const s = q.toString();
	return s ? `${ROTA_RP_ATRIBUIR}?${s}` : ROTA_RP_ATRIBUIR;
}
/** Ids da query (?ops=1,2,3): só números, sem repetir, até 200. */
export function idsDaQuery(v: string | null | undefined): number[] {
	const out: number[] = [];
	for (const p of (v ?? '').split(',')) {
		if (/^\d{1,18}$/.test(p.trim()) && !out.includes(Number(p))) out.push(Number(p));
		if (out.length >= 200) break;
	}
	return out;
}

export type SecaoRP = 'painel' | 'cenarios' | 'atribuicoes' | 'evolucao' | 'cadastro';
/** Sub-navegação do Roleplay (SPEC §2.2): Painel, Cenários, Treinos atribuídos, Evolução e Cadastro para treino. */
export const SECOES_RP: readonly { id: SecaoRP; nome: string; to: string }[] = [
	{ id: 'painel', nome: 'Painel', to: ROTA_RP },
	{ id: 'cenarios', nome: 'Cenários', to: ROTA_RP_CENARIOS },
	{ id: 'atribuicoes', nome: 'Treinos atribuídos', to: ROTA_RP_ATRIBUICOES },
	{ id: 'evolucao', nome: 'Evolução', to: ROTA_RP_EVOLUCAO },
	{ id: 'cadastro', nome: 'Cadastro para treino', to: ROTA_RP_CADASTRO },
];

const sem = (p: string) => (p.length > 1 ? p.replace(/\/+$/, '') : p);

/** Seção do Roleplay a que a rota pertence (o detalhe marca a seção-mãe), ou null fora do Roleplay. */
export function secaoRP(pathname: string): SecaoRP | null {
	const p = sem(pathname);
	if (p === ROTA_RP) return 'painel';
	if (p === ROTA_RP_CENARIOS || p.startsWith(`${ROTA_RP_CENARIOS}/`)) return 'cenarios';
	if (p === ROTA_RP_ATRIBUICOES || p.startsWith(`${ROTA_RP_ATRIBUICOES}/`) || p === ROTA_RP_ATRIBUIR) return 'atribuicoes';
	if (p === ROTA_RP_CADASTRO || p.startsWith(`${ROTA_RP_CADASTRO}/`)) return 'cadastro';
	if (p === ROTA_RP_EVOLUCAO) return 'evolucao';
	return null;
}

/** A rota é a própria seção (não um detalhe dela). */
export const ehSecaoRP = (pathname: string) => SECOES_RP.some(s => s.to === sem(pathname));

export type ItemTrilha = { rotulo: string; to?: string };
const DETALHE_PADRAO: Record<string, string> = {
	cenarios: 'Cenário', cadastro: 'Pessoa', atribuicoes: 'Treino', painel: 'Roleplay', novo: 'Novo cenário', atribuir: 'Atribuir treino',
};
/** Trilha clicável: Speech Analytics › Roleplay › Cenários › Já pagou. O último item é a tela atual (sem link).
 *  `detalhe` é o nome da tela de detalhe (cenário, pessoa), quando já carregou. */
export function trilhaRP(pathname: string, detalhe?: string | null, meio?: ItemTrilha | null): ItemTrilha[] {
	const p = sem(pathname);
	const secao = secaoRP(p);
	const itens: ItemTrilha[] = [{ rotulo: 'Speech Analytics', to: '/speech-analytics' }, { rotulo: 'Roleplay', to: ROTA_RP }];
	if (secao && secao !== 'painel') {
		const s = SECOES_RP.find(x => x.id === secao)!;
		itens.push({ rotulo: s.nome, to: s.to });
		if (p !== s.to && meio?.rotulo.trim()) itens.push(meio);
		if (p !== s.to) itens.push({ rotulo: detalhe?.trim() || DETALHE_PADRAO[p === ROTA_RP_NOVO_CENARIO ? 'novo' : p === ROTA_RP_ATRIBUIR ? 'atribuir' : secao] });
	}
	const ult = itens[itens.length - 1];
	itens[itens.length - 1] = { rotulo: ult.rotulo };
	return itens;
}

/** Título da aba do navegador, distinto por tela: "Já pagou · Cenários · Roleplay · MotorCX". */
export function tituloDocumentoRP(pathname: string, detalhe?: string | null, meio?: ItemTrilha | null): string {
	const itens = trilhaRP(pathname, detalhe, meio);
	const partes = (itens.length > 2 ? itens.slice(1) : itens).map(i => i.rotulo).reverse();
	return `${partes.join(' · ')} · MotorCX`;
}

// ------------------------------------------------------------------ rótulos
/** Gravidade do checklist na linguagem da monitoria (no banco continua `bloqueante`). */
export const GRAVIDADE_RP: Record<string, string> = { bloqueante: 'Item crítico', importante: 'Importante', boa_pratica: 'Boa prática' };

/** Tipo de cliente (perfis_treino() do SQL 90). */
export const TIPOS_CLIENTE: Record<string, string> = {
	ja_pagou: 'Diz que já pagou', desempregado_recente: 'Perdeu o emprego ou a renda caiu', contesta_procon: 'Não reconhece e ameaça reclamar',
	idoso_dificuldade: 'Pessoa idosa com dificuldade', irritado: 'Irritado com as ligações', quer_parcelar_muito: 'Quer parcelar além da alçada',
	terceiro_atende: 'Outra pessoa atende', nao_me_ligue: 'Pede para não ligar mais', negocia_rapido: 'Quer resolver rápido',
	quer_supervisor: 'Quer falar com o supervisor', outro: 'Outro',
};

export const OBJECOES_TREINO: Record<string, string> = {
	ja_paguei: 'Diz que já pagou', nao_reconheco: 'Não reconhece a dívida', procon: 'Ameaça reclamar no Procon',
	nao_entendi: 'Não entende os valores', pedir_fora_alcada: 'Pede condição fora da alçada', nao_me_ligue: 'Pede para não ligar mais',
	sem_tempo: 'Diz que não tem tempo', sem_dinheiro: 'Diz que não tem dinheiro', pedir_supervisor: 'Pede o supervisor',
};
/** Rótulo da objeção; código desconhecido vira texto ("quer_por_escrito" → "Quer por escrito"), nunca o código cru. */
export function rotuloObjecao(codigo: string): string {
	if (OBJECOES_TREINO[codigo]) return OBJECOES_TREINO[codigo];
	const t = codigo.replace(/[_:.-]+/g, ' ').trim();
	return t ? t[0].toUpperCase() + t.slice(1) : 'Objeção';
}
export const rotuloTipoCliente = (perfil: string) => TIPOS_CLIENTE[perfil] ?? rotuloObjecao(perfil);

export const FAIXAS_SALDO: Record<string, string> = { ate_1k: 'Até R$ 1 mil', '1k_5k': 'R$ 1 mil a 5 mil', '5k_mais': 'R$ 5 mil ou mais' };

/** Itens do checklist padrão MotorCX v1 (SQL 60): reserva quando a versão em uso não carregou. */
export const ITENS_PADRAO: Record<string, { texto: string; gravidade: string }> = {
	ck_ident: { texto: 'Se identificou (empresa e motivo da ligação)', gravidade: 'importante' },
	ck_cpc: { texto: 'Confirmou a identidade antes de falar valor', gravidade: 'bloqueante' },
	ck_ameaca: { texto: 'Não ameaçou nem constrangeu', gravidade: 'bloqueante' },
	ck_oferta: { texto: 'Ofereceu condição', gravidade: 'importante' },
	ck_canais: { texto: 'Informou os canais de pagamento', gravidade: 'importante' },
	ck_naoligue: { texto: 'Respeitou o "não me ligue"', gravidade: 'bloqueante' },
	ck_terceiro: { texto: 'Não falou da dívida com terceiro', gravidade: 'bloqueante' },
	ck_resumo: { texto: 'Resumiu o combinado antes de encerrar', gravidade: 'boa_pratica' },
};
export type ItemChecklistRP = { texto: string; gravidade: string };
export function itemChecklist(id: string, itens: Record<string, ItemChecklistRP>): ItemChecklistRP {
	return itens[id] ?? ITENS_PADRAO[id] ?? { texto: 'Item do checklist da empresa', gravidade: 'importante' };
}

export type DividaRP = { produto?: string; faixa?: string; dias_atraso?: number; alcada?: { parcelas?: number; desconto_max?: number } };
export function textoAlcada(a: DividaRP['alcada']): string {
	if (!a || (a.parcelas == null && a.desconto_max == null)) return 'Sem alçada definida';
	const p = a.parcelas != null ? (a.parcelas === 1 ? 'só à vista' : `até ${a.parcelas}x`) : null;
	const d = a.desconto_max != null ? (a.desconto_max === 0 ? 'sem desconto' : `desconto até ${a.desconto_max}%`) : null;
	return [p, d].filter(Boolean).join(' · ');
}
export function textoModos(modos: readonly string[]): string {
	const v = modos.includes('voz'), t = modos.includes('texto');
	return v && t ? 'Voz (padrão) ou texto' : v ? 'Só voz' : t ? 'Só texto' : '—';
}
export const textoDuracao = (s: number) => `${Math.round(s / 60)} min`;
export const DIFICULDADE = ['', 'Colabora', 'Pede atenção', 'Insiste e desconfia', 'Difícil', 'Hostil'];

// ------------------------------------------------------------------ biblioteca de cenários
export type CenarioRP = {
	id: number; empresa_id: number | null; base_id: number | null; nome: string; persona_nome: string; perfil: string;
	descricao: string | null; objetivo: string; comportamentos: string[]; frases: string[]; objecoes: { codigo: string; quando?: string }[];
	dificuldade: number; divida: DividaRP; duracao_max_s: number; modos: string[]; itens_foco: string[]; objetivo_cenario: string | null;
	situacao: 'rascunho' | 'publicado' | 'arquivado'; origem: 'padrao' | 'manual' | 'insights'; atualizado_em?: string | null;
	/** cenário gerado de padrões agregados (SQL 122): só códigos e porcentagens, base >= 30 */
	insights?: Record<string, number | string> | null;
};
export const ehPadraoMotorCX = (c: Pick<CenarioRP, 'empresa_id'>) => c.empresa_id == null;

export const FILTROS_CENARIO = [
	{ v: 'todos', n: 'Todos' }, { v: 'mx', n: 'Padrão MotorCX' }, { v: 'emp', n: 'Da empresa' }, { v: 'dif', n: 'Difíceis (3 ou mais)' },
] as const;
export type FiltroCenario = (typeof FILTROS_CENARIO)[number]['v'];
/** `?f=` da URL; valor desconhecido = Todos. */
export function filtroCenario(q: string | null | undefined): FiltroCenario {
	return (FILTROS_CENARIO.find(x => x.v === q)?.v ?? 'todos') as FiltroCenario;
}
/** Lista da biblioteca: os da empresa primeiro, depois o Padrão MotorCX, em ordem alfabética. Arquivado não aparece. */
export function filtrarCenarios<T extends Pick<CenarioRP, 'empresa_id' | 'dificuldade' | 'situacao' | 'nome'>>(lista: T[], f: FiltroCenario): T[] {
	return lista
		.filter(c => c.situacao !== 'arquivado')
		.filter(c => f === 'todos' || (f === 'mx' && c.empresa_id == null) || (f === 'emp' && c.empresa_id != null) || (f === 'dif' && c.dificuldade >= 3))
		.sort((a, b) => Number(a.empresa_id == null) - Number(b.empresa_id == null) || a.nome.localeCompare(b.nome, 'pt-BR'));
}

// ------------------------------------------------------------------ treinos atribuídos e "Precisa de ação"
export type AtribuicaoRP = { id: number; cenario_id: number; prazo: string; nota_minima: number; tentativas: number | null; criado_em: string };
export type PessoaNoTreino = {
	atribuicao_id: number; operador_id: number; situacao: 'pendente' | 'em_andamento' | 'aprovado' | 'abaixo';
	melhor_nota: number | null; tentativas_usadas: number; tentativas_extra: number;
};
export type SessaoRP = {
	id: number; atribuicao_id: number | null; operador_id: number | null; cenario_id: number; origem: string; modo: string;
	situacao: string; inicio: string; duracao_s: number | null; nota: number | null; reprovada: boolean; item_reprovado: string | null;
};
export type LinkRP = { operador_id: number; valido_ate: string; revogado_em: string | null };
export type OperadorRP = { id: number; apelido: string; equipe_id: number | null; operador_ref: string | null; so_treino: boolean; ativo: boolean };
export type EquipeRP = { id: number; nome: string; ativo: boolean };

export type SituacaoPessoa = 'aprovado' | 'precisa_apoio' | 'item_critico' | 'prazo_vencido' | 'abaixo_meta' | 'em_andamento' | 'nao_comecou';
export const SITUACAO_PESSOA: Record<SituacaoPessoa, { nome: string; tom: 'ok' | 'erro' | 'atencao' | 'info' | 'neutro' }> = {
	aprovado: { nome: 'Chegou na meta', tom: 'ok' },
	precisa_apoio: { nome: 'Precisa de apoio', tom: 'erro' },
	item_critico: { nome: 'Item crítico com “não”', tom: 'erro' },
	prazo_vencido: { nome: 'Prazo vencido', tom: 'atencao' },
	abaixo_meta: { nome: 'Ainda não chegou na meta', tom: 'atencao' },
	em_andamento: { nome: 'Treinando', tom: 'info' },
	nao_comecou: { nome: 'Não começou', tom: 'neutro' },
};

/** Última sessão avaliada da pessoa naquele treino (a mais recente). */
export function ultimaAvaliada(sessoes: SessaoRP[], atribuicao: number, operador: number): SessaoRP | null {
	let u: SessaoRP | null = null;
	for (const s of sessoes) {
		if (s.atribuicao_id !== atribuicao || s.operador_id !== operador || s.situacao !== 'avaliada') continue;
		if (!u || s.inicio > u.inicio) u = s;
	}
	return u;
}

/** A mesma ordem de situacao_treino_operador (SQL 90). `hoje` em ISO (Brasília). */
export function situacaoPessoa(a: Pick<AtribuicaoRP, 'prazo' | 'tentativas'>, p: Pick<PessoaNoTreino, 'situacao' | 'tentativas_usadas' | 'tentativas_extra'>, ultima: Pick<SessaoRP, 'reprovada'> | null, hoje: string): SituacaoPessoa {
	if (p.situacao === 'aprovado') return 'aprovado';
	if (a.tentativas != null && p.tentativas_usadas >= a.tentativas + p.tentativas_extra) return 'precisa_apoio';
	if (ultima?.reprovada) return 'item_critico';
	if (a.prazo < hoje) return 'prazo_vencido';
	if (p.tentativas_usadas > 0) return 'abaixo_meta';
	if (p.situacao === 'em_andamento') return 'em_andamento';
	return 'nao_comecou';
}

export type ResumoTreino = { pessoas: number; naMeta: number; pendentes: number[]; media: number | null; situacao: 'concluido' | 'prazo_vencido' | 'andamento' };
export function resumoTreino(a: AtribuicaoRP, pessoas: PessoaNoTreino[], hoje: string): ResumoTreino {
	const ps = pessoas.filter(p => p.atribuicao_id === a.id);
	const naMeta = ps.filter(p => p.situacao === 'aprovado').length;
	const notas = ps.map(p => p.melhor_nota).filter((n): n is number => n != null).map(Number);
	const media = notas.length ? Math.round(notas.reduce((s, n) => s + n, 0) / notas.length) : null;
	const pendentes = ps.filter(p => p.situacao !== 'aprovado').map(p => p.operador_id);
	const situacao = ps.length > 0 && pendentes.length === 0 ? 'concluido' : a.prazo < hoje ? 'prazo_vencido' : 'andamento';
	return { pessoas: ps.length, naMeta, pendentes, media, situacao };
}
export const SITUACAO_TREINO: Record<ResumoTreino['situacao'], { nome: string; tom: 'ok' | 'atencao' | 'info' }> = {
	concluido: { nome: 'Concluído', tom: 'ok' }, prazo_vencido: { nome: 'Prazo vencido', tom: 'atencao' }, andamento: { nome: 'Em andamento', tom: 'info' },
};

/** Link de treino da pessoa: ativo (não revogado e dentro da validade), expirado ou sem link. */
export function estadoLink(links: LinkRP[], operador: number, agora = new Date()): { estado: 'ativo' | 'expirado' | 'sem'; ate: string | null } {
	const l = links.find(x => x.operador_id === operador && !x.revogado_em);
	if (!l) return { estado: 'sem', ate: null };
	return new Date(l.valido_ate).getTime() > agora.getTime() ? { estado: 'ativo', ate: l.valido_ate } : { estado: 'expirado', ate: l.valido_ate };
}

export type ItemAcao = {
	prioridade: 1 | 2 | 3; tipo: 'apoio' | 'critico' | 'prazo' | 'discordancia' | 'link' | 'sugestao'; texto: string; operador_id: number | null; atribuicao_id: number | null;
	/** sugestão de prioridade alta (item crítico repetido nas ligações reais): "Atribuir treino" */
	sugestao_id?: number;
};
export type DadosAcao = {
	atribuicoes: AtribuicaoRP[]; pessoas: PessoaNoTreino[]; sessoes: SessaoRP[]; links: LinkRP[];
	discordancias: { sessao_id: number }[]; operadores: OperadorRP[]; cenarios: Pick<CenarioRP, 'id' | 'nome'>[];
	itens: Record<string, ItemChecklistRP>; hoje: string; agora?: Date;
	/** sugestões novas (SQL 120): a de item crítico repetido entra em "Precisa de ação" */
	sugestoes?: SugestaoRP[];
};
/** "Precisa de ação" do Painel (SPEC §2.3): quem esgotou as tentativas, item crítico com "não", prazo vencido,
 *  discordância do operador sem resposta e link expirado ou ausente de quem tem treino pendente. Mais urgente primeiro. */
export function precisaDeAcao(d: DadosAcao): ItemAcao[] {
	const nomeOp = (id: number) => d.operadores.find(o => o.id === id)?.apelido ?? 'Pessoa sem cadastro';
	const nomeCen = (id: number) => d.cenarios.find(c => c.id === id)?.nome ?? 'Cenário';
	const out: ItemAcao[] = [];
	const comLink = new Set<number>();
	for (const a of d.atribuicoes) {
		const cen = nomeCen(a.cenario_id);
		const ps = d.pessoas.filter(p => p.atribuicao_id === a.id);
		for (const p of ps) {
			const u = ultimaAvaliada(d.sessoes, a.id, p.operador_id);
			const s = situacaoPessoa(a, p, u, d.hoje);
			if (s === 'precisa_apoio') {
				out.push({ prioridade: 1, tipo: 'apoio', operador_id: p.operador_id, atribuicao_id: a.id,
					texto: `${nomeOp(p.operador_id)} usou ${p.tentativas_usadas === 1 ? 'a tentativa' : `as ${p.tentativas_usadas} tentativas`} em “${cen}” e ainda não chegou na meta (${a.nota_minima}${p.melhor_nota != null ? `; melhor nota ${Math.round(Number(p.melhor_nota))}` : ''}).` });
			} else if (s === 'item_critico') {
				const item = u?.item_reprovado ? ` “${itemChecklist(u.item_reprovado, d.itens).texto}”` : '';
				out.push({ prioridade: 1, tipo: 'critico', operador_id: p.operador_id, atribuicao_id: a.id,
					texto: `${nomeOp(p.operador_id)} ficou “não” no item crítico${item} em “${cen}”.` });
			}
			if (s !== 'aprovado' && a.prazo >= d.hoje && !comLink.has(p.operador_id)) {
				const l = estadoLink(d.links, p.operador_id, d.agora);
				if (l.estado !== 'ativo') {
					comLink.add(p.operador_id);
					out.push({ prioridade: 3, tipo: 'link', operador_id: p.operador_id, atribuicao_id: a.id,
						texto: `${nomeOp(p.operador_id)} ${l.estado === 'expirado' ? 'está com o link de treino expirado' : 'ainda não tem link de treino'} e tem “${cen}” pendente.` });
				}
			}
		}
		const r = resumoTreino(a, d.pessoas, d.hoje);
		if (r.situacao === 'prazo_vencido') {
			out.push({ prioridade: 2, tipo: 'prazo', operador_id: null, atribuicao_id: a.id,
				texto: `“${cen}”: o prazo venceu em ${dataBR(a.prazo)} com ${r.pendentes.length} ${r.pendentes.length === 1 ? 'pessoa pendente' : 'pessoas pendentes'}.` });
		}
	}
	for (const x of d.discordancias) {
		const s = d.sessoes.find(z => z.id === x.sessao_id);
		if (!s?.operador_id) continue;
		out.push({ prioridade: 2, tipo: 'discordancia', operador_id: s.operador_id, atribuicao_id: s.atribuicao_id,
			texto: `${nomeOp(s.operador_id)} discordou de um ponto da avaliação em “${nomeCen(s.cenario_id)}”.` });
	}
	for (const sg of d.sugestoes ?? []) {
		if (sg.regra !== 'item_critico_operador' || !sg.operadores.length) continue;
		const item = typeof sg.evidencia?.item === 'string' ? itemChecklist(sg.evidencia.item, d.itens).texto : 'do checklist';
		out.push({ prioridade: 1, tipo: 'sugestao', operador_id: sg.operadores[0], atribuicao_id: null, sugestao_id: sg.id,
			texto: `${nomeOp(sg.operadores[0])} ficou “não” no item crítico “${item}” em ligações reais mais de uma vez. Vale um treino.` });
	}
	const vistos = new Set<string>();
	return out.filter(i => (vistos.has(i.texto) ? false : (vistos.add(i.texto), true))).sort((a, b) => a.prioridade - b.prioridade);
}

/** Indicadores do Painel (30 dias): pessoas com treino em andamento, quem chegou na meta e nota média do treino. */
export function indicadoresPainel(atribuicoes: AtribuicaoRP[], pessoas: PessoaNoTreino[], sessoes: SessaoRP[], hoje: string, desde: string) {
	const abertas = atribuicoes.filter(a => resumoTreino(a, pessoas, hoje).situacao !== 'concluido');
	const emAndamento = abertas.reduce((n, a) => n + resumoTreino(a, pessoas, hoje).pendentes.length, 0);
	const recentes = new Set(atribuicoes.filter(a => a.criado_em.slice(0, 10) >= desde).map(a => a.id));
	const ps = pessoas.filter(p => recentes.has(p.atribuicao_id));
	const naMeta = ps.filter(p => p.situacao === 'aprovado').length;
	const notas = sessoes.filter(s => s.situacao === 'avaliada' && s.origem !== 'teste' && s.nota != null && s.inicio.slice(0, 10) >= desde).map(s => Number(s.nota));
	return {
		emAndamento, treinosAbertos: abertas.length,
		naMeta, avaliadas: ps.length, pctMeta: ps.length ? Math.round((100 * naMeta) / ps.length) : null,
		notaMedia: notas.length ? Math.round(notas.reduce((s, n) => s + n, 0) / notas.length) : null, sessoes: notas.length,
	};
}

/** Sugestão de treino (treino_sugestoes): texto pela regra, só com contagens. */
export const REGRA_SUGESTAO: Record<string, string> = {
	item_reprovado: 'Item do checklist com “não” em vários operadores na semana',
	alerta_subiu: 'Alerta subiu na semana numa equipe',
	item_critico_operador: 'Item crítico com “não” repetido nas ligações',
	vulnerabilidade: 'Sinal de vulnerabilidade concentrado numa equipe',
	nota_baixa: 'Nota das ligações abaixo de 70 nas últimas duas semanas',
};

/** "Dispensar" com o motivo em 1 clique (dispensar_sugestao_treino): some por 30 dias; o motivo calibra as regras. */
export const MOTIVO_DISPENSA: Record<'tratado' | 'falso_positivo', string> = { tratado: 'Já tratei no 1:1', falso_positivo: 'Não procede' };

const ALERTA_SUGESTAO: Record<string, string> = { procon: 'ameaça de Procon', juridico: 'ameaça de processo', ameaca: 'ameaça', abusiva: 'cobrança abusiva' };
const SINAL_SUGESTAO: Record<string, string> = {
	idade_confusao: 'pessoa idosa ou com dificuldade de entender', saude: 'problema de saúde', luto: 'luto', desemprego_recente: 'desemprego recente',
};

export type SugestaoRP = {
	id: number; regra: string; chave?: string; cenario_id: number | null; operadores: number[]; criado_em: string;
	evidencia?: Record<string, unknown> | null; atualizada_em?: string;
};
/** A sugestão em linguagem de monitoria: título, a linha de quem e quanto, as contagens que a geraram (nunca trecho de
 *  ligação), a prioridade e onde ver no Speech. */
export function textoSugestao(s: SugestaoRP, x: { operadores: Pick<OperadorRP, 'id' | 'apelido'>[]; equipes: { id: number; nome: string }[]; itens: Record<string, ItemChecklistRP> }) {
	const e = (s.evidencia ?? {}) as Record<string, unknown>;
	const n = (k: string) => (typeof e[k] === 'number' ? (e[k] as number) : null);
	const t = (k: string) => (typeof e[k] === 'string' ? (e[k] as string) : null);
	const item = t('item') ? itemChecklist(t('item')!, x.itens).texto : null;
	const equipe = n('equipe') != null ? x.equipes.find(q => q.id === n('equipe'))?.nome ?? 'uma equipe' : null;
	const nomes = s.operadores.map(id => x.operadores.find(o => o.id === id)?.apelido).filter((v): v is string => !!v);
	const quem = nomes.length === 0 ? `${s.operadores.length} ${s.operadores.length === 1 ? 'operador' : 'operadores'}`
		: nomes.length <= 3 ? nomes.join(', ') : `${nomes.slice(0, 3).join(', ')} e mais ${nomes.length - 3}`;
	const periodo = t('de') && t('ate') ? `de ${dataBR(t('de')!)} a ${dataBR(t('ate')!)}` : null;
	const ev: string[] = [];
	let titulo = REGRA_SUGESTAO[s.regra] ?? 'Sugestão de treino';
	let aba: 'qualidade' | 'alertas' | 'operadores' = 'qualidade';
	switch (s.regra) {
		case 'item_reprovado':
			titulo = item ? `“${item}” com “não” em ${n('operadores') ?? s.operadores.length} operadores` : titulo;
			if (n('nao') != null && n('avaliadas') != null) ev.push(`${n('nao')} “não” em ${n('avaliadas')} ligações avaliadas nesse item`);
			break;
		case 'nota_baixa':
			titulo = `${nomes[0] ?? 'Um operador'}: nota média ${n('nota_media') != null ? String(n('nota_media')).replace('.', ',') : '—'} nas ligações`;
			if (n('ligacoes') != null) ev.push(`${n('ligacoes')} ligações avaliadas`);
			if (item) ev.push(`Item que mais pesou: “${item}”`);
			aba = 'operadores';
			break;
		case 'item_critico_operador':
			titulo = `${nomes[0] ?? 'Um operador'}: item crítico “${item ?? 'do checklist'}” com “não” ${n('vezes') ?? 2} vezes`;
			ev.push('Item crítico reprova a ligação na monitoria');
			break;
		case 'alerta_subiu':
			titulo = `Alertas de ${ALERTA_SUGESTAO[t('alerta') ?? ''] ?? 'risco'} subiram na ${equipe ?? 'equipe'}`;
			if (n('semana') != null) ev.push(`${n('semana')} nesta semana × ${n('semana_anterior') ?? 0} na anterior`);
			aba = 'alertas';
			break;
		case 'vulnerabilidade':
			titulo = `Sinais de ${SINAL_SUGESTAO[t('sinal') ?? ''] ?? 'vulnerabilidade'} na ${equipe ?? 'equipe'}`;
			if (n('alertas') != null) ev.push(`${n('alertas')} alertas na semana`);
			aba = 'alertas';
			break;
	}
	if (periodo) ev.push(`Período: ${periodo}`);
	return { titulo, quem, evidencia: ev, prioridade: s.regra === 'item_critico_operador' ? ('alta' as const) : ('normal' as const), aba };
}

// ------------------------------------------------------------------ Cadastro para treino (mesmas regras do banco)
/** Apelido (voz_operadores.apelido): 1 a 30 caracteres, sem 6+ dígitos, sem e-mail, CPF ou telefone. */
export function validarApelido(t: string): string {
	const v = t.trim();
	if (!v) return 'Escreva o apelido.';
	if (v.length > 30) return 'Use até 30 caracteres.';
	if (v.includes('@') || /\d{6,}/.test(v) || textoTemDadoPessoal(v)) return 'Só o primeiro nome e a inicial. Sem CPF, e-mail ou telefone.';
	return '';
}
/** ID do discador (opcional): letras, números e _ . : -, até 40, sem 8+ dígitos seguidos. */
export function validarIdDiscador(t: string): string {
	const v = t.trim();
	if (!v) return '';
	if (!/^[A-Za-z0-9_.:-]{1,40}$/.test(v)) return 'Use só letras, números e _ . : - (até 40), sem espaço.';
	if (/[0-9]{8,}/.test(v)) return 'Um ID com 8 ou mais números seguidos parece documento ou telefone.';
	return '';
}
/** Nome da equipe (treino_equipes.nome): 2 a 40 caracteres, sem dado pessoal. */
export function validarNomeEquipe(t: string): string {
	const v = t.trim();
	if (v.length < 2) return 'Escreva o nome da equipe (2 caracteres ou mais).';
	if (v.length > 40) return 'Use até 40 caracteres.';
	if (v.includes('@') || textoTemDadoPessoal(v)) return 'Sem CPF, e-mail ou telefone no nome da equipe.';
	return '';
}
/** Quem está no Cadastro para treino: criado só para treino ou com equipe de treino. O resto de Speech › Operadores
 *  pode ser trazido ("Trazer de Speech › Operadores"). */
export const noCadastro = (o: Pick<OperadorRP, 'so_treino' | 'equipe_id'>) => o.so_treino || o.equipe_id != null;

// ------------------------------------------------------------------ editor de cenário (as mesmas regras do banco, SQL 90)
export type ObjecaoForm = { codigo: string; quando: string };
export type FormCenario = {
	nome: string; persona_nome: string; perfil: string; descricao: string; objetivo: string;
	comportamentos: string[]; frases: string[]; objecoes: ObjecaoForm[]; dificuldade: number;
	produto: string; faixa: string; dias_atraso: string; parcelas: string; desconto_max: string;
	duracao_min: string; modos: string[]; itens_foco: string[]; objetivo_cenario: string;
};
export const LIMITES_CENARIO = { comportamentos: 10, frases: 20, objecoes: 10, itens_foco: 12, texto: 200, quando: 120 } as const;

export function cenarioVazio(): FormCenario {
	return {
		nome: '', persona_nome: '', perfil: 'ja_pagou', descricao: '', objetivo: '', comportamentos: [], frases: [], objecoes: [], dificuldade: 2,
		produto: 'Cartão Exemplo', faixa: '1k_5k', dias_atraso: '60', parcelas: '10', desconto_max: '15', duracao_min: '8', modos: ['voz', 'texto'],
		itens_foco: [], objetivo_cenario: '',
	};
}
const num = (v: unknown) => (v == null ? '' : String(v));
export function formDoCenario(c: CenarioRP): FormCenario {
	const d = c.divida ?? {};
	return {
		nome: c.nome, persona_nome: c.persona_nome, perfil: c.perfil, descricao: c.descricao ?? '', objetivo: c.objetivo,
		comportamentos: [...c.comportamentos], frases: [...c.frases], objecoes: c.objecoes.map(o => ({ codigo: o.codigo, quando: o.quando ?? '' })),
		dificuldade: c.dificuldade, produto: d.produto ?? '', faixa: d.faixa ?? '', dias_atraso: num(d.dias_atraso),
		parcelas: num(d.alcada?.parcelas), desconto_max: num(d.alcada?.desconto_max), duracao_min: String(Math.round(c.duracao_max_s / 60)),
		modos: [...c.modos], itens_foco: [...c.itens_foco], objetivo_cenario: c.objetivo_cenario ?? '',
	};
}
export const mesmoForm = (a: FormCenario, b: FormCenario) => JSON.stringify(a) === JSON.stringify(b);

const RE_PERSONA = /^\S.{0,40}\((fictícia|fictício)\)$/u;
function textoLivre(v: string, min: number, max: number, nome: string): string {
	const t = v.trim();
	if (t.length < min) return min <= 1 ? `Escreva ${nome}.` : `Escreva ${nome} (${min} caracteres ou mais).`;
	if (t.length > max) return `Use até ${max} caracteres.`;
	if (t.includes('@') || textoTemDadoPessoal(t)) return 'Sem CPF, telefone ou e-mail: o cenário é ficção.';
	return '';
}
const inteiro = (v: string) => (/^\d{1,6}$/.test(v.trim()) ? Number(v.trim()) : null);

export type ErrosCenario = Partial<Record<keyof FormCenario | 'geral', string>>;
/** Mesmas regras dos checks de treino_cenarios (SQL 90). Vazio = pode salvar. */
export function validarCenario(f: FormCenario): ErrosCenario {
	const e: ErrosCenario = {};
	const nome = textoLivre(f.nome, 3, 80, 'o nome do cenário');
	if (nome) e.nome = nome;
	const p = f.persona_nome.trim();
	if (!p) e.persona_nome = 'Escreva o nome do cliente simulado.';
	else if (!RE_PERSONA.test(p) || /[0-9@]/.test(p) || p.length > 60) e.persona_nome = 'Primeiro nome e “(fictícia)” ou “(fictício)” no fim, sem números. Ex.: Rita (fictícia).';
	if (!TIPOS_CLIENTE[f.perfil]) e.perfil = 'Escolha o tipo de cliente.';
	if (f.descricao.trim()) { const x = textoLivre(f.descricao, 1, 400, 'o resumo'); if (x) e.descricao = x; }
	const obj = textoLivre(f.objetivo, 10, 500, 'como o cliente age');
	if (obj) e.objetivo = obj;
	const lista = (l: string[], n: number) => l.length > n ? `Até ${n}.` : l.map(x => textoLivre(x, 1, LIMITES_CENARIO.texto, 'o texto')).find(Boolean) ?? '';
	const comp = lista(f.comportamentos, LIMITES_CENARIO.comportamentos);
	if (comp) e.comportamentos = comp;
	const fr = lista(f.frases, LIMITES_CENARIO.frases);
	if (fr) e.frases = fr;
	if (f.objecoes.length > LIMITES_CENARIO.objecoes) e.objecoes = `Até ${LIMITES_CENARIO.objecoes} objeções.`;
	else {
		const ruim = f.objecoes.find(o => !/^[a-z][a-z0-9_]{1,40}$/.test(o.codigo) || (o.quando.trim() && textoLivre(o.quando, 1, LIMITES_CENARIO.quando, 'quando')));
		if (ruim) e.objecoes = !/^[a-z][a-z0-9_]{1,40}$/.test(ruim.codigo) ? 'Escolha a objeção.' : textoLivre(ruim.quando, 1, LIMITES_CENARIO.quando, 'quando');
	}
	if (!(f.dificuldade >= 1 && f.dificuldade <= 5)) e.dificuldade = 'De 1 a 5.';
	if (f.produto.trim()) { const x = textoLivre(f.produto, 2, 60, 'o produto'); if (x) e.produto = x; }
	if (f.faixa && !FAIXAS_SALDO[f.faixa]) e.faixa = 'Escolha a faixa de saldo.';
	if (f.dias_atraso.trim()) { const d = inteiro(f.dias_atraso); if (d == null || d < 1 || d > 3650) e.dias_atraso = 'De 1 a 3.650 dias.'; }
	if (f.parcelas.trim()) { const d = inteiro(f.parcelas); if (d == null || d < 1 || d > 120) e.parcelas = 'De 1 a 120 parcelas.'; }
	if (f.desconto_max.trim()) { const d = inteiro(f.desconto_max); if (d == null || d > 100) e.desconto_max = 'De 0% a 100%.'; }
	const dur = inteiro(f.duracao_min);
	if (dur == null || dur < 1 || dur > 15) e.duracao_min = 'De 1 a 15 minutos.';
	if (!f.modos.length) e.modos = 'Deixe ao menos um modo (voz ou texto).';
	if (f.itens_foco.length > LIMITES_CENARIO.itens_foco) e.itens_foco = `Até ${LIMITES_CENARIO.itens_foco} itens em foco.`;
	if (f.objetivo_cenario.trim()) { const x = textoLivre(f.objetivo_cenario, 1, 200, 'o objetivo'); if (x) e.objetivo_cenario = x; }
	return e;
}

/** O `dados` de salvar_cenario_treino (só os campos que o banco aceita). */
export function dadosCenario(f: FormCenario, situacao: 'rascunho' | 'publicado') {
	const alcada: { parcelas?: number; desconto_max?: number } = {};
	if (inteiro(f.parcelas) != null) alcada.parcelas = inteiro(f.parcelas)!;
	if (inteiro(f.desconto_max) != null) alcada.desconto_max = inteiro(f.desconto_max)!;
	const divida: DividaRP & Record<string, unknown> = {};
	if (f.produto.trim()) divida.produto = f.produto.trim();
	if (f.faixa) divida.faixa = f.faixa;
	if (inteiro(f.dias_atraso) != null) divida.dias_atraso = inteiro(f.dias_atraso)!;
	if (Object.keys(alcada).length) divida.alcada = alcada;
	const limpa = (l: string[]) => l.map(x => x.trim()).filter(Boolean);
	return {
		nome: f.nome.trim(), persona_nome: f.persona_nome.trim(), perfil: f.perfil, descricao: f.descricao.trim(), objetivo: f.objetivo.trim(),
		comportamentos: limpa(f.comportamentos), frases: limpa(f.frases),
		objecoes: f.objecoes.map(o => (o.quando.trim() ? { codigo: o.codigo, quando: o.quando.trim() } : { codigo: o.codigo })),
		dificuldade: f.dificuldade, divida, duracao_max_s: Math.min(900, Math.max(60, (inteiro(f.duracao_min) ?? 8) * 60)),
		modos: (['voz', 'texto'] as const).filter(m => f.modos.includes(m)), itens_foco: f.itens_foco, objetivo_cenario: f.objetivo_cenario.trim(), situacao,
	};
}

// ------------------------------------------------------------------ "Atribuir treino"
export type FormAtribuir = { cenario: number | null; operadores: number[]; prazo: string; meta: string; tentativas: string; modos: string[] };
export const OPCOES_TENTATIVAS = [{ v: '1', n: '1' }, { v: '2', n: '2' }, { v: '3', n: '3' }, { v: '5', n: '5' }, { v: '', n: 'Sem limite' }] as const;
/** Prazo padrão: hoje + 7 dias (ISO). */
export function prazoPadrao(hoje: string): string {
	const d = new Date(`${hoje}T12:00:00Z`);
	d.setUTCDate(d.getUTCDate() + 7);
	return d.toISOString().slice(0, 10);
}
function maisDias(hoje: string, n: number): string {
	const d = new Date(`${hoje}T12:00:00Z`);
	d.setUTCDate(d.getUTCDate() + n);
	return d.toISOString().slice(0, 10);
}
/** Mesmas regras de atribuir_treino (SQL 90): cenário publicado, 1 a 200 pessoas, prazo de hoje a 180 dias. */
export function validarAtribuicao(f: FormAtribuir, hoje: string, modosCenario: readonly string[] | null): Partial<Record<keyof FormAtribuir, string>> {
	const e: Partial<Record<keyof FormAtribuir, string>> = {};
	if (f.cenario == null) e.cenario = 'Escolha o cenário.';
	if (!f.operadores.length) e.operadores = 'Escolha pelo menos uma pessoa.';
	else if (f.operadores.length > 200) e.operadores = 'Até 200 pessoas por treino.';
	if (!/^\d{4}-\d{2}-\d{2}$/.test(f.prazo) || f.prazo < hoje || f.prazo > maisDias(hoje, 180)) e.prazo = 'Prazo de hoje até 180 dias.';
	const m = inteiro(f.meta);
	if (m == null || m > 100) e.meta = 'Meta de 0 a 100.';
	if (f.tentativas && !(Number(f.tentativas) >= 1 && Number(f.tentativas) <= 20)) e.tentativas = 'De 1 a 20 tentativas.';
	if (!f.modos.length) e.modos = 'Escolha o modo.';
	else if (modosCenario && f.modos.some(x => !modosCenario.includes(x))) e.modos = 'O cenário não tem esse modo.';
	return e;
}
export const MODOS_ATRIBUIR = [
	{ v: 'voz,texto', n: 'Voz (padrão) ou texto' }, { v: 'texto', n: 'Só texto' }, { v: 'voz', n: 'Só voz' },
] as const;

// ------------------------------------------------------------------ link pessoal e lembrete
export const ROTA_TREINO = '/treino';
export const rotaTreino = (token: string) => `${ROTA_TREINO}/${token}`;
export const rotaBriefing = (token: string, atr: number | string) => `${rotaTreino(token)}/${encodeURIComponent(String(atr))}`;
export const tokenValido = (t: string | null | undefined) => !!t && /^[0-9a-f]{64}$/.test(t);
/** Endereço completo do link (para copiar e para o QR). */
export const urlTreino = (origem: string, token: string) => `${origem.replace(/\/+$/, '')}${rotaTreino(token)}`;

/** Lembrete pronto para colar no canal interno (não guardamos contato do operador). Sem o link quando ele não está
 *  à mão (o token só aparece uma vez): o texto pede para abrir o link de treino que a pessoa já recebeu. */
export function textoLembrete(x: { apelido: string; cenario: string; prazo: string; meta: number; tentativas?: string | null; url?: string | null }): string {
	const primeiro = x.apelido.trim().split(/\s+/)[0] || x.apelido.trim();
	const tent = x.tentativas ? ` Você tem ${x.tentativas}.` : '';
	const link = x.url ? `\nSeu link de treino: ${x.url}` : '\nAbra o seu link de treino (o mesmo que você recebeu da Qualidade).';
	return `Oi, ${primeiro}! Lembrete do treino “${x.cenario}”: o prazo é ${dataBR(x.prazo)} e a meta é ${x.meta}.${tent} É treino: a nota não entra na sua monitoria.${link}`;
}
/** Resumo do feedback 1:1 para o supervisor (só o combinado, sem nota de ligação real). */
export function resumoFeedback(x: { apelido: string; cenario?: string | null; combinado: string; proxima?: string | null }): string {
	return `Feedback 1:1 com ${x.apelido.trim()}${x.cenario ? ` (treino “${x.cenario}”)` : ''}: ${x.combinado.trim()}${x.proxima ? ` Próxima conversa: ${dataBR(x.proxima)}.` : ''}`;
}
