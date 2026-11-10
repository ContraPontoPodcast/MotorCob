// Leituras e gravações do Roleplay (SQL 90). Leitura direta das tabelas treino_* (RLS: cliente_pode(empresa,
// 'treinar_operadores'); cenários do Padrão MotorCX para quem treina ou cuida dos cenários) e de voz_operadores
// (RLS: ver_operadores). Gravação só pelas RPCs security definer: salvar_equipe_treino, salvar_operador_treino e
// duplicar_cenario_treino. Nada aqui lê transcrição ou trecho de conversa.
import type { SupabaseClient } from '@supabase/supabase-js';
import { friendlyError } from '@/lib/supabase';
import { diaSP } from '@/lib/speech';
import type {
	AtribuicaoRP, CenarioRP, EquipeRP, ItemChecklistRP, LinkRP, OperadorRP, PessoaNoTreino, SessaoRP, SugestaoRP,
} from '@/lib/roleplay';

type Sb = SupabaseClient;
export class ErroRP extends Error {}
function dados<T>(r: { data: unknown; error: unknown }): T {
	if (r.error) throw new ErroRP(friendlyError(r.error));
	return (r.data ?? []) as T;
}

export async function treinoLiberado(sb: Sb, empresa: number): Promise<boolean> {
	const r = await sb.rpc('treino_liberado', { empresa });
	if (r.error) throw new ErroRP(friendlyError(r.error));
	return r.data === true;
}

/** Biblioteca: os cenários da empresa e o Padrão MotorCX (empresa_id nulo). */
export async function lerCenarios(sb: Sb, empresa: number): Promise<CenarioRP[]> {
	return dados<CenarioRP[]>(await sb.from('treino_cenarios')
		.select('id, empresa_id, base_id, nome, persona_nome, perfil, descricao, objetivo, comportamentos, frases, objecoes, dificuldade, divida, duracao_max_s, modos, itens_foco, objetivo_cenario, situacao, origem, atualizado_em')
		.or(`empresa_id.is.null,empresa_id.eq.${empresa}`)
		.neq('situacao', 'arquivado')
		.order('nome')
		.limit(500));
}

export async function lerCenario(sb: Sb, empresa: number, id: number): Promise<CenarioRP | null> {
	const r = await sb.from('treino_cenarios')
		.select('id, empresa_id, base_id, nome, persona_nome, perfil, descricao, objetivo, comportamentos, frases, objecoes, dificuldade, divida, duracao_max_s, modos, itens_foco, objetivo_cenario, situacao, origem, atualizado_em')
		.eq('id', id)
		.or(`empresa_id.is.null,empresa_id.eq.${empresa}`)
		.maybeSingle();
	if (r.error) throw new ErroRP(friendlyError(r.error));
	return (r.data as CenarioRP | null) ?? null;
}

/** Itens do checklist em uso (o da empresa por cima do Padrão MotorCX): texto e gravidade de cada id. */
export async function lerItensChecklist(sb: Sb, empresa: number): Promise<Record<string, ItemChecklistRP>> {
	const r = await sb.from('checklists_qualidade').select('id, empresa_id, checklist_versoes(itens, situacao)')
		.or(`empresa_id.is.null,empresa_id.eq.${empresa}`);
	if (r.error) return {};
	type Linha = { empresa_id: number | null; checklist_versoes: { itens: { id: string; texto: string; gravidade: string }[]; situacao: string }[] | null };
	const linhas = ((r.data ?? []) as Linha[]).sort((a, b) => Number(a.empresa_id != null) - Number(b.empresa_id != null));
	const out: Record<string, ItemChecklistRP> = {};
	for (const l of linhas) {
		const v = (l.checklist_versoes ?? []).find(x => x.situacao === 'em_uso');
		for (const i of v?.itens ?? []) if (i?.id && i.texto) out[i.id] = { texto: i.texto, gravidade: i.gravidade };
	}
	return out;
}

export async function lerOperadores(sb: Sb, empresa: number): Promise<OperadorRP[]> {
	return dados<OperadorRP[]>(await sb.from('voz_operadores')
		.select('id, apelido, equipe_id, operador_ref, so_treino, ativo')
		.eq('empresa_id', empresa)
		.order('apelido')
		.limit(2000));
}

