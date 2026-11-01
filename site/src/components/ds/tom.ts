// Tons de estado do design system. Só tokens do tema (valem no claro e no escuro).
export type Tom = 'ok' | 'info' | 'atencao' | 'erro' | 'neutro' | 'destaque';

export const TOM: Record<Tom, { fundo: string; texto: string; ponto: string }> = {
	ok: { fundo: 'var(--estado-pronto-fundo)', texto: 'var(--estado-pronto-texto)', ponto: 'var(--estado-pronto)' },
	info: { fundo: 'var(--estado-info-fundo)', texto: 'var(--estado-info)', ponto: 'var(--estado-info)' },
	atencao: { fundo: 'var(--estado-atencao-fundo)', texto: 'var(--estado-atencao-texto)', ponto: 'var(--estado-atencao)' },
	erro: { fundo: 'var(--estado-erro-fundo)', texto: 'var(--estado-erro-texto)', ponto: 'var(--estado-erro)' },
	neutro: { fundo: 'var(--base-fill)', texto: 'var(--base-texto-2)', ponto: 'var(--base-texto-3)' },
	destaque: { fundo: 'var(--destaque-suave)', texto: 'var(--destaque)', ponto: 'var(--destaque)' },
};

/** Sombra padrão de cartão (borda de 1px + sombra leve), só com token. */
export const SOMBRA = '0 0 0 1px var(--base-borda), 0 2px 12px rgba(0,0,0,.04)';
export const SOMBRA_ALTA = '0 18px 48px rgba(0,0,0,.28)';

/** Avisa em desenvolvimento quando uma regra do DS é quebrada (nunca em produção). */
export function avisarRegra(msg: string) {
	if (import.meta.env.DEV) console.warn(`[ds] ${msg}`);
}
