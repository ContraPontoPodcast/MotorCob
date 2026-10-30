/** Moldura dos passos da Orquestração — cinco cartões clicáveis no topo da tela.
 *  Cada cartão mostra número, pergunta, título e uma linha de estado.
 *  Passo atual: borda var(--destaque). Passo completo: círculo com ✓. */

export type PassoId = 'carteira' | 'segmentos' | 'estagios' | 'regua' | 'revisar';

export type PassoState = {
	id: PassoId;
	numero: number;
	pergunta: string;
	titulo: string;
	estado: string;
	completo: boolean;
};

export function PassosBar({ passo, steps, onStep }: {
	passo: PassoId;
	steps: PassoState[];
	onStep: (id: PassoId) => void;
}) {
	return (
		<div className="grid grid-cols-2 gap-2 lg:grid-cols-5">
			{steps.map(s => {
				const active = passo === s.id;
				return (
					<button
						key={s.id}
						type="button"
						onClick={() => onStep(s.id)}
						aria-current={active ? 'step' : undefined}
						className={`flex items-start gap-2.5 rounded-xl border p-3 text-left transition ${active ? 'bg-[var(--destaque-suave)]' : 'bg-[var(--base-cartao)] hover:bg-[var(--base-fill)]'}`}
						style={active ? { borderColor: 'var(--destaque)' } : { borderColor: 'var(--base-borda)' }}
					>
						<span
							className={`grid h-6 w-6 shrink-0 place-items-center rounded-full text-xs font-bold transition ${s.completo ? 'bg-[var(--estado-pronto)] text-white' : active ? 'text-[var(--destaque-texto)]' : 'bg-[var(--base-fill)] text-[var(--base-texto-2)]'}`}
							style={active && !s.completo ? { backgroundColor: 'var(--destaque)' } : undefined}
						>
							{s.completo ? '✓' : s.numero}
						</span>
						<div className="min-w-0">
							<p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--base-texto-3)]">{s.pergunta}</p>
							<p className="truncate text-[13px] font-bold text-[var(--base-texto)]">{s.titulo}</p>
							<p className="truncate text-[11px] text-[var(--base-texto-2)]">{s.estado}</p>
						</div>
					</button>
				);
			})}
		</div>
	);
}