export async function lerEquipes(sb: Sb, empresa: number): Promise<EquipeRP[]> {
	return dados<EquipeRP[]>(await sb.from('treino_equipes').select('id, nome, ativo').eq('empresa_id', empresa).order('nome'));
}

export async function lerLinks(sb: Sb, empresa: number): Promise<LinkRP[]> {
	return dados<LinkRP[]>(await sb.from('treino_links').select('operador_id, valido_ate, revogado_em')
		.eq('empresa_id', empresa).is('revogado_em', null));
}

export type Sugestao = SugestaoRP;
export type Uso = { minutos_voz: number; franquia_voz: number; sessoes_texto: number; franquia_texto: number; voz_bloqueada: boolean };
export type DadosPainel = {
	cenarios: CenarioRP[]; operadores: OperadorRP[]; atribuicoes: AtribuicaoRP[]; pessoas: PessoaNoTreino[]; sessoes: SessaoRP[];
	links: LinkRP[]; discordancias: { sessao_id: number }[]; sugestoes: Sugestao[]; uso: Uso | null; itens: Record<string, ItemChecklistRP>;
	equipes: EquipeRP[];
};

/** Sugestões novas do job noturno (SQL 120): só as que a regra ainda sustentou nos últimos 8 dias. */
const COLS_SUG = 'id, regra, chave, cenario_id, operadores, criado_em, evidencia, atualizada_em';

/** "Dispensar" com o motivo (tratado / falso_positivo) ou, com motivo nulo, "Desfazer". */
export async function dispensarSugestao(sb: Sb, id: number, motivo: 'tratado' | 'falso_positivo' | null): Promise<void> {
	const { error } = await sb.rpc('dispensar_sugestao_treino', { sugestao: id, motivo });
	if (error) throw new Error(friendlyError(error));
}

export async function lerPainel(sb: Sb, empresa: number): Promise<DadosPainel> {
	const [cenarios, operadores, atribuicoes, pessoas, sessoes, links, discordancias, sugestoes, uso, itens, equipes] = await Promise.all([
		lerCenarios(sb, empresa),
		lerOperadores(sb, empresa),
		sb.from('treino_atribuicoes').select('id, cenario_id, prazo, nota_minima, tentativas, criado_em')
			.eq('empresa_id', empresa).order('prazo', { ascending: false }).limit(500).then(r => dados<AtribuicaoRP[]>(r)),
		sb.from('treino_atribuicao_operadores').select('atribuicao_id, operador_id, situacao, melhor_nota, tentativas_usadas, tentativas_extra')
			.eq('empresa_id', empresa).limit(5000).then(r => dados<PessoaNoTreino[]>(r)),
		sb.from('treino_sessoes').select('id, atribuicao_id, operador_id, cenario_id, origem, modo, situacao, inicio, duracao_s, nota, reprovada, item_reprovado')
			.eq('empresa_id', empresa).gte('inicio', diaSP(-120)).order('inicio', { ascending: false }).limit(3000).then(r => dados<SessaoRP[]>(r)),
		lerLinks(sb, empresa),
		sb.from('treino_discordancias').select('sessao_id').eq('empresa_id', empresa).is('resolvida_em', null).limit(200)
			.then(r => dados<{ sessao_id: number }[]>(r)),
		sb.from('treino_sugestoes').select(COLS_SUG)
			.eq('empresa_id', empresa).eq('situacao', 'nova').gte('atualizada_em', diaSP(-8)).order('criado_em', { ascending: false }).limit(50).then(r => dados<Sugestao[]>(r)),
		sb.rpc('uso_treino', { empresa }).then(r => (r.error ? null : (r.data as Uso))),
		lerItensChecklist(sb, empresa),
		lerEquipes(sb, empresa),
	]);
	return { cenarios, operadores, atribuicoes, pessoas, sessoes, links, discordancias, sugestoes, uso, itens, equipes };
}

export type DadosPessoa = {
	operador: OperadorRP | null; equipes: EquipeRP[]; cenarios: CenarioRP[]; atribuicoes: AtribuicaoRP[]; pessoas: PessoaNoTreino[];
	sessoes: SessaoRP[]; links: LinkRP[]; feedbacks: { id: number; combinado: string; proxima_conversa: string | null; criado_em: string }[];
};

