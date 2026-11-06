// Regras da tela Canais (Empresa e Carteira) separadas da tela, para testar sem navegador.
// O banco aceita só os 6 canais de acionamento em `canais_empresa` e `credor_canais`
// (CHECK em 20260929000001_estrategias.sql e 20261127000001_produtos_rotas_administrativo.sql).
// "Enriquecimento (bureau)" é uma AÇÃO da régua (está em `canalOpts` para o editor de estratégia),
// não um canal com horário/capacidade/custo: o custo do bureau vem do item contratado.
import { canalOpts } from '@/lib/estrategia';
import { lerNumeroBR } from '@/lib/condicoes';

export const CANAIS_CONFIGURAVEIS = ['whatsapp', 'rcs', 'agente_voz', 'discador', 'sms', 'email'] as const;
export const canaisConfiguraveis = canalOpts.filter(c => (CANAIS_CONFIGURAVEIS as readonly string[]).includes(c.id));

/** Chave do upsert de `credor_canais` (= a chave primária da tabela). */
export const CONFLITO_CREDOR_CANAIS = 'credor_id,canal';
/** Chave do upsert de `canais_empresa` (= a chave primária da tabela). */
export const CONFLITO_CANAIS_EMPRESA = 'empresa_id,canal';

export const VOZ = new Set(['agente_voz', 'discador']);

/** O banco guarda `respeitar_nao_perturbe` como boolean (nulo = padrão); a tela usa '', 'sim', 'nao'. */
export function naoPerturbeParaTela(v: unknown): '' | 'sim' | 'nao' {
	if (v === true || v === 'sim' || v === 'true') return 'sim';
	if (v === false || v === 'nao' || v === 'false') return 'nao';
	return '';
}
export function naoPerturbeParaBanco(v: unknown): boolean | null {
	const t = naoPerturbeParaTela(v);
	return t === 'sim' ? true : t === 'nao' ? false : null;
}

export type CanalTela = {
	canal: string; ativo: boolean; janela_inicio: string | null; janela_fim: string | null;
	sabado: boolean; capacidade_dia: number | null; custo: number | null;
	tentativas_dia: number | null; respeitar_nao_perturbe: '' | 'sim' | 'nao' | null;
	numeros_por_cliente: number | null;
	produto_padrao: string | null;
};

/** Linhas do upsert de `canais_empresa`: só os 6 canais que o banco aceita. */
export function linhasEmpresa(empresaId: string, rows: Record<string, CanalTela | undefined>, padrao: Record<string, CanalTela>) {
	return canaisConfiguraveis.map(c => {
		const r = rows[c.id] ?? padrao[c.id];
		return {
			empresa_id: empresaId, canal: c.id, ativo: r.ativo,
			janela_inicio: r.janela_inicio || null, janela_fim: r.janela_fim || null,
			sabado: r.sabado, capacidade_dia: r.capacidade_dia || null,
			custo: r.custo || null, tentativas_dia: VOZ.has(c.id) ? (r.tentativas_dia || null) : null,
			respeitar_nao_perturbe: naoPerturbeParaBanco(r.respeitar_nao_perturbe),
			numeros_por_cliente: r.numeros_por_cliente === 1 ? null : (r.numeros_por_cliente ?? null),
		};
	});
}

/**
 * Linhas do upsert de `credor_canais`. Inclui o canal que TINHA ajuste ao carregar mesmo se agora ficou
 * sem nenhum ("voltar ao da empresa" em tudo): grava `{}` para a carteira voltar a herdar.
 */
export function linhasCarteira(
	empresaId: string, credorId: string,
	rows: Record<string, CanalTela | undefined>, padrao: Record<string, CanalTela>,
	sobrescritos: Record<string, string[]>, carregados: Record<string, string[]>,
) {
	return canaisConfiguraveis.map(c => {
		const sob = sobrescritos[c.id] ?? [];
		const r = rows[c.id] ?? padrao[c.id];
		const ajustes: Record<string, unknown> = {};
		for (const k of sob) {
			if (k === 'ativo') ajustes.ativo = r.ativo;
			else if (k === 'janela_inicio') ajustes.janela_inicio = r.janela_inicio || null;
			else if (k === 'janela_fim') ajustes.janela_fim = r.janela_fim || null;
			else if (k === 'sabado') ajustes.sabado = r.sabado;
			else if (k === 'capacidade_dia') ajustes.capacidade_dia = r.capacidade_dia || null;
			else if (k === 'tentativas_dia') ajustes.tentativas_dia = VOZ.has(c.id) ? (r.tentativas_dia || null) : null;
			else if (k === 'respeitar_nao_perturbe') ajustes.respeitar_nao_perturbe = naoPerturbeParaBanco(r.respeitar_nao_perturbe);
			else if (k === 'produto_padrao') ajustes.produto_padrao = r.produto_padrao || null;
		}
		// ajuste nulo = herda da empresa (a view faz coalesce), então não grava a chave
		for (const k of Object.keys(ajustes)) if (ajustes[k] === null) delete ajustes[k];
		return { empresa_id: empresaId, credor_id: credorId, canal: c.id, ajustes };
	}).filter(u => Object.keys(u.ajustes).length > 0 || (carregados[u.canal] ?? []).length > 0);
}

/** Custo digitado em pt-BR ("0,06", "R$ 1,50", "0.06") → número; vazio = sem custo. */
export function lerCusto(texto: string): { valor: number | null } | { erro: string } {
	if (!texto.trim()) return { valor: null };
	const r = lerNumeroBR(texto);
	if ('erro' in r) return r;
	if (r.valor < 0) return { erro: 'O custo não pode ser negativo.' };
	return { valor: r.valor };
}
