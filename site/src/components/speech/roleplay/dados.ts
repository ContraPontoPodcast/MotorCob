// Leituras e gravações do Roleplay (SQL 90). Leitura direta das tabelas treino_* (RLS: cliente_pode(empresa,
// 'treinar_operadores'); cenários do Padrão MotorCX para quem treina ou cuida dos cenários) e de voz_operadores
// (RLS: ver_operadores). Gravação só pelas RPCs security definer: salvar_equipe_treino, salvar_operador_treino e
// duplicar_cenario_treino. Nada aqui lê transcrição ou trecho de conversa.
import type { SupabaseClient } from '@supabase/supabase-js';
import { friendlyError } from '@/lib/supabase';
import { diaSP } from '@/lib/speech';
import type {
	AtribuicaoRP, CenarioRP, EquipeRP, ItemChecklistRP, LinkRP, OperadorRP, PessoaNoTreino, SessaoRP,
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

export type Sugestao = { id: number; regra: string; cenario_id: number | null; operadores: number[]; criado_em: string };
export type Uso = { minutos_voz: number; franquia_voz: number; sessoes_texto: number; franquia_texto: number; voz_bloqueada: boolean };
export type DadosPainel = {
	cenarios: CenarioRP[]; operadores: OperadorRP[]; atribuicoes: AtribuicaoRP[]; pessoas: PessoaNoTreino[]; sessoes: SessaoRP[];
	links: LinkRP[]; discordancias: { sessao_id: number }[]; sugestoes: Sugestao[]; uso: Uso | null; itens: Record<string, ItemChecklistRP>;
};

export async function lerPainel(sb: Sb, empresa: number): Promise<DadosPainel> {
	const [cenarios, operadores, atribuicoes, pessoas, sessoes, links, discordancias, sugestoes, uso, itens] = await Promise.all([
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
		sb.from('treino_sugestoes').select('id, regra, cenario_id, operadores, criado_em')
			.eq('empresa_id', empresa).eq('situacao', 'nova').order('criado_em', { ascending: false }).limit(20).then(r => dados<Sugestao[]>(r)),
		sb.rpc('uso_treino', { empresa }).then(r => (r.error ? null : (r.data as Uso))),
		lerItensChecklist(sb, empresa),
	]);
	return { cenarios, operadores, atribuicoes, pessoas, sessoes, links, discordancias, sugestoes, uso, itens };
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
