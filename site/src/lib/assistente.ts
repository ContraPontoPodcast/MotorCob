// Assistente MotorCX — mapeamento de ações, detecção de pergunta, chamada da
// função (streaming), sugestões, avaliação e abertura de chamado.
// Não muda tabelas, views ou políticas: só chama a Edge Function 'assistente'.

import { supabase } from '@/lib/supabase';
import { PERM } from '@/lib/permissoes';
import { CANAL_STORAGE_KEY } from '@/lib/mensageria-produtos';

/** Endereço único do avatar do Assistente MotorCX (usado em todos os lugares). */
export const AVATAR_ASSISTENTE =
	'https://jxwppkrkuckfwmphqjva.supabase.co/storage/v1/object/public/publico/assistente-motorcob.webp';

export type AcaoAssistente = { id: string; rotulo: string };

export type RespostaAssistente = {
	id: string;
	respondida: boolean;
	texto: string;
	passos: string[];
	acao: AcaoAssistente | null;
	situacao?: string; // 'respondida' | 'sem_resposta' | 'fora_do_ar' | 'teto'
	removeu?: boolean;
};

export type MsgHistorico = { papel: 'usuario' | 'assistente'; texto: string };

/** Evento do fluxo de streaming da função assistente. */
export type StreamEvento =
	| { tipo: 'texto'; texto: string }
	| { tipo: 'fim'; resposta: RespostaAssistente };

/** Erro tratado pelo Assistente: 429 (limite), 401 (sessão) ou genérico. */
export class AssistenteError extends Error {
	constructor(public tipo: 'limite' | 'erro' | 'sessao') {
		super(tipo);
	}
}

/** Lê o último canal de mensageria usado (localStorage), padrão 'sms'. */
export function ultimoCanal(): string {
	if (typeof window === 'undefined') return 'sms';
	try { return localStorage.getItem(CANAL_STORAGE_KEY) ?? 'sms'; } catch { return 'sms'; }
}

type RotaAcao = { perm?: string; rota: (canal: string) => string; comPergunta?: boolean };

/** Mapa id da ação → rota (e permissão exigida, se houver). */
export const ACOES_ROTA: Record<string, RotaAcao> = {
	abrir_lista_dia: { rota: () => '/fila' },
	abrir_inicio_orquestracao: { rota: () => '/inicio' },
	abrir_painel_orquestracao: { rota: () => '/painel', perm: PERM.verPainel },
	abrir_acoes: { rota: () => '/acoes' },
	abrir_clientes: { rota: () => '/clientes', perm: PERM.verClientes },
	abrir_personas: { rota: () => '/personas', perm: PERM.verClientes },
	abrir_credores: { rota: () => '/credores' },
	abrir_mapa_esteira: { rota: () => '/mapa' },
	abrir_orquestracao: { rota: () => '/orquestracao' },
	abrir_comite: { rota: () => '/comite', perm: PERM.baixarComite },
	abrir_enviar_arquivos: { rota: () => '/envios', perm: PERM.enviarArquivos },
	abrir_canais_frases: { rota: () => '/canais', perm: PERM.editarCanais },
	abrir_mensageria_painel: { rota: c => `/mensageria/${c}` },
	abrir_campanhas: { rota: c => `/mensageria/${c}/campanhas` },
	abrir_lotes: { rota: c => `/mensageria/${c}/lotes` },
	abrir_respostas: { rota: c => `/mensageria/${c}/respostas` },
	abrir_templates: { rota: c => `/mensageria/${c}/templates` },
	abrir_listas: { rota: c => `/mensageria/${c}/listas` },
	abrir_config_mensageria: { rota: c => `/mensageria/${c}/config` },
	abrir_relatorios: { rota: () => '/relatorios' },
	abrir_empresa: { rota: () => '/empresa' },
	abrir_faturamento: { rota: () => '/empresa/faturamento', perm: PERM.verFaturamento },
	abrir_membros: { rota: () => '/empresa/pessoas?aba=pessoas' },
	abrir_modulos: { rota: () => '/empresa/integracoes' },
	abrir_minha_conta: { rota: () => '/conta' },
	abrir_seguranca_conta: { rota: () => '/conta?aba=seguranca' },
	abrir_tokens_api: { rota: () => '/empresa/integracoes', perm: PERM.gerenciarApi },
	abrir_documentacao: { rota: () => '/docs' },
	abrir_permissoes: { rota: () => '/empresa/pessoas?aba=perfis', perm: PERM.gerenciarPermissoes },
	abrir_auditoria: { rota: () => '/auditoria', perm: PERM.verAuditoria },
	abrir_chamado: { rota: () => '/suporte/novo', comPergunta: true },
	abrir_jornada: { rota: () => '/jornada' },
	abrir_jornada_lista: { rota: () => '/jornada/lista' },
	abrir_jornada_cargas: { rota: () => '/jornada/cargas' },
	abrir_jornada_carteiras: { rota: () => '/jornada/carteiras' },
	abrir_jornada_momentos: { rota: () => '/jornada/momentos' },
	abrir_jornada_mensagens: { rota: () => '/jornada/mensagens' },
	abrir_caixa_atendimento: { rota: () => '/mensageria/atendimento' },
	abrir_radar: { rota: () => '/mensageria/radar' },
	abrir_console_empresas: { rota: () => '/console' },
	abrir_console_saude: { rota: () => '/console/saude' },
	abrir_console_implantacao: { rota: () => '/console/implantacao' },
	abrir_console_faturamento: { rota: () => '/console/faturamento' },
	abrir_console_equipe: { rota: () => '/console/equipe' },
	abrir_minhas_perguntas: { rota: () => '/assistente/minhas' },
};