export async function lerPessoa(sb: Sb, empresa: number, id: number): Promise<DadosPessoa> {
	const [op, equipes, cenarios, pessoas, sessoes, links, feedbacks] = await Promise.all([
		sb.from('voz_operadores').select('id, apelido, equipe_id, operador_ref, so_treino, ativo').eq('empresa_id', empresa).eq('id', id).maybeSingle(),
		lerEquipes(sb, empresa),
		lerCenarios(sb, empresa),
		sb.from('treino_atribuicao_operadores').select('atribuicao_id, operador_id, situacao, melhor_nota, tentativas_usadas, tentativas_extra')
			.eq('empresa_id', empresa).eq('operador_id', id).then(r => dados<PessoaNoTreino[]>(r)),
		sb.from('treino_sessoes').select('id, atribuicao_id, operador_id, cenario_id, origem, modo, situacao, inicio, duracao_s, nota, reprovada, item_reprovado')
			.eq('empresa_id', empresa).eq('operador_id', id).order('inicio', { ascending: false }).limit(100).then(r => dados<SessaoRP[]>(r)),
		sb.from('treino_links').select('operador_id, valido_ate, revogado_em').eq('empresa_id', empresa).eq('operador_id', id).is('revogado_em', null)
			.then(r => dados<LinkRP[]>(r)),
		sb.from('treino_feedbacks').select('id, combinado, proxima_conversa, criado_em').eq('empresa_id', empresa).eq('operador_id', id)
			.order('criado_em', { ascending: false }).limit(50).then(r => dados<DadosPessoa['feedbacks']>(r)),
	]);
	if (op.error) throw new ErroRP(friendlyError(op.error));
	const ids = [...new Set(pessoas.map(p => p.atribuicao_id))];
	const atribuicoes = ids.length
		? dados<AtribuicaoRP[]>(await sb.from('treino_atribuicoes').select('id, cenario_id, prazo, nota_minima, tentativas, criado_em')
			.eq('empresa_id', empresa).in('id', ids))
		: [];
	return { operador: (op.data as OperadorRP | null) ?? null, equipes, cenarios, atribuicoes, pessoas, sessoes, links, feedbacks };
}

// ------------------------------------------------------------------ gravação (RPCs do SQL 90)
export async function salvarEquipe(sb: Sb, empresa: number, nome: string, equipe?: number | null, ativo = true): Promise<number> {
	const r = await sb.rpc('salvar_equipe_treino', { empresa, nome: nome.trim(), equipe: equipe ?? null, ativo });
	if (r.error) throw new ErroRP(friendlyError(r.error));
	return Number(r.data);
}

export async function salvarOperador(sb: Sb, empresa: number, x: { apelido: string; equipe: number; operador_ref: string | null; operador?: number | null; ativo: boolean }): Promise<number> {
	const r = await sb.rpc('salvar_operador_treino', {
		empresa, apelido: x.apelido.trim(), equipe: x.equipe, operador_ref: x.operador_ref?.trim() || null, operador: x.operador ?? null, ativo: x.ativo,
	});
	if (r.error) throw new ErroRP(friendlyError(r.error));
	return Number(r.data);
}

export async function duplicarCenario(sb: Sb, empresa: number, cenario: number): Promise<number> {
	const r = await sb.rpc('duplicar_cenario_treino', { cenario, empresa });
	if (r.error) throw new ErroRP(friendlyError(r.error));
	return Number(r.data);
}

/** Formulário do cadastro: cria a equipe nova, se for o caso, e grava a pessoa. */
export async function salvarCadastro(sb: Sb, empresa: number, x: { apelido: string; equipe: number | null; novaEquipe: string; operador_ref: string | null; operador: number | null; ativo: boolean }): Promise<number> {
	const equipe = x.equipe ?? (x.novaEquipe.trim() ? await salvarEquipe(sb, empresa, x.novaEquipe) : null);
	if (equipe == null) throw new ErroRP('Escolha a equipe.');
	return salvarOperador(sb, empresa, { apelido: x.apelido, equipe, operador_ref: x.operador_ref, operador: x.operador, ativo: x.ativo });
}

