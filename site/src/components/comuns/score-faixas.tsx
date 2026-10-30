// Faixas do Score de Entrega — cores próprias por faixa (variáveis --score-*),
// nunca verde/amarelo/vermelho (essas são de pronto, alerta e erro).
// Usado na prévia, na campanha, na Economia do Score e no Console.

export const SCORE_FAIXAS = [
	{ id: 'alto', label: 'Alto', cor: 'var(--score-alto)', texto: 'var(--score-alto-texto)' },
	{ id: 'medio', label: 'Médio', cor: 'var(--score-medio)', texto: 'var(--score-medio-texto)' },
	{ id: 'baixo', label: 'Baixo', cor: 'var(--score-baixo)', texto: 'var(--score-baixo-texto)' },
	{ id: 'sem', label: 'Sem histórico', cor: 'var(--score-sem)', texto: 'var(--score-sem-texto)' },
] as const;

export type ScoreFaixaId = (typeof SCORE_FAIXAS)[number]['id'];

/** Barra dividida pelas 4 faixas, proporcional aos totais. */
export function ScoreFaixasBar({ totais, total }: { totais: Record<string, number>; total: number }) {
	const t = total > 0 ? total : 1;
	return (
		<div className="flex h-3 w-full overflow-hidden rounded-full bg-[#F5F5F7]">
			{SCORE_FAIXAS.map(x => {
				const v = Number(totais[x.id] ?? 0);
				const w = (v / t) * 100;
				return w > 0 ? <div key={x.id} style={{ width: `${w}%`, backgroundColor: x.cor }} title={`${x.label}: ${v.toLocaleString('pt-BR')}`} /> : null;
			})}
		</div>
	);
}

/** Selo (pill) colorido de uma faixa. */
export function ScoreFaixaPill({ id, children }: { id: string; children?: React.ReactNode }) {
	const f = SCORE_FAIXAS.find(x => x.id === id);
	if (!f) return null;
	return (
		<span className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-semibold" style={{ backgroundColor: f.cor, color: f.texto }}>
			{children ?? f.label}
		</span>
	);
}
