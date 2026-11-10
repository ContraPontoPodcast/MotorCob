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

export type SecaoRP = 'painel' | 'cenarios' | 'cadastro';
/** Sub-navegação do Roleplay. Só as seções que já existem (Treinos atribuídos e Evolução chegam nos próximos PRs). */
export const SECOES_RP: readonly { id: SecaoRP; nome: string; to: string }[] = [
	{ id: 'painel', nome: 'Painel', to: ROTA_RP },
	{ id: 'cenarios', nome: 'Cenários', to: ROTA_RP_CENARIOS },
	{ id: 'cadastro', nome: 'Cadastro para treino', to: ROTA_RP_CADASTRO },
];

const sem = (p: string) => (p.length > 1 ? p.replace(/\/+$/, '') : p);

/** Seção do Roleplay a que a rota pertence (o detalhe marca a seção-mãe), ou null fora do Roleplay. */
export function secaoRP(pathname: string): SecaoRP | null {
	const p = sem(pathname);
	if (p === ROTA_RP) return 'painel';
	if (p === ROTA_RP_CENARIOS || p.startsWith(`${ROTA_RP_CENARIOS}/`)) return 'cenarios';
	if (p === ROTA_RP_CADASTRO || p.startsWith(`${ROTA_RP_CADASTRO}/`)) return 'cadastro';
	return null;
}

/** A rota é a própria seção (não um detalhe dela). */
export const ehSecaoRP = (pathname: string) => SECOES_RP.some(s => s.to === sem(pathname));

export type ItemTrilha = { rotulo: string; to?: string };
/** Trilha clicável: Speech Analytics › Roleplay › Cenários › Já pagou. O último item é a tela atual (sem link).
 *  `detalhe` é o nome da tela de detalhe (cenário, pessoa), quando já carregou. */
export function trilhaRP(pathname: string, detalhe?: string | null): ItemTrilha[] {
	const p = sem(pathname);
	const secao = secaoRP(p);
	const itens: ItemTrilha[] = [{ rotulo: 'Speech Analytics', to: '/speech-analytics' }, { rotulo: 'Roleplay', to: ROTA_RP }];
	if (secao && secao !== 'painel') {
		const s = SECOES_RP.find(x => x.id === secao)!;
		itens.push({ rotulo: s.nome, to: s.to });
		if (p !== s.to) itens.push({ rotulo: detalhe?.trim() || (secao === 'cenarios' ? 'Cenário' : 'Pessoa') });
	}
	const ult = itens[itens.length - 1];
	itens[itens.length - 1] = { rotulo: ult.rotulo };
	return itens;
}

/** Título da aba do navegador, distinto por tela: "Já pagou · Cenários · Roleplay · MotorCX". */
export function tituloDocumentoRP(pathname: string, detalhe?: string | null): string {
	const itens = trilhaRP(pathname, detalhe);
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

const OBJECOES_TREINO: Record<string, string> = {
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

export type ItemAcao = { prioridade: 1 | 2 | 3; tipo: 'apoio' | 'critico' | 'prazo' | 'discordancia' | 'link'; texto: string; operador_id: number | null; atribuicao_id: number | null };
export type DadosAcao = {
	atribuicoes: AtribuicaoRP[]; pessoas: PessoaNoTreino[]; sessoes: SessaoRP[]; links: LinkRP[];
	discordancias: { sessao_id: number }[]; operadores: OperadorRP[]; cenarios: Pick<CenarioRP, 'id' | 'nome'>[];
	itens: Record<string, ItemChecklistRP>; hoje: string; agora?: Date;
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
};

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
