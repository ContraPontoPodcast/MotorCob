// Speech Analytics (SQL 60, supabase/migrations/20261227000001_voz_speech_analytics.sql): rótulos, regras e contas
// das telas. Sem import de alias: este arquivo roda também no `node --test` (speech.test.ts).
// LGPD: nunca CPF nem nome de devedor; só ID do cliente e trecho já mascarado. Grupo com menos de 30 não aparece
// (o banco devolve nulo e a tela mostra "menos de 30").

export const MIN_GRUPO = 30;

/** Permissões novas do cliente (permissoes_catalogo, SQL 60). */
export const PERM_SA = {
	editarChecklist: 'editar_checklist',
	verOperadores: 'ver_operadores',
	verAlertas: 'ver_alertas',
	curadoria: 'curadoria_voz',
	relatorioCredor: 'enviar_relatorio_credor',
	verTranscricoes: 'ver_transcricoes',
	ouvirGravacoes: 'ouvir_gravacoes',
	editarOrquestracao: 'editar_orquestracao',
	editarCanais: 'editar_canais',
} as const;

/** Abas do Speech Analytics (redesign v2). "Buscar nas conversas" fica no fim da barra (BUSCA_SA), não é aba. */
export const ABAS_SA = [
	{ id: 'visao', nome: 'Visão geral' },
	{ id: 'qualidade', nome: 'Qualidade' },
	{ id: 'operadores', nome: 'Operadores' },
	{ id: 'alertas', nome: 'Alertas' },
	{ id: 'recomendacoes', nome: 'Recomendações' },
	{ id: 'curadoria', nome: 'Curadoria' },
] as const;
export const BUSCA_SA = { id: 'busca', nome: 'Buscar nas conversas' } as const;
export type AbaSA = (typeof ABAS_SA)[number]['id'] | typeof BUSCA_SA.id;
/** Endereços antigos que continuam abrindo: "Retroalimentação" virou Recomendações. */
const ALIAS_SA: Record<string, AbaSA> = { retroalimentacao: 'recomendacoes' };
/** O Roleplay saiu do Speech Analytics e foi para Fluxo do agente › Testar com personas (decisão do redesign v2).
 *  Enquanto a tela nova não entra, o endereço leva ao roteiro do agente virtual. */
export const ROTA_TESTAR_PERSONAS = '/canais/agente-virtual';
export function abaValida(a: string | undefined): AbaSA {
	if (a === BUSCA_SA.id) return 'busca';
	if (a && ALIAS_SA[a]) return ALIAS_SA[a];
	return (ABAS_SA.find(x => x.id === a)?.id ?? 'visao') as AbaSA;
}
/** Endereço de cada aba (a Visão geral é a raiz). */
export const rotaSA = (aba: AbaSA) => (aba === 'visao' ? '/speech-analytics' : `/speech-analytics/${aba}`);

export const PERIODOS = [{ d: 7, n: 'Últimos 7 dias' }, { d: 30, n: 'Últimos 30 dias' }, { d: 90, n: 'Últimos 90 dias' }];
export const ORIGENS = [{ v: '', n: 'IA e discador' }, { v: 'ia', n: 'Só agente de IA' }, { v: 'discador', n: 'Só discador (humano)' }];

/** Dia ISO (Brasília) com deslocamento em dias. */
export function diaSP(desloc = 0, base = new Date()): string {
	const d = new Date(base.getTime() + desloc * 86400000);
	const p = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
	return p;
}
export function periodo(dias: number, base = new Date()): { de: string; ate: string } {
	return { de: diaSP(-(dias - 1), base), ate: diaSP(0, base) };
}

