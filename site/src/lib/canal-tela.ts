// Tela do canal (/canais/:canal; SPEC Canais §1.1, §3.2, §4.2, §4.3 e §5; PRs 6 e 7; protótipo aprovado em 08/11).
// Regras da tela separadas do componente, para testar sem navegador: quais seções cada canal mostra, quais campos cada
// seção grava, o resumo de uma frase de cada seção e a herança empresa → carteira no salvar por seção.
import { canalLabel } from '@/lib/estrategia';
import { naoPerturbeParaBanco, naoPerturbeParaTela, QUEM_ENVIA_CANAIS, VOZ, type CanalTela } from '@/lib/canais-config';
import { inexistenteOptsPorCanal, regrasPadrao, type RegrasRetorno, type TipoRetornoCanal } from '@/lib/canal-retorno';
import type { QuemExecuta } from '@/lib/estado-canais';

export type SecaoId = 'envio' | 'mensagens' | 'lista' | 'retorno' | 'custos' | 'conexao';

export const SECOES: Record<SecaoId, { titulo: string; descricao: string; salvar: string | null }> = {
	envio: { titulo: 'Regras de envio', descricao: 'Quando e como o canal aciona o cliente.', salvar: 'Salvar regras de envio' },
	mensagens: { titulo: 'Mensagens', descricao: 'Os textos que este canal usa.', salvar: null },
	lista: { titulo: 'Lista e retorno do fornecedor', descricao: 'O arquivo que a sua empresa baixa e o arquivo que volta.', salvar: null },
	retorno: { titulo: 'Retorno do canal', descricao: 'O que fazer quando a mensagem não chega (número inexistente, sem conta, bounce).', salvar: 'Salvar retorno do canal' },
	custos: { titulo: 'Custos e limites', descricao: 'Quanto custa e até onde pode ir por dia.', salvar: 'Salvar custos e limites' },
	conexao: { titulo: 'Conexão (técnico)', descricao: 'Fornecedor, rota e modo de envio. Quem altera é a equipe MotorCX.', salvar: null },
};

/** "Ver" nas seções que não têm formulário próprio (mensagens abre o editor de frases; lista, o mapeamento). */
export function rotuloAbrir(s: SecaoId): string {
	return s === 'mensagens' || s === 'lista' ? 'Ver' : 'Editar';
}

/** Quem executa o canal, pela regra do banco (estado_canais, SQL 84): digital = quem_envia salvo ou MotorCX no que a
 *  Mensageria contratada cobre; voz = Voz MotorCX com o módulo agente_voz, senão lista. */
export function quemExecuta(canal: string, quemEnvia: string | null | undefined, canaisMensageria: readonly string[], agenteVoz: boolean): QuemExecuta {
	if (VOZ.has(canal)) return agenteVoz ? 'voz_motorcx' : 'lista';
	if (quemEnvia === 'lista' || quemEnvia === 'motorcx') return quemEnvia;
	return canaisMensageria.includes(canal) ? 'motorcx' : 'lista';
}

/** O canal tem textos? WhatsApp/RCS (templates), SMS e agente de voz (frases), e-mail só quando o MotorCX envia
 *  (o texto do e-mail é o modelo da Mensageria). Discador não usa mensagem. */
export function temMensagens(canal: string, quem: QuemExecuta): boolean {
	if (canal === 'discador') return false;
	if (canal === 'email') return quem === 'motorcx';
	return true;
}

/** Seções do canal (matriz do SPEC §4.3). Na carteira só o que a carteira muda ou guarda: regras de envio, lista e
 *  retorno (o mapeamento e as regras de retorno são por carteira) e custos (capacidade). */
export function secoesDoCanal(canal: string, quem: QuemExecuta, carteira: boolean): SecaoId[] {
	const s: SecaoId[] = ['envio'];
	if (!carteira && temMensagens(canal, quem)) s.push('mensagens');
	if (quem === 'lista') s.push('lista');
	if (quem !== 'voz_motorcx') s.push('retorno');
	s.push('custos');
	if (!carteira && quem === 'motorcx') s.push('conexao');
	return s;
}

/** Campos de canais_empresa / credor_canais que cada seção grava. O resto da linha não é tocado no salvar da seção. */
export const CAMPOS_SECAO = {
	envio: ['ativo', 'janela_inicio', 'janela_fim', 'sabado', 'tentativas_dia', 'respeitar_nao_perturbe', 'numeros_por_cliente', 'quem_envia', 'produto_padrao'],
	custos: ['capacidade_dia', 'custo'],
} as const satisfies Record<'envio' | 'custos', readonly (keyof CanalTela)[]>;

/**
 * Todo campo e função da configuração de hoje (components/canais/canais.tsx até o PR 6) e onde ficou. O teste confere
 * que cada campo de `CanalTela` está aqui e que cada destino é uma seção (ou o topo) que existe para algum canal.
 */