// ------------------------------------------------------------------ editor, atribuição e links (RPCs do SQL 90)
export async function salvarCenario(sb: Sb, empresa: number, dados: Record<string, unknown>, cenario?: number | null): Promise<number> {
	const r = await sb.rpc('salvar_cenario_treino', { empresa, dados, cenario: cenario ?? null });
	if (r.error) throw new ErroRP(friendlyError(r.error));
	return Number(r.data);
}

export async function atribuirTreino(sb: Sb, empresa: number, x: { cenario: number; operadores: number[]; prazo: string; nota_minima: number; tentativas: number | null; modos: string[]; sugestao: number | null }): Promise<number> {
	const r = await sb.rpc('atribuir_treino', {
		empresa, cenario: x.cenario, operadores: x.operadores, prazo: x.prazo, nota_minima: x.nota_minima, tentativas: x.tentativas, modos: x.modos, sugestao: x.sugestao,
	});
	if (r.error) throw new ErroRP(friendlyError(r.error));
	return Number(r.data);
}

/** Link novo da pessoa: o token aparece só aqui (o banco guarda o sha-256). Gerar outro revoga o anterior. */
export async function gerarLink(sb: Sb, operador: number): Promise<{ token: string; valido_ate: string }> {
	const r = await sb.rpc('gerar_link_treino', { operador });
	if (r.error) throw new ErroRP(friendlyError(r.error));
	return r.data as { token: string; valido_ate: string };
}
export async function revogarLink(sb: Sb, operador: number): Promise<void> {
	const r = await sb.rpc('revogar_link_treino', { operador });
	if (r.error) throw new ErroRP(friendlyError(r.error));
}
export async function liberarTentativa(sb: Sb, atribuicao: number, operador: number): Promise<number> {
	const r = await sb.rpc('liberar_tentativa_treino', { atribuicao, operador });
	if (r.error) throw new ErroRP(friendlyError(r.error));
	return Number(r.data);
}
export async function estenderPrazo(sb: Sb, atribuicao: number, prazo: string): Promise<void> {
	const r = await sb.rpc('estender_prazo_treino', { atribuicao, prazo });
	if (r.error) throw new ErroRP(friendlyError(r.error));
}
export async function salvarFeedback(sb: Sb, empresa: number, x: { operador: number; combinado: string; proxima_conversa: string | null; atribuicao: number | null; sessao?: number | null }): Promise<number> {
	const r = await sb.rpc('salvar_feedback_treino', {
		empresa, operador: x.operador, combinado: x.combinado.trim(), proxima_conversa: x.proxima_conversa || null, atribuicao: x.atribuicao, sessao: x.sessao ?? null,
	});
	if (r.error) throw new ErroRP(friendlyError(r.error));
	return Number(r.data);
}

export type AtribuicaoCompleta = AtribuicaoRP & { modos: string[]; origem_sugestao_id: number | null };
export type DadosAtribuicoes = { atribuicoes: AtribuicaoCompleta[]; pessoas: PessoaNoTreino[]; cenarios: CenarioRP[]; operadores: OperadorRP[] };

const COLS_ATR = 'id, cenario_id, prazo, nota_minima, tentativas, criado_em, modos, origem_sugestao_id';
const COLS_PESSOA = 'atribuicao_id, operador_id, situacao, melhor_nota, tentativas_usadas, tentativas_extra';

export async function lerAtribuicoes(sb: Sb, empresa: number): Promise<DadosAtribuicoes> {
	const [atribuicoes, pessoas, cenarios, operadores] = await Promise.all([
		sb.from('treino_atribuicoes').select(COLS_ATR).eq('empresa_id', empresa).order('prazo', { ascending: false }).limit(500).then(r => dados<AtribuicaoCompleta[]>(r)),
		sb.from('treino_atribuicao_operadores').select(COLS_PESSOA).eq('empresa_id', empresa).limit(5000).then(r => dados<PessoaNoTreino[]>(r)),
		lerCenarios(sb, empresa),
		lerOperadores(sb, empresa),
	]);
	return { atribuicoes, pessoas, cenarios, operadores };
}

