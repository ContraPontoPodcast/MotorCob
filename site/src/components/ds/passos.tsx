// Passos: etapas numa linha compacta (Simulado → Teste → Real; Escolher → Conferir → Enviar).
import { Fragment } from 'react';
import { Check } from 'lucide-react';

export function Passos({ passos, atual, rotulo = 'Etapas' }: { passos: string[]; atual: number; rotulo?: string }) {
	return (
		<ol aria-label={rotulo} className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1.5 text-[12.5px] font-semibold">
			{passos.map((p, i) => {
				const feito = i < atual, agora = i === atual;
				return (
					<Fragment key={p}>
						{i > 0 && <li aria-hidden="true" className="h-px w-4 bg-[var(--base-borda)]" />}
						<li aria-current={agora ? 'step' : undefined} className="inline-flex items-center gap-1.5" style={{ color: agora ? 'var(--base-texto)' : feito ? 'var(--base-texto-2)' : 'var(--base-texto-3)' }}>
							<span className="grid h-[18px] w-[18px] shrink-0 place-items-center rounded-full text-[10.5px]"
								style={{ backgroundColor: feito ? 'var(--estado-pronto)' : agora ? 'var(--destaque)' : 'var(--base-fill)', color: feito ? 'var(--base-cartao)' : agora ? 'var(--destaque-texto)' : 'var(--base-texto-3)' }}>
								{feito ? <Check size={11} strokeWidth={3} aria-hidden="true" /> : i + 1}
							</span>
							{p}
						</li>
					</Fragment>
				);
			})}
		</ol>
	);
}