export const DE_PARA: { item: string; onde: SecaoId | 'topo' | 'visao_geral' | 'frases' }[] = [
	{ item: 'Ligado (empresa)', onde: 'topo' },
	{ item: 'Ligado nesta carteira', onde: 'envio' },
	{ item: 'Horário seg–sex (início e fim)', onde: 'envio' },
	{ item: 'Aciona no sábado', onde: 'envio' },
	{ item: 'Tentativas por dia (voz)', onde: 'envio' },
	{ item: 'Respeitar Não Perturbe', onde: 'envio' },
	{ item: 'Números por cliente', onde: 'envio' },
	{ item: 'Quem envia (digitais)', onde: 'envio' },
	{ item: 'Produto padrão (carteira)', onde: 'envio' },
	{ item: 'Capacidade por dia', onde: 'custos' },
	{ item: 'Custo por ação', onde: 'custos' },
	{ item: 'Aba Modelos de mensagem', onde: 'mensagens' },
	{ item: 'Aba Fluxos (agente de voz)', onde: 'mensagens' },
	{ item: 'Seletor "Aplicar a" empresa / carteira e herança', onde: 'topo' },
	{ item: 'Voltar ao da empresa', onde: 'envio' },
	{ item: 'Importar playbook', onde: 'visao_geral' },
	{ item: 'Frases dos 6 canais (menu Frases)', onde: 'frases' },
];

/** Chave do canal nas regras e no retorno do fornecedor (credores.regras_retorno, canal_codigos): voz para os dois. */
export function canalRetorno(canal: string): string {
	return VOZ.has(canal) ? 'voz' : canal;
}
export function tipoRetorno(canal: string): TipoRetornoCanal {
	return `canal_${canalRetorno(canal)}` as TipoRetornoCanal;
}

/** Linha da tela quando o banco não tem nada salvo para o canal (o mesmo padrão da tela antiga). */
export function padraoCanal(canal: string): CanalTela {
	return {
		canal, ativo: true, janela_inicio: '08:00', janela_fim: '20:00', sabado: true, capacidade_dia: null, custo: null,
		tentativas_dia: VOZ.has(canal) ? 3 : null, respeitar_nao_perturbe: '', numeros_por_cliente: null, produto_padrao: null,
	};
}

/** Linha do banco (canais_empresa ou a view canais_credor) → linha da tela. */
export function lerLinha(canal: string, r: Record<string, unknown> | null | undefined): CanalTela {
	const p = padraoCanal(canal);
	if (!r) return p;
	return { ...p, ...(r as Partial<CanalTela>), canal, respeitar_nao_perturbe: naoPerturbeParaTela(r.respeitar_nao_perturbe) };
}

/** Campos da seção que o upsert de canais_empresa grava (só os da seção; o resto da linha fica como está). */
export function linhaEmpresaSecao(empresaId: string | number, canal: string, r: CanalTela, campos: readonly (keyof CanalTela)[]) {
	const out: Record<string, unknown> = { empresa_id: empresaId, canal };
	for (const k of campos) {
		if (k === 'ativo') continue; // Pausar / Retomar no topo
		if (k === 'produto_padrao') continue; // só na carteira
		if (k === 'janela_inicio' || k === 'janela_fim') out[k] = r[k] || null;
		else if (k === 'sabado') out.sabado = r.sabado;
		else if (k === 'capacidade_dia') out.capacidade_dia = r.capacidade_dia || null;
		else if (k === 'custo') out.custo = r.custo ?? null;
		else if (k === 'tentativas_dia') out.tentativas_dia = VOZ.has(canal) ? (r.tentativas_dia || null) : null;
		else if (k === 'respeitar_nao_perturbe') out.respeitar_nao_perturbe = naoPerturbeParaBanco(r.respeitar_nao_perturbe);
		else if (k === 'numeros_por_cliente') out.numeros_por_cliente = r.numeros_por_cliente === 1 ? null : (r.numeros_por_cliente ?? null);
		else if (k === 'quem_envia') { if (QUEM_ENVIA_CANAIS.has(canal) && r.quem_envia) out.quem_envia = r.quem_envia; }
	}
	return out;
}

/** O que a carteira pode mudar (gatilho validar_credor_canal). */
export const CAMPOS_CARTEIRA = ['ativo', 'janela_inicio', 'janela_fim', 'sabado', 'capacidade_dia', 'tentativas_dia', 'respeitar_nao_perturbe', 'produto_padrao'] as const;

function valorAjuste(canal: string, k: string, r: CanalTela): unknown {
	if (k === 'ativo') return r.ativo;
	if (k === 'janela_inicio' || k === 'janela_fim') return r[k] || null;
	if (k === 'sabado') return r.sabado;
	if (k === 'capacidade_dia') return r.capacidade_dia || null;
	if (k === 'tentativas_dia') return VOZ.has(canal) ? (r.tentativas_dia || null) : null;
	if (k === 'respeitar_nao_perturbe') return naoPerturbeParaBanco(r.respeitar_nao_perturbe);
	if (k === 'produto_padrao') return r.produto_padrao || null;
	return null;
}