export type FeedbackRP = { id: number; operador_id: number; combinado: string; proxima_conversa: string | null; criado_em: string };
export type DadosAtribuicao = {
	atribuicao: AtribuicaoCompleta | null; cenario: CenarioRP | null; pessoas: PessoaNoTreino[]; operadores: OperadorRP[]; equipes: EquipeRP[];
	sessoes: SessaoRP[]; links: LinkRP[]; ultimoAcesso: Record<number, string>; feedbacks: FeedbackRP[];
};

export async function lerAtribuicao(sb: Sb, empresa: number, id: number): Promise<DadosAtribuicao> {
	const a = await sb.from('treino_atribuicoes').select(COLS_ATR).eq('empresa_id', empresa).eq('id', id).maybeSingle();
	if (a.error) throw new ErroRP(friendlyError(a.error));
	const atribuicao = (a.data as AtribuicaoCompleta | null) ?? null;
	if (!atribuicao) return { atribuicao: null, cenario: null, pessoas: [], operadores: [], equipes: [], sessoes: [], links: [], ultimoAcesso: {}, feedbacks: [] };
	const [cenario, pessoas, operadores, equipes, sessoes, linksTodos, feedbacks] = await Promise.all([
		lerCenario(sb, empresa, atribuicao.cenario_id),
		sb.from('treino_atribuicao_operadores').select(COLS_PESSOA).eq('empresa_id', empresa).eq('atribuicao_id', id).then(r => dados<PessoaNoTreino[]>(r)),
		lerOperadores(sb, empresa),
		lerEquipes(sb, empresa),
		sb.from('treino_sessoes').select('id, atribuicao_id, operador_id, cenario_id, origem, modo, situacao, inicio, duracao_s, nota, reprovada, item_reprovado')
			.eq('empresa_id', empresa).eq('atribuicao_id', id).order('inicio', { ascending: false }).limit(1000).then(r => dados<SessaoRP[]>(r)),
		sb.from('treino_links').select('id, operador_id, valido_ate, revogado_em').eq('empresa_id', empresa).order('criado_em', { ascending: false }).limit(3000)
			.then(r => dados<(LinkRP & { id: number })[]>(r)),
		sb.from('treino_feedbacks').select('id, operador_id, combinado, proxima_conversa, criado_em').eq('empresa_id', empresa).eq('atribuicao_id', id)
			.order('criado_em', { ascending: false }).limit(200).then(r => dados<FeedbackRP[]>(r)),
	]);
	// Último acesso de cada pessoa pelo link (treino_link_acessos: sem IP, sem token).
	const ops = new Set(pessoas.map(p => p.operador_id));
	const meus = linksTodos.filter(l => ops.has(l.operador_id));
	const ultimoAcesso: Record<number, string> = {};
	if (meus.length) {
		const ac = await sb.from('treino_link_acessos').select('link_id, em').eq('empresa_id', empresa).in('link_id', meus.map(l => l.id).slice(0, 500))
			.order('em', { ascending: false }).limit(2000);
		if (!ac.error) {
			for (const x of (ac.data ?? []) as { link_id: number; em: string }[]) {
				const op = meus.find(l => l.id === x.link_id)?.operador_id;
				if (op != null && !ultimoAcesso[op]) ultimoAcesso[op] = x.em;
			}
		}
	}
	return { atribuicao, cenario, pessoas, operadores, equipes, sessoes, links: meus.filter(l => !l.revogado_em), ultimoAcesso, feedbacks };
}

export type DadosAtribuir = { cenarios: CenarioRP[]; operadores: OperadorRP[]; equipes: EquipeRP[]; sugestao: Sugestao | null; uso: Uso | null };
export async function lerParaAtribuir(sb: Sb, empresa: number, sug: number | null): Promise<DadosAtribuir> {
	const [cenarios, operadores, equipes, sugestao, uso] = await Promise.all([
		lerCenarios(sb, empresa),
		lerOperadores(sb, empresa),
		lerEquipes(sb, empresa),
		sug == null ? Promise.resolve(null) : sb.from('treino_sugestoes').select(COLS_SUG).eq('empresa_id', empresa).eq('id', sug).maybeSingle()
			.then(r => (r.error ? null : (r.data as Sugestao | null))),
		sb.rpc('uso_treino', { empresa }).then(r => (r.error ? null : (r.data as Uso))),
	]);
	return { cenarios, operadores, equipes, sugestao, uso };
}
