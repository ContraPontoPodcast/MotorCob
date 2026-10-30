import { FRENTES, type FrenteId } from '@/lib/frentes';

/** Selos de frente de uma empresa: COB (#C9A35A) / CLI (#8E8E93), sigla em maiúsculo. */
export function FrenteBadges({ frentes }: { frentes: FrenteId[] | undefined | null }) {
	if (!frentes || frentes.length === 0) return null;
	return (
		<div className="flex flex-wrap gap-1">
			{frentes.map(f => {
				const info = FRENTES[f] ?? FRENTES.motorcob;
				return (
					<span key={f} className="rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white" style={{ backgroundColor: info.cor }}>
						{info.sigla}
					</span>
				);
			})}
		</div>
	);
}
