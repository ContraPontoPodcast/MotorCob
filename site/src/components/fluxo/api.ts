// Acesso a dados do Fluxo do agente (SQL 58, 59 e 66). Só leitura com RLS e escrita por RPC; o simulador e o
// roleplay pela Edge Function simular_fluxo_voz, com o login de quem pede. Nada de service_role no site.
// A mesma interface tem a implementação de demonstração (fixturas.ts), usada só no modo de desenvolvimento.
import type { SupabaseClient } from '@supabase/supabase-js';
import { nomeAnexo, type Definicao, type MetricaBloco, type SituacaoVersao, type TipoAgente } from '@/lib/fluxo';

export interface FluxoRow { id: number; empresa_id: number; credor_id: number | null; nome: string; tipo_agente: TipoAgente; modelo_origem: string | null; roteiro_origem_id: number | null; criado_em: string }
export interface VersaoRow {
	id: number; fluxo_id: number; empresa_id: number; credor_id: number | null; versao: number; situacao: SituacaoVersao;
	definicao: Definicao; motivo: string | null; parecer: string | null; criado_em: string; atualizado_em: string | null;
	aprovado_em: string | null; em_uso_em: string | null; arquivado_em: string | null; enviado_aprovacao_em?: string | null;
}
export interface PedidoRow {
	id: number; empresa_id: number; credor_id: number | null; texto: string; anexos: string[]; tipo: 'ia' | 'equipe'; fluxo_id: number | null;
	versao_origem_id: number | null; versao_gerada_id: number | null; situacao: 'pendente' | 'gerando' | 'gerado' | 'com_erros' | 'na_equipe' | 'cancelado';
	chamado_id: number | null; respostas: Record<string, string> | null; resultado: ResultadoPedido | null; pedido_em: string; gerado_em: string | null;
	geracoes: number; prazo_em: string | null; cancelado_em?: string | null;
}
/** resultado_pedido_voz_ok: só estas chaves, listas curtas de texto (o formato de cada item é livre na geração). */
export interface ResultadoPedido { entendi?: unknown[]; suposicoes?: unknown[]; perguntas?: unknown[]; mudancas?: unknown[]; erros?: unknown[]; tentativas?: number }
export interface ModeloRow { codigo: string; nome: string; tipo_agente: TipoAgente; descricao: string | null }
export interface IntencaoRow { codigo: string; nome: string; descricao: string | null; ativa: boolean }
export interface ConectorRow {
	id: number; empresa_id: number; nome: string; finalidade: string; metodo: string; url: string; autenticacao: string; segredo_ref: string | null;
	cabecalhos_fixos: Record<string, string>; mapa_entrada: { origem: string; destino: string; onde: string }[];
	mapa_saida: { origem: string; destino: string; grava: string; valores?: Record<string, string> }[]; timeout_ms: number; tentativas: number;
	idempotencia: boolean; em_falha: 'ramo' | 'alternativa_carteira' | 'transferir'; situacao: 'rascunho' | 'ativo' | 'pausado'; versao: number;
	teste_pedido_em: string | null; testado_em: string | null; teste_ok: boolean | null; credencial_trocada_em: string | null; atualizado_em: string;
}
export interface SaudeRow { conector_id: number; volume_24h: number; p50_ms: number | null; p95_ms: number | null; erro_pct: number | null; ultima: string | null }
export interface ChamadaCrmRow {
	id: number; conector_id: number | null; id_chamada: string | null; id_cliente: string | null; fluxo_versao_id: number | null; bloco_id: string | null;
	ocorrido_em: string; tentativa: number; http_status: number | null; classe: string; latencia_ms: number | null; resultado_codigo: string | null;
	ofertas_acima_alcada: number; usou_alternativa: boolean;
}
export interface AlcadaRow { id: number; credor_id: number | null; desconto_max_pct: number; parcelas_max: number; parcela_min: number; entrada_min: number; validade_dias: number; ofertas_padrao: { id: string; parcelas: number; desconto_pct: number; entrada?: number }[]; vigente_desde: string; vigente_ate: string | null }
export interface RespostaRow { id: number; fluxo_versao_id: number; bloco_id: string; pergunta: string; resposta: string; revisado_em: string | null }
export interface CasoRow { id: number; fluxo_id: number; nome: string; falas: string[]; caminho_esperado: string[]; resultado_esperado: string | null; conectores_falham: number[]; ativo: boolean }
export interface CasoResultadoRow { caso_id: number; fluxo_versao_id: number; passou: boolean; caminho_obtido: string[]; resultado_obtido: string | null; executado_em: string }
export interface IntencaoDiaRow { bloco_id: string; intencao: string; n: number; fluxo_versao_id: number }
export interface PersonaRow { id: number; empresa_id: number | null; codigo: string; nome: string; perfil: string; objetivo: string; dificuldade: number; resultados_aceitos: string[]; travas_esperadas: string[]; ativa: boolean }
export interface LoteRow { id: number; fluxo_versao_id: number; personas: number[]; quantidade: number; situacao: 'pendente' | 'rodando' | 'concluido' | 'erro'; pedido_em: string; concluido_em: string | null; conversas: number; tokens: number }
export interface ResultadoLoteRow { persona_id: number; persona: string | null; perfil: string | null; conversas: number; passaram: number; acordos: number; taxa_acordo: number | null; opt_out: number; transferidas: number; turnos_medio: number | null; reprovadas: number[] | null }
export interface ConversaRow { id: number; lote_id: number; persona_id: number | null; resultado: string; passou: boolean; caminho: string[]; travas: string[]; fechou_acordo: boolean; turnos: number; transcricao: { quem: 'agente' | 'pessoa'; texto: string; bloco?: string | null }[] | null; caso_teste_id: number | null }
export interface FalaSimulada { texto: string; bloco: string | null; modo: string | null }
export interface TurnoSimulado {
	pessoa: string | null; falas: FalaSimulada[]; bloco: string | null; caminho: string[];
	intencao: { intencao: string; confianca: string; entidades?: string[] } | null;
	conectores: { conector: number; nome?: string; classe: string; status?: number | null; ms?: number | null; codigo?: string | null; descartadas_alcada?: number }[];
	travas: string[]; devolucoes: { motivo: string; para: string }[]; fim: string | null;
}
export type CenarioConector = 'sucesso' | 'tempo' | '401';
export interface Simulacao { turnos: TurnoSimulado[]; caminho: string[]; resultado: string | null; encerrada: boolean }

