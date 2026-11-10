// Preços editáveis (SQL 92): quais itens a Contratação mostra por módulo, quais têm franquia, o pré-preenchimento
// (o preço vigente da empresa; sem ele, o de tabela; a franquia da empresa; sem ela, a padrão) e os modelos de preço
// de cada item. Usado em Empresa › Contratação (cartão Preços) e no Console (Produtos e Margem › IA).
import type { Row } from '@/lib/supabase';

export type ModeloPreco = 'flat' | 'faixa' | 'progressivo' | 'mensalidade';

/** Itens em que a franquia vale na cobrança (= public.itens_com_franquia(), SQL 92 e 93). */
export const ITENS_COM_FRANQUIA = ['ia_creditos', 'ia_treino_voz', 'ia_treino_texto', 'voz_licenca_robo'] as const;

/** Itens cujo preço da empresa só se grava pela licença (SQL 93: salvar_licencas_voz), fora do cartão Preços. */
export const ITENS_SO_LICENCA = ['voz_licenca_robo'] as const;

/** Itens fora da Mensageria e da IA com tabela e mínimo em Console › Produtos (salvar_preco_padrao). */
export const ITENS_PRECO_PADRAO = ['contratos', 'jornada_clientes', 'voz_plataforma', 'gestao_tronco_sip'] as const;

export function temFranquia(codigo: unknown): boolean {
	return (ITENS_COM_FRANQUIA as readonly string[]).includes(String(codigo ?? ''));
}

/** Itens do Agente de voz e do Speech Analytics da Contratação: os do módulo ligado, na ordem do catálogo (sem os da licença). */
export function itensDosModulos(itens: Row[], modulos: { agente_voz: boolean; speech_analytics: boolean }): { agente_voz: Row[]; speech_analytics: Row[] } {
	const ordenar = (a: Row, b: Row) => Number(a.ordem ?? 100) - Number(b.ordem ?? 100) || String(a.codigo).localeCompare(String(b.codigo));
	const soLicenca = ITENS_SO_LICENCA as readonly string[];
	const doModulo = (m: string) => itens.filter(i => String(i.modulo ?? '') === m && i.preco_de == null && i.ativo !== false
		&& !soLicenca.includes(String(i.codigo ?? ''))).sort(ordenar);
	return {
		agente_voz: modulos.agente_voz ? doModulo('agente_voz') : [],
		speech_analytics: modulos.speech_analytics ? doModulo('speech_analytics') : [],
	};
}

/** Número para o campo, no formato brasileiro ("1,5"); vazio quando não há valor. */
export function numeroCampo(v: unknown): string {
	if (v == null || v === '') return '';
	const n = Number(v);
	if (!Number.isFinite(n)) return '';
	return n.toLocaleString('pt-BR', { maximumFractionDigits: 5, useGrouping: false });
}

/** Preço inicial do campo: o vigente da empresa; sem preço, o de tabela (pré-preenchido). */
export function precoInicial(vigente: unknown, tabela: unknown): string {
	if (vigente != null && vigente !== '') return numeroCampo(vigente);
	return Number(tabela ?? 0) > 0 ? numeroCampo(tabela) : '';
}

/** Franquia que vale: a da empresa na vigência; sem ela, a padrão do item. */
export function franquiaEfetiva(vigente: Row | null | undefined, item: Row): number {
	if (vigente && vigente.franquia != null) return Number(vigente.franquia);
	return Number(item.franquia_padrao ?? 0);
}

/** Franquia digitada ("1.000", "1000"): inteiro de 0 a 1.000.000; inválida = null. */
export function franquiaDigitada(v: string): number | null {
	const s = String(v ?? '').trim().replace(/\./g, '');
	if (!/^\d{1,7}$/.test(s)) return null;
	const n = Number(s);
	return n <= 1_000_000 ? n : null;
}

/** O que vai para salvar_preco_franquia: null quando o campo continua com a franquia que já vale (mantém/herda). */
export function franquiaParaSalvar(digitada: string, efetiva: number): number | null {
	const n = franquiaDigitada(digitada);
	return n == null || n === efetiva ? null : n;
}

/** Modelos de preço do item: IA é sempre por unidade (nunca mensalidade); motor e voz fora da IA aceitam mensalidade. */
export function modelosDoItem(item: Row, isMotor: boolean): ModeloPreco[] {
	if (item.eh_ia) return ['flat', 'faixa', 'progressivo'];
	if (isMotor || String(item.modulo ?? '') === 'agente_voz') return ['flat', 'faixa', 'progressivo', 'mensalidade'];
	return ['flat', 'faixa', 'progressivo'];
}

/** Modelo inicial do editor: o vigente; sem preço, mensalidade para item cobrado por mês, senão preço único. */
export function modeloInicial(item: Row, vigenteModelo: unknown, isMotor: boolean): ModeloPreco {
	const permitidos = modelosDoItem(item, isMotor);
	const v = String(vigenteModelo ?? '') as ModeloPreco;
	if (permitidos.includes(v)) return v;
	return String(item.unidade ?? '') === 'mês' && permitidos.includes('mensalidade') ? 'mensalidade' : 'flat';
}
