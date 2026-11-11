// Sessão de treino por texto e resultado formativo (Roleplay, SQL 100). Regras e textos sem banco: rotas da sessão e do
// resultado (operador e Qualidade), relógio, a conversa na tela, e o resultado na ordem formativa da SPEC §2.4:
// item crítico com "não" numa faixa no topo → "O que você fez bem" → "Para treinar" (trecho + "O que dizer") →
// "Não se aplicou" (recolhido). "Discordo deste ponto" só em item "não". Nunca "reprovado".
import { dataBR } from './speech';
import { rotaBriefing } from './roleplay';

export const rotaSessaoOperador = (token: string, atr: number | string, sessao: number | string) =>
	`${rotaBriefing(token, atr)}/sessao/${encodeURIComponent(String(sessao))}`;
export const rotaResultadoOperador = (token: string, atr: number | string, sessao: number | string) =>
	`${rotaBriefing(token, atr)}/resultado/${encodeURIComponent(String(sessao))}`;

export type Turno = { quem: 'persona' | 'operador'; texto: string; t?: number };
/** Resposta do turno da Edge Function `treino`. */
export type RespostaTurno = {
	fala?: string; operador?: string | null; desligou?: boolean; saldo?: string | null; segundos?: number; duracao_max_s?: number;
	turnos?: Turno[]; fim?: 'tempo' | 'limite';
};
export type RespostaEncerrar = { situacao: 'avaliada' | 'falhou' | 'abandonada'; sessao?: number; motivo?: string };

/** "03:07". */
export function relogio(s: number): string {
	const v = Math.max(0, Math.floor(s));
	return `${String(Math.floor(v / 60)).padStart(2, '0')}:${String(v % 60).padStart(2, '0')}`;
}

export type ItemResultado = {
	id: string; resposta: 'sim' | 'nao' | 'na'; texto: string | null; gravidade: string | null; evidencia: number[] | null; revisado: string | null;
};
export type FeedbackResultado = { item: string; trecho: string | null; dica: string };
export type DiscordanciaResultado = { id?: number; item: string; texto: string; resolvida: boolean; em?: string };
/** O que treino_resultado (operador) e resultado_sessao_treino (Qualidade) devolvem. */
export type ResultadoTreino = {
	sessao: number; situacao: string; modo: string; inicio: string; duracao_s: number | null; nota: number | null; reprovada: boolean;
	item_reprovado: string | null; objetivo_ok: boolean | null; nota_minima: number | null; itens: ItemResultado[];
	feedback: FeedbackResultado[]; transcricao: Turno[] | null; discordancias: DiscordanciaResultado[];
	// só no da Qualidade
	origem?: string; atribuicao?: number | null; prazo?: string | null; tentativas?: number | null; tentativa?: number | null;
	operador?: { id: number; apelido: string } | null; cenario?: { id: number; nome: string; persona_nome: string; objetivo_cenario: string | null } | null;
	motivo_falha?: string | null;
};

/** O resultado na ordem formativa. A resposta que vale é a da revisão da Qualidade, quando houver. */
export function organizarResultado(r: Pick<ResultadoTreino, 'itens' | 'feedback' | 'item_reprovado' | 'reprovada'>) {
	const valor = (i: ItemResultado) => (i.revisado === 'sim' || i.revisado === 'nao' || i.revisado === 'na' ? i.revisado : i.resposta);
	const fb = (id: string) => r.feedback.find(f => f.item === id) ?? null;
	const ordem = (a: ItemResultado, b: ItemResultado) => Number(b.gravidade === 'bloqueante') - Number(a.gravidade === 'bloqueante') || (a.texto ?? a.id).localeCompare(b.texto ?? b.id, 'pt-BR');
	const bem = r.itens.filter(i => valor(i) === 'sim').sort(ordem);
	const treinar = r.itens.filter(i => valor(i) === 'nao').sort(ordem).map(i => ({ ...i, feedback: fb(i.id) }));
	const naoSeAplicou = r.itens.filter(i => valor(i) === 'na').sort(ordem);
	const critico = r.reprovada && r.item_reprovado ? r.itens.find(i => i.id === r.item_reprovado) ?? null : null;
	return { bem, treinar, naoSeAplicou, critico, valor };
}

/** Pílula do resultado: "Chegou na meta (75)", "Ainda não chegou na meta (75) · 2 tentativas até 14/11". */
export function pilulaResultado(x: { nota: number | null; reprovada: boolean; nota_minima: number | null; restantes?: number | null; prazo?: string | null }): { texto: string; tom: 'ok' | 'atencao' | 'neutro' } {
	if (x.nota == null) return { texto: 'Sem nota', tom: 'neutro' };
	const meta = x.nota_minima;
	if (meta == null) return { texto: `Nota ${Math.round(Number(x.nota))}`, tom: 'neutro' };
	if (Number(x.nota) >= meta && !x.reprovada) return { texto: `Chegou na meta (${meta})`, tom: 'ok' };
	const resta = x.restantes == null ? '' : x.restantes === 0 ? ' · sem tentativas' : ` · ${x.restantes} ${x.restantes === 1 ? 'tentativa' : 'tentativas'}${x.prazo ? ` até ${dataBR(x.prazo)}` : ''}`;
	return { texto: `Ainda não chegou na meta (${meta})${resta}`, tom: 'atencao' };
}

/** Texto curto do "Discordo deste ponto" (3 a 200 caracteres, sem dado pessoal: o banco confere de novo). */
export function validarDiscordancia(t: string, temDadoPessoal: (s: string) => boolean): string {
	const v = t.trim();
	if (v.length < 3) return 'Escreva em uma linha por que você discorda.';
	if (v.length > 200) return 'Use até 200 caracteres.';
	if (v.includes('@') || temDadoPessoal(v)) return 'Sem CPF, telefone ou e-mail.';
	return '';
}

/** Mensagem do encerramento para a tela. */
export function textoEncerramento(r: RespostaEncerrar): string {
	if (r.situacao === 'avaliada') return 'Conversa avaliada.';
	if (r.situacao === 'abandonada') return r.motivo === 'sem_fala' ? 'Você saiu antes de falar: a tentativa não contou.' : 'Você saiu sem contar: a tentativa não contou.';
	return 'Não deu para avaliar agora: a tentativa não contou. Tente de novo em alguns minutos.';
}
