import type { Definicao, TravasFase } from '@/lib/estrategia';

/** Fases do motor com os nomes do glossário (nunca LOC, G1, RE, T1). */
export const FASES = [
	{ id: 'localizacao', nome: 'Cliente novo' },
	{ id: 'cpc', nome: 'CPC · sem resposta' },
	{ id: 'giro', nome: 'Não CPC' },
	{ id: 'preventivo', nome: 'Acordo · antes do vencimento' },
	{ id: 'quebra', nome: 'Acordo · parcela vencida' },
] as const;

export type FaseId = (typeof FASES)[number]['id'];

/** Canais com nome e cor (mesmo padrão do Desenho da Esteira). */
export const CANAIS_FASE = [
	{ id: 'whatsapp', label: 'WhatsApp', cor: '#1F8A4C' },
	{ id: 'rcs', label: 'RCS', cor: '#3B5BA9' },
	{ id: 'sms', label: 'SMS', cor: '#7A4FB0' },
	{ id: 'email', label: 'E-mail', cor: '#A2552B' },
	{ id: 'agente_voz', label: 'Agente virtual', cor: '#0E7C86' },
	{ id: 'discador', label: 'Discador', cor: '#475569' },
] as const;

/** Travas que aceitam valor próprio por fase. */
export const TRAVAS_FASE = [
	{ id: 'intervalo_horas', label: 'Intervalo entre ações', sufixo: 'h', min: 0, max: 240, tipo: 'number' as const },
	{ id: 'acoes_dia', label: 'Ações por dia', sufixo: '', min: 0, max: 50, tipo: 'number' as const },
	{ id: 'horario', label: 'Horário', sufixo: '', min: 0, max: 0, tipo: 'horario' as const },
];

/** Travas só da estratégia (vale para todas as fases). */
export const TRAVAS_ESTRATEGIA = [
	{ id: 'domingo', label: 'Acionar no domingo', tipo: 'bool' as const },
	{ id: 'por_semana', label: 'Máximo por semana', tipo: 'number' as const, min: 0, max: 21 },
	{ id: 'discador', label: 'Discador liberado', tipo: 'bool' as const },
	{ id: 'nao_perturbe', label: 'Respeitar Não Perturbe', tipo: 'bool' as const },
	{ id: 'freio_whatsapp', label: 'Freio do WhatsApp', tipo: 'number' as const, min: 0, max: 100, sufixo: '%' },
];

export function getFaseObj(def: Definicao, fase: FaseId) {
	return fase === 'localizacao' ? def.localizacao : fase === 'cpc' ? def.cpc : fase === 'giro' ? def.giro : fase === 'preventivo' ? def.preventivo : def.quebra;
}

export function getTravasFase(def: Definicao, fase: FaseId): TravasFase | undefined {
	return getFaseObj(def, fase)?.travas;
}