export interface FluxoApi {
	fluxos(empresa: number): Promise<{ fluxos: FluxoRow[]; versoes: VersaoRow[] }>;
	versao(id: number): Promise<VersaoRow | null>;
	versoesDoFluxo(fluxo: number): Promise<VersaoRow[]>;
	fluxo(id: number): Promise<FluxoRow | null>;
	modelos(): Promise<ModeloRow[]>;
	intencoes(): Promise<IntencaoRow[]>;
	pedidos(empresa: number): Promise<PedidoRow[]>;
	pedido(id: number): Promise<PedidoRow | null>;
	conectores(empresa: number): Promise<ConectorRow[]>;
	saude(empresa: number): Promise<SaudeRow[]>;
	chamadasCrm(empresa: number, filtro?: { versao?: number; desde?: string; limite?: number }): Promise<ChamadaCrmRow[]>;
	hosts(empresa: number): Promise<string[]>;
	cuidaConectores(empresa: number): Promise<boolean>;
	alcada(empresa: number, credor: number | null): Promise<AlcadaRow | null>;
	pendencias(empresa: number, credor: number | null, d: Definicao): Promise<string[]>;
	bloqueios(versao: number): Promise<string[]>;
	avisos(versao: number): Promise<string[]>;
	salvarFluxo(a: { empresa: number; credor: number | null; nome: string | null; tipo: TipoAgente | null; definicao: Definicao; versao: number | null }): Promise<number>;
	enviar(versao: number): Promise<void>;
	aprovar(versao: number, parecer: string | null): Promise<void>;
	usar(versao: number): Promise<void>;
	voltar(fluxo: number, versao: number, motivo: string): Promise<void>;
	duplicar(versao: number, credor: number | null, nome: string | null): Promise<number>;
	criarDeModelo(empresa: number, modelo: string, credor: number | null, nome: string | null): Promise<number>;
	respostas(versao: number): Promise<RespostaRow[]>;
	salvarResposta(versao: number, bloco: string, pergunta: string, resposta: string, id: number | null): Promise<void>;
	revisarResposta(id: number): Promise<void>;
	apagarResposta(id: number): Promise<void>;
	casos(fluxo: number): Promise<CasoRow[]>;
	resultadosCasos(versao: number): Promise<CasoResultadoRow[]>;
	salvarCaso(a: { fluxo: number; nome: string; falas: string[]; caminho: string[]; resultado: string | null; falhar: number[] }): Promise<void>;
	apagarCaso(id: number): Promise<void>;
	/** cenarios (SQL 66): resposta escolhida para cada conector simulado. */
	simular(versao: number, falas: string[], falhar: number[], cenarios?: Record<string, CenarioConector>): Promise<Simulacao>;
	/** "Ouvir a voz" (SQL 66): prévia em áudio de uma fala, com a voz da empresa. Nada fica guardado. */
	ouvir(versao: number, texto: string): Promise<{ audio: string; mime: string }>;
	/** Descartar o pedido em texto (SQL 66, cancelar_pedido_fluxo_voz): o rascunho gerado sai; o pedido fica. */
	cancelarPedido(pedido: number): Promise<void>;
	rodarCasos(versao: number): Promise<{ id: number; nome: string; passou: boolean }[]>;
	metricas(versoes: number[], desde: string): Promise<(MetricaBloco & { fluxo_versao_id: number; dia: string })[]>;
	intencoesDia(versoes: number[], desde: string): Promise<IntencaoDiaRow[]>;
	personas(): Promise<PersonaRow[]>;
	lotes(versao: number): Promise<LoteRow[]>;
	resultadoLote(lote: number): Promise<ResultadoLoteRow[]>;
	conversas(lote: number): Promise<ConversaRow[]>;
	rodarRoleplay(versao: number, personas: number[], n: number): Promise<number>;
	paraCaso(conversa: number): Promise<number>;
	pedirFluxo(a: { tipo: 'ia' | 'equipe'; empresa: number; credor: number | null; texto: string; anexos: string[]; versaoOrigem: number | null }): Promise<number>;
	responderPedido(pedido: number, respostas: Record<string, string>): Promise<void>;
	anexar(slug: string, arquivo: File): Promise<string>;
	salvarAlcada(a: { empresa: number; credor: number | null; desconto: number; parcelas: number; parcelaMin: number; entradaMin: number; validade: number; desde: string | null }): Promise<void>;
	salvarConector(empresa: number, ajustes: Record<string, unknown>, id: number | null): Promise<number>;
	testarConector(id: number): Promise<void>;
	situacaoConector(id: number, situacao: 'ativo' | 'pausado'): Promise<void>;
	trocarCredencial(id: number): Promise<string>;
	liberarHost(empresa: number, host: string): Promise<void>;
	revogarHost(empresa: number, host: string): Promise<void>;
}