/** Resolve a rota de uma ação; retorna null se o usuário não tem permissão. */
export function rotaDaAcao(acaoId: string, permissoes: string[], pergunta?: string): string | null {
	const def = ACOES_ROTA[acaoId];
	if (!def) return null;
	if (def.perm && !permissoes.includes(def.perm)) return null;
	const canal = ultimoCanal();
	let rota = def.rota(canal);
	if (def.comPergunta && pergunta) {
		rota += `?assunto=${encodeURIComponent(pergunta.slice(0, 120))}`;
	}
	return rota;
}

const QUESTION_STARTERS = ['como', 'onde', 'o que', 'o q', 'por que', 'porque', 'qual', 'quais', 'quando', 'quanto', 'quantos', 'quantas', 'posso', 'dá para', 'da para', 'consigo', 'tem como', 'existe'];

/** Detecta se o texto é uma pergunta (termina com ? ou começa com palavra de pergunta). */
export function ehPergunta(texto: string): boolean {
	const t = texto.trim().toLowerCase();
	if (!t) return false;
	if (t.endsWith('?')) return true;
	return QUESTION_STARTERS.some(s => t === s || t.startsWith(s + ' '));
}

/** Normaliza texto sem acento e minúsculo para busca. */
export function normalizar(s: string): string {
	return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

/** Nome da tela como no menu, a partir da rota atual. */
export function telaNome(pathname: string): string {
	const p = pathname.replace(/\/$/, '');
	// Ordem: rotas mais específicas primeiro.
	const map: { match: RegExp; nome: string }[] = [
		{ match: /^\/workspace$/, nome: 'Workspace · Início' },
		{ match: /^\/assistente\/minhas$/, nome: 'Assistente · Minhas perguntas' },
		{ match: /^\/inicio$/, nome: 'Orquestração · Início' },
		{ match: /^\/fila$/, nome: 'Orquestração · Lista do dia' },
		{ match: /^\/mapa$/, nome: 'Orquestração · Mapa da Esteira' },
		{ match: /^\/clientes$/, nome: 'Orquestração · Clientes' },
		{ match: /^\/envios$/, nome: 'Orquestração · Enviar arquivos' },
		{ match: /^\/acoes$/, nome: 'Orquestração · Ações' },
		{ match: /^\/cliente$/, nome: 'Orquestração · Buscar cliente' },
		{ match: /^\/orquestracao$/, nome: 'Estratégia · Orquestração' },
		{ match: /^\/clusters$/, nome: 'Estratégia · Segmentos' },
		{ match: /^\/personas$/, nome: 'Estratégia · Personas' },
		{ match: /^\/canais$/, nome: 'Estratégia · Canais e mensagens' },
		{ match: /^\/estrategias$/, nome: 'Estratégia · Estratégias' },
		{ match: /^\/estrategia\//, nome: 'Estratégia · Estratégia' },
		{ match: /^\/credores$/, nome: 'Estratégia · Carteiras' },
		{ match: /^\/credores\//, nome: 'Estratégia · Configurações da carteira' },
		{ match: /^\/painel$/, nome: 'Resultados · Indicadores' },
		{ match: /^\/comite$/, nome: 'Resultados · Comitê' },
		{ match: /^\/relatorios\/novo$/, nome: 'Relatórios · Novo' },
		{ match: /^\/relatorios$/, nome: 'Resultados · Relatórios' },
		{ match: /^\/empresa\/contatos$/, nome: 'Empresa · Contatos' },
		{ match: /^\/empresa\/membros$/, nome: 'Empresa · Membros' },
		{ match: /^\/empresa\/modulos$/, nome: 'Empresa · Módulos' },
		{ match: /^\/empresa\/faturamento$/, nome: 'Empresa · Faturas' },
		{ match: /^\/empresa\/contratacao$/, nome: 'Empresa · Contratação' },
		{ match: /^\/empresa$/, nome: 'Empresa · Dados e contatos' },
		{ match: /^\/conta\/seguranca$/, nome: 'Minha conta · Segurança' },
		{ match: /^\/conta\/tokens$/, nome: 'Minha conta · Tokens de API' },
		{ match: /^\/conta\/notificacoes$/, nome: 'Minha conta · Notificações' },
		{ match: /^\/conta\/permissoes$/, nome: 'Minha conta · Permissões' },
		{ match: /^\/conta$/, nome: 'Minha conta' },
		{ match: /^\/suporte\/novo$/, nome: 'Suporte · Abrir chamado' },
		{ match: /^\/suporte\//, nome: 'Suporte · Chamado' },
		{ match: /^\/suporte$/, nome: 'Suporte' },
		{ match: /^\/docs\/api$/, nome: 'Documentação · API' },
		{ match: /^\/docs\//, nome: 'Documentação · Artigo' },
		{ match: /^\/docs$/, nome: 'Documentação' },
		{ match: /^\/documentacao$/, nome: 'Documentação' },
		{ match: /^\/usuarios$/, nome: 'Empresa · Pessoas e perfis' },
		{ match: /^\/permissoes$/, nome: 'Permissões' },
		{ match: /^\/auditoria$/, nome: 'Auditoria' },
		{ match: /^\/empresas$/, nome: 'Empresas' },
		{ match: /^\/jornada\/lista$/, nome: 'Jornada · Lista do dia' },
		{ match: /^\/jornada\/cargas$/, nome: 'Jornada · Enviar arquivos' },
		{ match: /^\/jornada\/carteiras$/, nome: 'Jornada · Carteiras' },
		{ match: /^\/jornada\/momentos$/, nome: 'Jornada · Momentos da jornada' },
		{ match: /^\/jornada\/mensagens$/, nome: 'Jornada · Mensagens por momento' },
		{ match: /^\/jornada$/, nome: 'Jornada · Início' },
		{ match: /^\/mensageria\/config\/atendimento$/, nome: 'Mensageria · Atendimento' },
		{ match: /^\/mensageria\/atendimento$/, nome: 'Mensageria · Caixa de atendimento' },
		{ match: /^\/mensageria\/radar$/, nome: 'Mensageria · Painel do Radar' },
		{ match: /^\/mensageria\/[^/]+\/campanhas\/nova$/, nome: 'Mensageria · Nova campanha' },
		{ match: /^\/mensageria\/[^/]+\/campanhas\//, nome: 'Mensageria · Campanha' },
		{ match: /^\/mensageria\/[^/]+\/campanhas$/, nome: 'Mensageria · Campanhas' },
		{ match: /^\/mensageria\/[^/]+\/lotes\//, nome: 'Mensageria · Lote' },
		{ match: /^\/mensageria\/[^/]+\/lotes$/, nome: 'Mensageria · Lotes do dia' },
		{ match: /^\/mensageria\/[^/]+\/templates$/, nome: 'Mensageria · Modelos de mensagem' },
		{ match: /^\/mensageria\/[^/]+\/listas$/, nome: 'Mensageria · Listas' },
		{ match: /^\/mensageria\/[^/]+\/respostas$/, nome: 'Mensageria · Respostas' },
		{ match: /^\/mensageria\/[^/]+\/config$/, nome: 'Mensageria · Configurações' },
		{ match: /^\/mensageria\/[^/]+\/relatorios$/, nome: 'Mensageria · Relatórios' },
		{ match: /^\/mensageria\/[^/]+\/score$/, nome: 'Mensageria · Score' },
		{ match: /^\/mensageria\/[^/]+$/, nome: 'Mensageria · Painel' },
		{ match: /^\/mensageria$/, nome: 'Mensageria' },
		{ match: /^\/console\/saude$/, nome: 'Console · Saúde' },
		{ match: /^\/console\/implantacao$/, nome: 'Console · Implantação' },
		{ match: /^\/console\/carteiras$/, nome: 'Console · Carteiras' },
		{ match: /^\/console\/atendimento$/, nome: 'Console · Atendimento' },
		{ match: /^\/console\/assistente$/, nome: 'Console · Assistente' },
		{ match: /^\/console\/chamados$/, nome: 'Console · Chamados' },
		{ match: /^\/console\/contatos-site$/, nome: 'Console · Contatos do site' },
		{ match: /^\/console\/emails$/, nome: 'Console · E-mails do sistema' },
		{ match: /^\/console\/faturamento$/, nome: 'Console · Faturamento' },
		{ match: /^\/console\/fornecedores$/, nome: 'Console · Fornecedores e rotas' },
		{ match: /^\/console\/produtos$/, nome: 'Console · Produtos e preços' },
		{ match: /^\/console\/qualidade$/, nome: 'Console · Qualidade dos fornecedores' },
		{ match: /^\/console\/filtro-inteligencia$/, nome: 'Console · Filtro de inteligência' },
		{ match: /^\/console\/margem$/, nome: 'Console · Margem' },
		{ match: /^\/console\/equipe$/, nome: 'Console · Equipe MotorCX' },
		{ match: /^\/console$/, nome: 'Console · Empresas' },
	];
	for (const { match, nome } of map) {
		if (match.test(p)) return nome;
	}
	return 'Plataforma MotorCX';
}

/** Chave do sessionStorage para o chamado pré-preenchido pelo Assistente. */
export const CHAMADO_ASSISTENTE_KEY = 'motorcob.assistente.chamado';

export type ChamadoAssistente = {
	motivo: string;
	assunto: string;
	conversa: string;
	assistente_pergunta_id: string;
};

/** Chama a Edge Function 'assistente' em streaming. Lê eventos text/event-stream
 *  com fetch + getReader. Lança AssistenteError em 429/401/erro. */
export async function chamarAssistente(
	params: { pergunta: string; origem: 'busca' | 'conversa'; tela: string; tela_nome: string; frente: string; historico: MsgHistorico[] },
	onEvento: (e: StreamEvento) => void,
	signal?: AbortSignal,
): Promise<void> {
	if (!supabase) throw new AssistenteError('erro');
	const baseUrl = import.meta.env.VITE_SUPABASE_URL;
	if (!baseUrl) throw new AssistenteError('erro');
	const { data: sessao } = await supabase.auth.getSession();
	const token = sessao.session?.access_token;
	if (!token) throw new AssistenteError('sessao');

	const resp = await fetch(`${baseUrl}/functions/v1/assistente`, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			Authorization: `Bearer ${token}`,
		},
		body: JSON.stringify({
			pergunta: params.pergunta,
			origem: params.origem,
			tela: params.tela,
			tela_nome: params.tela_nome,
			frente: params.frente,
			historico: params.historico,
			stream: true,
		}),
		signal,
	});

	if (resp.status === 429) throw new AssistenteError('limite');
	if (resp.status === 401) throw new AssistenteError('sessao');
	if (!resp.ok || !resp.body) throw new AssistenteError('erro');

	const reader = resp.body.getReader();
	const decoder = new TextDecoder();
	let buffer = '';
	let eventoTipo = '';
	let dataStr = '';

	function despachar() {
		if (!dataStr) return;
		try {
			const obj = JSON.parse(dataStr);
			if (eventoTipo === 'texto' || obj.evento === 'texto' || (obj.texto != null && !eventoTipo)) {
				onEvento({ tipo: 'texto', texto: String(obj.texto ?? '') });
			} else if (eventoTipo === 'fim' || obj.evento === 'fim' || obj.id != null) {
				onEvento({
					tipo: 'fim',
					resposta: {
						id: String(obj.id ?? ''),
						respondida: !!obj.respondida,
						texto: String(obj.texto ?? ''),
						passos: Array.isArray(obj.passos) ? obj.passos.map(String) : [],
						acao: obj.acao ? { id: String(obj.acao.id ?? obj.acao), rotulo: String(obj.acao.rotulo ?? obj.acao.label ?? 'Abrir') } : null,
						situacao: obj.situacao ? String(obj.situacao) : 'respondida',
						removeu: !!obj.removeu,
					},
				});
			}
		} catch { /* ignora evento malformado */ }
		eventoTipo = '';
		dataStr = '';
	}

	while (true) {
		const { done, value } = await reader.read();
		if (done) break;
		buffer += decoder.decode(value, { stream: true });
		const partes = buffer.split('\n');
		buffer = partes.pop() ?? '';
		for (const linha of partes) {
			const l = linha.replace(/\r$/, '');
			if (l === '') { despachar(); continue; }
			if (l.startsWith('event:')) { eventoTipo = l.slice(6).trim(); continue; }
			if (l.startsWith('data:')) { dataStr += l.slice(5).trim(); continue; }
		}
	}
	despachar();
}

/** Carrega sugestões de pergunta: rpc sugestoes_assistente(tela). */
export async function carregarSugestoes(tela: string): Promise<{ tela: string[]; frequentes: string[] }> {
	if (!supabase) return { tela: [], frequentes: [] };
	try {
		const { data, error } = await supabase.rpc('sugestoes_assistente', { tela });
		if (error || !data) return { tela: [], frequentes: [] };
		const r = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | null;
		const telaArr = Array.isArray(r?.tela) ? (r!.tela as unknown[]).map(String).slice(0, 5) : [];
		const freqArr = Array.isArray(r?.frequentes) ? (r!.frequentes as unknown[]).map(String).slice(0, 5) : [];
		return { tela: telaArr, frequentes: freqArr };
	} catch { return { tela: [], frequentes: [] }; }
}

/** Avalia uma resposta (1 = 👍, -1 = 👎) com motivo opcional. */
export async function avaliarResposta(idPergunta: string, nota: 1 | -1, motivo?: string): Promise<void> {
	if (!supabase) return;
	try {
		await supabase.rpc('avaliar_resposta', { id_pergunta: idPergunta, nota, motivo: motivo ?? null });
	} catch { /* ignora */ }
}

/** Abre um chamado a partir do Assistente. POST { acao: 'chamado', ... } → { motivo, assunto, conversa }. */
export async function falarComSuporte(params: {
	pergunta: string;
	tela: string;
	tela_nome: string;
	historico: MsgHistorico[];
	avaliacao: string | null;
}): Promise<{ motivo: string; assunto: string; conversa: string }> {
	if (!supabase) throw new AssistenteError('erro');
	const baseUrl = import.meta.env.VITE_SUPABASE_URL;
	if (!baseUrl) throw new AssistenteError('erro');
	const { data: sessao } = await supabase.auth.getSession();
	const token = sessao.session?.access_token;
	if (!token) throw new AssistenteError('sessao');

	const resp = await fetch(`${baseUrl}/functions/v1/assistente`, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			Authorization: `Bearer ${token}`,
		},
		body: JSON.stringify({
			acao: 'chamado',
			pergunta: params.pergunta,
			tela: params.tela,
			tela_nome: params.tela_nome,
			historico: params.historico,
			avaliacao: params.avaliacao,
		}),
	});

	if (resp.status === 401) throw new AssistenteError('sessao');
	if (!resp.ok) throw new AssistenteError('erro');
	const data = await resp.json();
	return {
		motivo: String(data.motivo ?? 'outro'),
		assunto: String(data.assunto ?? params.pergunta.slice(0, 120)),
		conversa: String(data.conversa ?? ''),
	};
}
