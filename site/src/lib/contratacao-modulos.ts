// Módulos da Contratação (Console › Empresas e /empresa/contratacao): o que a tela mostra e o que grava em
// empresa_modulos. Agente de voz e Speech Analytics entraram no SQL 87; o módulo speech_analytics liga também
// voz_config.speech_analytics (o que a VM de voz lê), por gatilho no banco.
import { MODULOS_INFO } from '@/lib/empresa-helpers';

export type ModulosState = {
	orquestracao: boolean; jornada: boolean; mensageria: boolean; api: boolean; enriquecimento: boolean;
	/** Agente de voz MotorCX (SQL 56): libera Agente de voz, Ligações e Telefonia em Agente Voz/CX. */
	agente_voz: boolean;
	/** Speech Analytics (SQL 87): libera a área e liga voz_config.speech_analytics (o que a VM lê). */
	speech_analytics: boolean;
};

export const MODULOS_VAZIO: ModulosState = { orquestracao: false, jornada: false, mensageria: false, api: false, enriquecimento: false, agente_voz: false, speech_analytics: false };

/** Os dois módulos de voz da Contratação (mesmo texto no cadastro novo e na edição). */
export const MODULOS_VOZ = (['agente_voz', 'speech_analytics'] as const).map(id => {
	const m = MODULOS_INFO.find(x => x.id === id);
	return { id, nome: m?.nome ?? id, desc: m?.desc ?? '' };
});

/** Linhas de empresa_modulos gravadas pela Contratação (upsert por empresa_id, modulo). */
export function linhasModulos(empresaId: string, modulos: ModulosState, canais: string[]): Record<string, unknown>[] {
	return [
		{ empresa_id: empresaId, modulo: 'orquestracao', ativo: !!modulos.orquestracao, canais: [] },
		{ empresa_id: empresaId, modulo: 'jornada', ativo: !!modulos.jornada, canais: [] },
		{ empresa_id: empresaId, modulo: 'mensageria', ativo: !!modulos.mensageria, canais },
		{ empresa_id: empresaId, modulo: 'api', ativo: !!modulos.api, canais: [] },
		{ empresa_id: empresaId, modulo: 'enriquecimento', ativo: !!modulos.enriquecimento, canais: [] },
		{ empresa_id: empresaId, modulo: 'agente_voz', ativo: !!modulos.agente_voz, canais: [] },
		{ empresa_id: empresaId, modulo: 'speech_analytics', ativo: !!modulos.speech_analytics, canais: [] },
	];
}

/** Nomes dos módulos ligados, na ordem da tela (resumo e revisão). */
export function nomesModulos(modulos: ModulosState): string[] {
	return [
		modulos.orquestracao && 'Orquestração',
		modulos.jornada && 'Jornada',
		modulos.mensageria && 'Mensageria',
		modulos.api && 'API',
		modulos.enriquecimento && 'Enriquecimento',
		modulos.agente_voz && 'Agente de voz',
		modulos.speech_analytics && 'Speech Analytics',
	].filter(Boolean) as string[];
}