const COLS_VERSAO = 'id,fluxo_id,empresa_id,credor_id,versao,situacao,definicao,motivo,parecer,criado_em,atualizado_em,aprovado_em,em_uso_em,arquivado_em,enviado_aprovacao_em';
const COLS_VERSAO_58 = 'id,fluxo_id,empresa_id,credor_id,versao,situacao,definicao,motivo,parecer,criado_em,atualizado_em,aprovado_em,em_uso_em,arquivado_em';
const COLS_CONECTOR = 'id,empresa_id,nome,finalidade,metodo,url,autenticacao,segredo_ref,cabecalhos_fixos,mapa_entrada,mapa_saida,timeout_ms,tentativas,idempotencia,em_falha,situacao,versao,teste_pedido_em,testado_em,teste_ok,credencial_trocada_em,atualizado_em';

type Resp<T> = { data: T | null; error: { message: string; code?: string } | null };
function ok<T>(r: Resp<T>, padrao?: T): T {
	if (r.error) throw new Error(r.error.message);
	return (r.data ?? padrao) as T;
}
/** Banco sem o SQL 66 (coluna enviado_aprovacao_em): lê sem ela. */
const semColuna65 = (e: { message?: string; code?: string } | null) => !!e && (e.code === '42703' || /enviado_aprovacao_em/.test(e.message ?? ''));