// ------------------------------------------------------------------ formatos
export const nf = (v: unknown) => (v == null ? '—' : Math.round(Number(v)).toLocaleString('pt-BR'));
export const dc = (v: unknown, casas = 1) => (v == null ? '—' : Number(v).toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas }));
export const pc = (v: unknown, casas = 1) => (v == null ? 'menos de 30' : `${dc(v, casas)}%`);
export const sinal = (v: number, casas = 1) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${dc(Math.abs(v), casas)}`;
export function dataBR(iso: unknown): string {
	if (!iso) return '—';
	const s = String(iso);
	const d = new Date(s.length === 10 ? `${s}T12:00:00-03:00` : s);
	return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', timeZone: 'America/Sao_Paulo' });
}
export function dataHoraBR(iso: unknown): string {
	if (!iso) return '—';
	const d = new Date(String(iso));
	return Number.isNaN(d.getTime()) ? '—' : `${d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', timeZone: 'America/Sao_Paulo' })} ${d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' })}`;
}
export function mesExtenso(iso: string): string {
	const m = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
	return `${m[Number(iso.slice(5, 7)) - 1] ?? ''} de ${iso.slice(0, 4)}`;
}

// ------------------------------------------------------------------ busca (mesma regra de termo_busca_proibido)
export const AVISO_BUSCA = 'A busca não aceita CPF, telefone nem e-mail. Procure pelo assunto; para achar um cliente, use o ID em Gravações.';
export function termoProibido(q: string): boolean {
	const t = q ?? '';
	if (/\d{3}\.?\d{3}\.?\d{3}-?\d{2}/.test(t)) return true;
	if (/\d{8,}/.test(t.replace(/[\s().\-/+]/g, ''))) return true;
	return t.includes('@');
}
/** Texto livre que vai para o banco (observação, comentário, melhoria): mesma regra de texto_mascarado_ok. */
export function textoTemDadoPessoal(t: string): boolean {
	return /\d{3}\.\d{3}\.\d{3}-\d{2}/.test(t) || /\d{8,}/.test(t) || /\(?\d{2}\)?\s?9?\d{4}-\d{4}/.test(t) || /[^\s@]+@[^\s@]+\.[A-Za-z]{2,}/.test(t);
}
/** Destaca o termo exato (busca por termo) sem HTML: devolve partes [texto, marcado?]. */
export function marcarTermo(texto: string, termo: string): [string, boolean][] {
	if (!termo) return [[texto, false]];
	const out: [string, boolean][] = [];
	const lo = texto.toLowerCase();
	const q = termo.toLowerCase();
	let i = 0;
	for (;;) {
		const k = lo.indexOf(q, i);
		if (k < 0) { out.push([texto.slice(i), false]); break; }
		if (k > i) out.push([texto.slice(i, k), false]);
		out.push([texto.slice(k, k + q.length), true]);
		i = k + q.length;
	}
	return out.filter(p => p[0] !== '');
}

// ------------------------------------------------------------------ operadores (sem humilhar: faixas, ordem alfabética)
export const FAIXAS = [
	{ id: 'ref', nome: 'Referência', regra: '90 ou mais', texto: 'Servem de exemplo para treino.', tom: 100 },
	{ id: 'con', nome: 'Consistente', regra: '80 a 89', texto: 'Bom padrão; ajustes pontuais.', tom: 80 },
	{ id: 'des', nome: 'Em desenvolvimento', regra: '70 a 79', texto: 'Trilha de treino sugerida.', tom: 62 },
	{ id: 'apo', nome: 'Com apoio do supervisor', regra: 'abaixo de 70', texto: 'Acompanhamento semanal, sem exposição.', tom: 46 },
] as const;
export function faixaDe(nota: number): number {
	return nota >= 90 ? 0 : nota >= 80 ? 1 : nota >= 70 ? 2 : 3;
}
export type Operador = { ref: string; apelido: string | null; n: number; nota: number | null };
/** Por faixa, em ordem alfabética dentro de cada uma; quem tem menos de 30 ligações fica fora (sem nota). */
export function porFaixa(ops: Operador[]): { comNota: Operador[]; semNota: Operador[]; faixas: Operador[][]; top5: Operador[] } {
	const comNota = ops.filter(o => o.nota != null && o.n >= MIN_GRUPO);
	const semNota = ops.filter(o => !(o.nota != null && o.n >= MIN_GRUPO));
	const nome = (o: Operador) => (o.apelido ?? o.ref);
	const faixas = FAIXAS.map((_, k) => comNota.filter(o => faixaDe(o.nota as number) === k).sort((a, b) => nome(a).localeCompare(nome(b), 'pt-BR')));
	const top5 = [...comNota].sort((a, b) => (b.nota as number) - (a.nota as number)).slice(0, 5);
	return { comNota, semNota, faixas, top5 };
}

// ------------------------------------------------------------------ rótulos
export const MOTIVOS: Record<string, string> = {
	esquecimento: 'Esqueceu', reducao_renda: 'Redução de renda', desemprego: 'Desemprego', outras_dividas: 'Outras dívidas',
	aguardando_recebimento: 'Aguardando receber', contestacao: 'Contesta a dívida', nao_reconhece: 'Não reconhece',
	fraude_alegada: 'Alega fraude', insatisfacao_servico: 'Insatisfeito com o serviço', outro: 'Outro',
};
export const OBJECOES: Record<string, string> = {
	valor_alto: 'Valor alto', parcela_alta: 'Parcela alta', juros: 'Juros', sem_dinheiro_agora: 'Sem dinheiro agora',
	quer_desconto: 'Quer desconto', desconfia_golpe: 'Desconfia de golpe', quer_por_escrito: 'Quer por escrito',
	quer_falar_humano: 'Quer falar com uma pessoa', outro: 'Outro',
};
export const FRASES: Record<string, string> = {
	reconheceu_dificuldade: 'Reconheceu a dificuldade antes da oferta', resumiu_acordo: 'Resumiu o acordo antes de encerrar',
	link_na_ligacao: 'Mandou o link durante a ligação', dia_vencimento: 'Deixou escolher o dia do vencimento',
};
// SQL 63 · código da primeira oferta do fluxo ("6x", "avista_d10_20", "sem_oferta"): só parcelas e faixa de desconto
export function rotuloOferta(c: string): string {
	if (c === 'sem_oferta') return 'Sem oferta do CRM';
	const m = /^(avista|(\d{1,2})x)(?:_d(1_10|10_20|20_30|30_50|50_mais))?$/.exec(c);
	if (!m) return c.toUpperCase();
	const base = m[1] === 'avista' ? 'À vista' : `${m[2]}x`;
	const faixa = m[3] ? (m[3] === '50_mais' ? 'desconto acima de 50%' : `desconto de ${m[3].replace('_', '–')}%`) : '';
	return faixa ? `${base} · ${faixa}` : base;
}
export const FUNIL = [
	{ id: 'identidade', nome: 'Identidade confirmada' }, { id: 'objecao', nome: 'Levantou objeção' },
	{ id: 'oferta', nome: 'Recebeu oferta' }, { id: 'aceitou', nome: 'Aceitou a oferta' }, { id: 'acordo', nome: 'Acordo registrado' },
];
export const ALERTA_TIPOS: Record<string, string> = {
	procon: 'Procon', juridico: 'Advogado ou processo', ameaca: 'Ameaça', abusiva: 'Linguagem abusiva', vulnerabilidade: 'Vulnerabilidade',
};
export const SINAIS: Record<string, string> = {
	idade_confusao: 'Idade avançada e confusão', saude: 'Saúde (sem detalhe)', luto: 'Luto na família', desemprego_recente: 'Desemprego recente',
};
export const DESFECHOS: Record<string, string> = {
	tratado: 'Tratado', sem_acao: 'Sem ação necessária', juridico: 'Encaminhado ao jurídico',
	regua_ajustada: 'Régua do cliente ajustada manualmente', conversado_operador: 'Conversado com o operador',
};
export function desfechosDe(tipo: string): string[] {
	const base = ['tratado', 'sem_acao', 'juridico'];
	if (tipo === 'vulnerabilidade') base.push('regua_ajustada');
	if (tipo === 'ameaca') base.push('conversado_operador');
	return base;
}
export const GRAVIDADE: Record<string, string> = { bloqueante: 'Bloqueante', importante: 'Importante', boa_pratica: 'Boa prática' };
export const ORIGEM_ITEM: Record<string, string> = { padrao: 'Padrão', ajustado: 'Ajustado', cliente: 'Do cliente' };
export const APLICA: Record<string, string> = { ambos: 'IA e humano', humano: 'só humano', ia: 'só IA' };
export const DESTINOS: Record<string, { nome: string; onde: string; to: string; rascunho: boolean }> = {
	regua: { nome: 'Régua', onde: 'Estratégia › Orquestração', to: '/orquestracao', rascunho: true },
	renitencia: { nome: 'Renitência e Resubmit', onde: 'Estratégia › Orquestração (travas de ligação)', to: '/orquestracao', rascunho: true },
	fluxo: { nome: 'Fluxo do agente', onde: 'Canais › Agente virtual', to: '/canais/agente-virtual', rascunho: false },
	canal: { nome: 'Canal', onde: 'Estratégia › Orquestração', to: '/orquestracao', rascunho: false },
	frases: { nome: 'Frases e Abordagem', onde: 'Estratégia › Frases', to: '/canais?secao=frases', rascunho: true },
	propensao: { nome: 'Propensão em sombra', onde: 'Propensão (só observação)', to: '/personas', rascunho: false },
};
export const CURADORIA_TIPOS: Record<string, string> = {
	intencao: 'Intenção com baixa confiança', trava: 'Resposta trocada pela trava', codigo: 'Código com dúvida',
	nota: 'Nota contestada', transcricao: 'Transcrição com erro', tema: 'Tema sem intenção',
};
export const MELHORIA_SIT: Record<string, string> = { aberta: 'Aberta', em_teste: 'Em teste', aplicada: 'Aplicada', descartada: 'Descartada' };
export const MELHORIA_TIPO: Record<string, string> = { fluxo: 'Fluxo', base: 'Base de respostas', checklist: 'Checklist' };
export const RESPOSTA_CREDOR: Record<string, string> = { testar: 'Vamos testar', nao: 'Não', depois: 'Depois' };

// ------------------------------------------------------------------ checklist
export type ItemChecklist = {
	id: string; texto: string; criterio?: string; gravidade: 'bloqueante' | 'importante' | 'boa_pratica';
	aplica: 'ia' | 'humano' | 'ambos'; peso: 1 | 2 | 3; origem: 'padrao' | 'ajustado' | 'cliente'; trava: boolean; on: boolean;
};
/** Id novo de item do cliente a partir do texto (cl_ + palavras, único). */
export function idItem(texto: string, existentes: string[]): string {
	const base = 'cl_' + texto.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 30);
	let id = base.length > 3 ? base : 'cl_item';
	let k = 2;
	while (existentes.includes(id)) id = `${base.slice(0, 34)}_${k++}`;
	return id;
}
/** Ajuste do cliente sobre um item: item de lei (trava) não muda; o resto vira "ajustado" se era padrão. */
export function ajustarItem(it: ItemChecklist, mudanca: Partial<Pick<ItemChecklist, 'gravidade' | 'peso' | 'on'>>): ItemChecklist {
	if (it.trava) return it;
	const novo = { ...it, ...mudanca };
	if (it.origem === 'padrao' && (mudanca.gravidade !== undefined || mudanca.peso !== undefined)) novo.origem = 'ajustado';
	return novo;
}

// ------------------------------------------------------------------ relatório ao credor
export const ETAPAS_REL = [
	{ id: 'rascunho', nome: 'Rascunho', desc: 'Gerado no dia 1 pelo MotorCX' },
	{ id: 'revisao', nome: 'Revisão pela assessoria', desc: 'Confere e comenta' },
	{ id: 'enviado', nome: 'Enviado ao credor', desc: 'Link de leitura e PDF' },
	{ id: 'respondido', nome: 'Resposta do credor', desc: '"Vamos testar", "não" ou "depois"' },
];
export function etapaRel(situacao: string): number {
	return Math.max(0, ETAPAS_REL.findIndex(e => e.id === situacao));
}
export function linkRelatorio(origem: string, token: string): string {
	return `${origem.replace(/\/$/, '')}/relatorio-credor/${token}`;
}
