// Página do operador pelo link pessoal de treino (/treino/:token, sem login e sem o menu do MotorCX). Regras e textos
// sem banco: o que treino_meus (SQL 90) devolve, os grupos de "Meus treinamentos" e o estado do link
// (treino_estado_link, SQL 99). Tom formativo (SPEC §2.4): "Isto é treino" antes de começar, a nota não entra na
// monitoria, e quem esgota as tentativas "vai combinar o próximo passo com a Qualidade" (nunca "reprovado").
import { dataBR } from './speech';
import type { DividaRP } from './roleplay';

export type ItemFoco = { id: string; texto: string | null; gravidade: string | null };
export type BriefingTreino = {
	id: number; nome: string; persona_nome: string; perfil: string; descricao: string | null; dificuldade: number; divida: DividaRP;
	duracao_max_s: number; modos: string[]; objetivo_cenario: string | null; itens_foco: ItemFoco[];
};
export type SessaoOperador = { id: number; modo: string; inicio: string; nota: number | null; reprovada: boolean };
export type TreinoOperador = {
	atribuicao: number; prazo: string; nota_minima: number; modos: string[]; tentativas: number | null; tentativas_usadas: number;
	melhor_nota: number | null; situacao: string; cenario: BriefingTreino; sessoes: SessaoOperador[];
};
export type MeusTreinos = {
	apelido: string; valido_ate: string; voz_disponivel: boolean; treinos: TreinoOperador[];
	/** minutos de voz usados no mês e a franquia (SQL 119), para o aviso de 80% */
	voz_minutos?: number; voz_franquia?: number;
};

export type EstadoLink = 'ativo' | 'expirado' | 'revogado' | 'indisponivel' | 'invalido';
export const TELA_LINK: Record<Exclude<EstadoLink, 'ativo'>, { titulo: string; texto: (ate?: string | null) => string }> = {
	expirado: { titulo: 'Este link de treino venceu', texto: ate => `O link valeu até ${ate ? dataBR(ate) : 'o prazo do treino'}. Peça um link novo à Qualidade.` },
	revogado: { titulo: 'Este link não abre mais', texto: () => 'Ele foi trocado por um link novo ou desativado. Peça o link atual à Qualidade.' },
	indisponivel: { titulo: 'Treinos indisponíveis', texto: () => 'Os treinos estão desligados para a sua empresa no momento. Fale com a Qualidade.' },
	invalido: { titulo: 'Link de treino inválido', texto: () => 'Confira se o endereço foi copiado inteiro. Se continuar, peça o link à Qualidade.' },
};

/** Grupos de "Meus treinamentos": para fazer, aguardando conversa com a Qualidade (esgotou as tentativas ou o prazo
 *  venceu sem chegar na meta) e feitos (chegou na meta). Dentro de cada um, o prazo mais próximo primeiro. */
export function gruposMeus(treinos: TreinoOperador[], hoje: string) {
	const feitos: TreinoOperador[] = [], aguardando: TreinoOperador[] = [], fazer: TreinoOperador[] = [];
	for (const t of treinos) {
		if (t.situacao === 'aprovado') feitos.push(t);
		else if (t.situacao === 'precisa_apoio' || t.prazo < hoje) aguardando.push(t);
		else fazer.push(t);
	}
	const porPrazo = (a: TreinoOperador, b: TreinoOperador) => a.prazo.localeCompare(b.prazo) || a.atribuicao - b.atribuicao;
	return { fazer: fazer.sort(porPrazo), aguardando: aguardando.sort(porPrazo), feitos: feitos.sort((a, b) => b.prazo.localeCompare(a.prazo)) };
}

/** Tentativas que sobram (null = sem limite). */
export const tentativasRestantes = (t: Pick<TreinoOperador, 'tentativas' | 'tentativas_usadas'>) =>
	t.tentativas == null ? null : Math.max(0, t.tentativas - t.tentativas_usadas);

/** "Ainda não chegou na meta (75) · 2 tentativas até 14/11", "Chegou na meta", "Você usou as 2 tentativas". */
export function pilulaTreino(t: TreinoOperador, hoje: string): { texto: string; tom: 'ok' | 'atencao' | 'info' | 'neutro' } {
	if (t.situacao === 'aprovado') return { texto: `Chegou na meta${t.melhor_nota != null ? ` · melhor nota ${Math.round(Number(t.melhor_nota))}` : ''}`, tom: 'ok' };
	const resta = tentativasRestantes(t);
	if (t.situacao === 'precisa_apoio') return { texto: `Você usou ${t.tentativas_usadas === 1 ? 'a tentativa' : `as ${t.tentativas_usadas} tentativas`}`, tom: 'neutro' };
	if (t.prazo < hoje) return { texto: `O prazo acabou em ${dataBR(t.prazo)}`, tom: 'neutro' };
	const tent = resta == null ? 'tentativas sem limite' : `${resta} ${resta === 1 ? 'tentativa' : 'tentativas'}`;
	if (t.tentativas_usadas > 0) return { texto: `Ainda não chegou na meta (${t.nota_minima}) · ${tent} até ${dataBR(t.prazo)}`, tom: 'atencao' };
	return { texto: `Para fazer · ${tent} até ${dataBR(t.prazo)}`, tom: 'info' };
}

/** O que acontece se não chegar na meta (vai no "Isto é treino"). */
export function textoIstoETreino(t: Pick<TreinoOperador, 'nota_minima' | 'prazo' | 'tentativas'>): string {
	const tent = t.tentativas == null ? 'quantas vezes precisar' : `até ${t.tentativas === 1 ? '1 tentativa' : `${t.tentativas} tentativas`}`;
	return `Só você e a Qualidade veem o resultado. A nota não entra na sua monitoria das ligações reais. Se não chegar na meta (${t.nota_minima}), dá para tentar de novo, ${tent}, até ${dataBR(t.prazo)}; depois disso, a Qualidade combina com você um apoio. Sair no meio não conta como tentativa.`;
}

export const podeComecar = (t: TreinoOperador, hoje: string) => t.situacao !== 'aprovado' && t.situacao !== 'precisa_apoio' && t.prazo >= hoje;