/**
 * `ajustes` da carteira no salvar de UMA seção: o que a carteira já tinha fora da seção fica igual (valor da view
 * canais_credor, que é o ajuste quando a chave está em `sobrescritos`); dentro da seção, só os campos marcados como
 * "desta carteira". Ajuste nulo = herda da empresa (a chave sai).
 */
export function ajustesCarteiraSecao(
	canal: string, campos: readonly string[],
	salvo: CanalTela, sobSalvos: readonly string[], rascunho: CanalTela, sobRascunho: readonly string[],
): Record<string, unknown> {
	const out: Record<string, unknown> = {};
	for (const k of CAMPOS_CARTEIRA) {
		const naSecao = campos.includes(k);
		const fonte = naSecao ? rascunho : salvo;
		const sob = naSecao ? sobRascunho : sobSalvos;
		if (!sob.includes(k)) continue;
		const v = valorAjuste(canal, k, fonte);
		if (v !== null && v !== undefined) out[k] = v;
	}
	return out;
}

// ------------------------------------------------------------------ resumos de uma frase
const NP: Record<string, string> = { '': 'padrão', sim: 'respeita', nao: 'não respeita' };

export function resumoEnvio(canal: string, r: CanalTela, opc: { carteira: boolean; quem: QuemExecuta; aprovarLotes?: boolean | null }): string {
	const partes: string[] = [];
	if (opc.carteira && !r.ativo) partes.push('desligado nesta carteira');
	partes.push(`Seg–sex ${r.janela_inicio || '08:00'}–${r.janela_fim || '20:00'}`);
	partes.push(r.sabado ? 'sábado até 14:00' : 'sem sábado');
	if (VOZ.has(canal)) partes.push(`${r.tentativas_dia ?? 3} tentativas por dia`);
	if (!opc.carteira) {
		const n = r.numeros_por_cliente ?? 1;
		partes.push(n === 99 ? 'todos os números do cliente' : n === 1 ? '1 número por cliente' : `até ${n} números por cliente`);
	}
	partes.push(`Não Perturbe: ${NP[r.respeitar_nao_perturbe ?? ''] ?? 'padrão'}`);
	if (opc.carteira && r.produto_padrao) partes.push(`produto ${r.produto_padrao}`);
	if (!opc.carteira && opc.quem === 'motorcx' && opc.aprovarLotes != null) partes.push(opc.aprovarLotes ? 'lote aprovado antes de sair' : 'o lote sai sozinho');
	return partes.join(' · ');
}

const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2, maximumFractionDigits: 4 });
const int = new Intl.NumberFormat('pt-BR');

export function resumoCustos(r: CanalTela, opc: { carteira: boolean; centro?: string | null }): string {
	const partes: string[] = [];
	if (!opc.carteira) partes.push(r.custo != null ? `${brl.format(Number(r.custo))} por ação` : 'sem custo por ação');
	partes.push(r.capacidade_dia ? `até ${int.format(r.capacidade_dia)} por dia` : 'sem limite por dia');
	if (opc.centro !== undefined) partes.push(opc.centro ? `centro de custo “${opc.centro}”` : 'sem centro de custo');
	return partes.join(' · ');
}

/** Regras de retorno da carteira para o canal (vazio = sugestão MotorCX). */
export function resumoRetorno(canal: string, regras: RegrasRetorno | null | undefined): string {
	const c = canalRetorno(canal);
	const p = regrasPadrao(c);
	const r = { ...p, ...(regras ?? {}) };
	const ac = inexistenteOptsPorCanal[c]?.find(o => o.value === r.inexistente)?.label ?? '—';
	const partes = [`${c === 'email' ? 'Hard bounce' : 'Número inexistente'}: ${ac.toLowerCase()}`];
	if (r.temporarios_pausa) partes.push(`${r.temporarios_pausa} falhas seguidas pausam por ${r.dias_pausa ?? 30} dias`);
	else partes.push('falha temporária não pausa');
	if (r.limite_lote != null) partes.push(`arquivo com mais de ${Math.round(Number(r.limite_lote) * 100)}% de falha é do fornecedor`);
	return partes.join(' · ') + (regras && Object.keys(regras).length ? '' : ' (sugestão MotorCX)');
}

export function resumoLista(opc: { mapeado: boolean | null; arquivo?: string | null; semMapear: number; ultimaLista?: string | null }): string {
	const partes: string[] = [];
	partes.push(opc.ultimaLista ? `Última lista: ${opc.ultimaLista}` : 'Nenhuma lista gerada ainda');
	partes.push(opc.mapeado === null ? 'retorno ainda não chegou' : opc.mapeado ? 'colunas do retorno confirmadas' : 'colunas do retorno esperando você');
	partes.push(opc.semMapear ? `${opc.semMapear} ${opc.semMapear === 1 ? 'código' : 'códigos'} sem mapear` : 'nenhum código sem mapear');
	return partes.join(' · ');
}

export function nomeCanal(canal: string): string {
	return canalLabel[canal] ?? canal;
}