/** Implementação real (Supabase, chave anon, login de quem usa; a RLS decide o que aparece). */
export function apiSupabase(sb: SupabaseClient, funcao = 'simular_fluxo_voz'): FluxoApi {
	const rpc = async <T>(nome: string, args: Record<string, unknown>) => ok<T>((await sb.rpc(nome, args)) as Resp<T>);
	const versoes = async (consulta: (cols: string) => PromiseLike<unknown>) => {
		let r = (await consulta(COLS_VERSAO)) as Resp<VersaoRow[]>;
		if (semColuna65(r.error)) r = (await consulta(COLS_VERSAO_58)) as Resp<VersaoRow[]>;
		return ok(r, []);
	};
	const tabV = () => sb.from('voz_fluxo_versoes');
	const invocar = async <T>(body: Record<string, unknown>): Promise<T> => {
		const { data, error } = await sb.functions.invoke(funcao, { body });
		if (error) {
			let msg = 'O simulador não respondeu agora.';
			try { const j = await (error as { context?: Response }).context?.json(); if (j?.erro) msg = String(j.erro) + (Array.isArray(j.erros) && j.erros.length ? `: ${j.erros.join(', ')}` : ''); } catch { /* sem corpo */ }
			throw new Error(msg);
		}
		return data as T;
	};
	return {
		async fluxos(empresa) {
			const [f, v] = await Promise.all([
				sb.from('voz_fluxos').select('id,empresa_id,credor_id,nome,tipo_agente,modelo_origem,roteiro_origem_id,criado_em').eq('empresa_id', empresa).order('nome'),
				versoes(c => tabV().select(c).eq('empresa_id', empresa).order('versao', { ascending: false })),
			]);
			return { fluxos: ok(f as Resp<FluxoRow[]>, []), versoes: v };
		},
		async versao(id) { return (await versoes(c => tabV().select(c).eq('id', id)))[0] ?? null; },
		async versoesDoFluxo(fluxo) { return versoes(c => tabV().select(c).eq('fluxo_id', fluxo).order('versao', { ascending: false })); },
		async fluxo(id) { return ok((await sb.from('voz_fluxos').select('id,empresa_id,credor_id,nome,tipo_agente,modelo_origem,roteiro_origem_id,criado_em').eq('id', id).maybeSingle()) as Resp<FluxoRow>, null as unknown as FluxoRow) ?? null; },
		async modelos() { return ok((await sb.from('voz_fluxo_modelos').select('codigo,nome,tipo_agente,descricao').order('nome')) as Resp<ModeloRow[]>, []); },
		async intencoes() { return ok((await sb.from('voz_intencoes').select('codigo,nome,descricao,ativa').order('nome')) as Resp<IntencaoRow[]>, []); },
		async pedidos(empresa) { return ok((await sb.from('voz_fluxo_pedidos').select('*').eq('empresa_id', empresa).order('pedido_em', { ascending: false }).limit(50)) as Resp<PedidoRow[]>, []); },
		async pedido(id) { return ok((await sb.from('voz_fluxo_pedidos').select('*').eq('id', id).maybeSingle()) as Resp<PedidoRow>, null as unknown as PedidoRow) ?? null; },
		async conectores(empresa) { return ok((await sb.from('crm_conectores').select(COLS_CONECTOR).eq('empresa_id', empresa).order('id')) as Resp<ConectorRow[]>, []); },
		async saude(empresa) { return ok((await sb.from('crm_conector_saude').select('conector_id,volume_24h,p50_ms,p95_ms,erro_pct,ultima').eq('empresa_id', empresa)) as Resp<SaudeRow[]>, []); },
		async chamadasCrm(empresa, f = {}) {
			let q = sb.from('crm_chamadas').select('id,conector_id,id_chamada,id_cliente,fluxo_versao_id,bloco_id,ocorrido_em,tentativa,http_status,classe,latencia_ms,resultado_codigo,ofertas_acima_alcada,usou_alternativa').eq('empresa_id', empresa);
			if (f.versao) q = q.eq('fluxo_versao_id', f.versao);
			if (f.desde) q = q.gte('ocorrido_em', f.desde);
			return ok((await q.order('ocorrido_em', { ascending: false }).limit(f.limite ?? 50)) as Resp<ChamadaCrmRow[]>, []);
		},
		async hosts(empresa) { return ok((await sb.from('crm_hosts_permitidos').select('host').eq('empresa_id', empresa).order('host')) as Resp<{ host: string }[]>, []).map(h => h.host); },
		async cuidaConectores(empresa) { try { return (await rpc<boolean>('cuida_conectores', { eid: empresa })) === true; } catch { return false; } },
		async alcada(empresa, credor) {
			const r = await rpc<AlcadaRow | AlcadaRow[] | null>('alcada_voz_vigente', { empresa, credor });
			const a = Array.isArray(r) ? r[0] : r;
			return a && a.id ? a : null;
		},
		async pendencias(empresa, credor, d) { return (await rpc<string[] | null>('fluxo_voz_pendencias', { empresa, credor, d })) ?? []; },
		async bloqueios(versao) { return (await rpc<string[] | null>('fluxo_voz_bloqueios', { versao })) ?? []; },
		async avisos(versao) { try { return (await rpc<string[] | null>('fluxo_voz_avisos', { versao })) ?? []; } catch { return []; } },
		async salvarFluxo(a) { return Number(await rpc('salvar_fluxo_voz', { empresa: a.empresa, credor: a.credor, nome: a.nome, tipo_agente: a.tipo, definicao: a.definicao, versao: a.versao })); },
		async enviar(versao) { await rpc('enviar_fluxo_voz_aprovacao', { versao }); },
		async aprovar(versao, parecer) { await rpc('aprovar_fluxo_voz', { versao, parecer }); },
		async usar(versao) { await rpc('usar_fluxo_voz', { versao }); },
		async voltar(fluxo, versao, motivo) { await rpc('voltar_versao_fluxo_voz', { fluxo, versao, motivo }); },
		async duplicar(versao, credor, nome) { return Number(await rpc('duplicar_fluxo_voz', { versao, credor_destino: credor, nome })); },
		async criarDeModelo(empresa, modelo, credor, nome) { return Number(await rpc('criar_fluxo_de_modelo', { empresa, modelo, credor, nome })); },
		async respostas(versao) { return ok((await sb.from('voz_base_respostas').select('id,fluxo_versao_id,bloco_id,pergunta,resposta,revisado_em').eq('fluxo_versao_id', versao).order('id')) as Resp<RespostaRow[]>, []); },
		async salvarResposta(versao, bloco, pergunta, resposta, id) { await rpc('salvar_resposta_fluxo_voz', { versao, bloco, pergunta, resposta, resposta_id: id }); },
		async revisarResposta(id) { await rpc('revisar_resposta_fluxo_voz', { resposta_id: id }); },
		async apagarResposta(id) { await rpc('apagar_resposta_fluxo_voz', { resposta_id: id }); },
		async casos(fluxo) { return ok((await sb.from('voz_fluxo_casos_teste').select('id,fluxo_id,nome,falas,caminho_esperado,resultado_esperado,conectores_falham,ativo').eq('fluxo_id', fluxo).order('id')) as Resp<CasoRow[]>, []); },
		async resultadosCasos(versao) { return ok((await sb.from('voz_fluxo_casos_resultados').select('caso_id,fluxo_versao_id,passou,caminho_obtido,resultado_obtido,executado_em').eq('fluxo_versao_id', versao)) as Resp<CasoResultadoRow[]>, []); },
		async salvarCaso(a) { await rpc('salvar_caso_teste_fluxo_voz', { fluxo: a.fluxo, nome: a.nome, falas: a.falas, caminho_esperado: a.caminho, resultado_esperado: a.resultado, conectores_falham: a.falhar, caso: null }); },
		async apagarCaso(id) { await rpc('apagar_caso_teste_fluxo_voz', { caso: id }); },
		async simular(versao, falas, falhar, cenarios = {}) { return invocar<Simulacao>({ acao: 'simular', versao, falas, falhar, ...(Object.keys(cenarios).length ? { cenarios } : {}) }); },
		async ouvir(versao, texto) { return invocar<{ audio: string; mime: string }>({ acao: 'ouvir', versao, texto }); },
		async cancelarPedido(pedido) { await rpc('cancelar_pedido_fluxo_voz', { pedido }); },
		async rodarCasos(versao) { return (await invocar<{ casos: { id: number; nome: string; passou: boolean }[] }>({ acao: 'rodar_casos', versao })).casos ?? []; },
		async metricas(vs, desde) {
			if (!vs.length) return [];
			return ok((await sb.from('voz_fluxo_metricas_dia').select('fluxo_versao_id,dia,bloco_id,chegaram,saidas,turnos_medio').in('fluxo_versao_id', vs).gte('dia', desde)) as Resp<(MetricaBloco & { fluxo_versao_id: number; dia: string })[]>, []);
		},
		async intencoesDia(vs, desde) {
			if (!vs.length) return [];
			return ok((await sb.from('voz_fluxo_intencoes_dia').select('fluxo_versao_id,bloco_id,intencao,n').in('fluxo_versao_id', vs).gte('dia', desde)) as Resp<IntencaoDiaRow[]>, []);
		},
		async personas() { return ok((await sb.from('roleplay_personas').select('id,empresa_id,codigo,nome,perfil,objetivo,dificuldade,resultados_aceitos,travas_esperadas,ativa').eq('ativa', true).order('dificuldade').order('nome')) as Resp<PersonaRow[]>, []); },
		async lotes(versao) { return ok((await sb.from('roleplay_lotes').select('id,fluxo_versao_id,personas,quantidade,situacao,pedido_em,concluido_em,conversas,tokens').eq('fluxo_versao_id', versao).order('pedido_em', { ascending: false }).limit(10)) as Resp<LoteRow[]>, []); },
		async resultadoLote(lote) { return (await rpc<ResultadoLoteRow[] | null>('resultado_roleplay_voz', { lote })) ?? []; },
		async conversas(lote) { return ok((await sb.from('roleplay_conversas').select('id,lote_id,persona_id,resultado,passou,caminho,travas,fechou_acordo,turnos,transcricao,caso_teste_id').eq('lote_id', lote).order('id')) as Resp<ConversaRow[]>, []); },
		async rodarRoleplay(versao, personas, n) { return Number((await invocar<{ lote: number }>({ acao: 'roleplay', versao, personas, n })).lote); },
		async paraCaso(conversa) { return Number(await rpc('roleplay_para_caso_teste', { conversa_id: conversa })); },
		async pedirFluxo(a) { return Number(await rpc(a.tipo === 'ia' ? 'pedir_fluxo_voz' : 'pedir_fluxo_equipe', { empresa: a.empresa, credor: a.credor, texto: a.texto, anexos: a.anexos, versao_origem: a.versaoOrigem })); },
		async responderPedido(pedido, respostas) { await rpc('responder_pedido_fluxo_voz', { pedido, respostas }); },
		async anexar(slug, arquivo) {
			const dia = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
			const sufixo = Math.random().toString(36).replace(/[^a-z]/g, '').slice(0, 6) || 'anexo';
			const caminho = `${slug}/fluxo/${dia}/${nomeAnexo(arquivo.name, sufixo)}`;
			const { error } = await sb.storage.from('entradas').upload(caminho, arquivo, { upsert: false, contentType: arquivo.type || 'application/octet-stream' });
			if (error) throw new Error(error.message);
			return `entradas/${caminho}`;
		},
		async salvarAlcada(a) { await rpc('salvar_alcada_voz', { empresa: a.empresa, credor: a.credor, desconto_max_pct: a.desconto, parcelas_max: a.parcelas, parcela_min: a.parcelaMin, entrada_min: a.entradaMin, validade_dias: a.validade, ofertas_padrao: [], vigente_desde: a.desde }); },
		async salvarConector(empresa, ajustes, id) { return Number(await rpc('salvar_conector_crm', { empresa, ajustes, conector: id })); },
		async testarConector(id) { await rpc('testar_conector_crm', { conector: id }); },
		async situacaoConector(id, situacao) { await rpc('mudar_situacao_conector_crm', { conector: id, situacao }); },
		async trocarCredencial(id) { return String(await rpc('trocar_credencial_conector', { conector: id })); },
		async liberarHost(empresa, host) { await rpc('liberar_host_crm', { empresa, host }); },
		async revogarHost(empresa, host) { await rpc('revogar_host_crm', { empresa, host }); },
	};
}
