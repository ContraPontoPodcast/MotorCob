import { useState } from 'react';
import { CalendarDays, ChevronDown } from 'lucide-react';
import { numberBR } from '@/lib/supabase';
import { diaSemanaDataBR, type ProximoDia } from '@/lib/execucao';

/** Bloco recolhível "Próximos dias": uma linha por item de proximos. */
export function ProximosDias({ dias }: { dias: ProximoDia[] }) {
	const [aberto, setAberto] = useState(false);
	if (!dias || dias.length === 0) return null;

	return (
		<section className="rounded-xl border border-[#dfe8ea] bg-white p-6 sm:p-8">
			<button
				type="button"
				onClick={() => setAberto(v => !v)}
				className="flex w-full items-center gap-3 text-left"
			>
				<CalendarDays size={19} className="text-[#0F4C5C]" />
				<div className="flex-1">
					<h2 className="font-semibold">Próximos dias</h2>
					<p className="text-xs text-slate-500">Estimativa de quando sai a próxima lista</p>
				</div>
				<ChevronDown size={18} className={`text-slate-400 transition-transform ${aberto ? 'rotate-180' : ''}`} />
			</button>

			{aberto && (
				<div className="mt-5 divide-y divide-[#eef3f4]">
					{dias.map(d => {
						const semAcoes = d.sem_acoes || Number(d.clientes) === 0;
						const passos = Object.entries(d.passos ?? {}).filter(([, n]) => Number(n) > 0);
						return (
							<div key={d.data} className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3">
								<span className={`w-44 shrink-0 text-sm font-medium ${semAcoes ? 'text-slate-400' : 'text-slate-700'}`}>
									{diaSemanaDataBR(d.data)}
								</span>
								<span className={`w-24 text-sm font-semibold ${semAcoes ? 'text-slate-400' : 'text-[#0F4C5C]'}`}>
									{semAcoes ? 'sem ações' : `${numberBR(d.clientes)} clientes`}
								</span>
								<span className="flex flex-wrap gap-1.5">
									{semAcoes ? (
										<span className="text-xs text-slate-400">domingo/feriado</span>
									) : passos.length === 0 ? (
										<span className="text-xs text-slate-400">—</span>
									) : passos.map(([k, n]) => (
										<span key={k} className="rounded-full bg-[#eaf2f3] px-2.5 py-0.5 text-[11px] font-medium text-[#0F4C5C]">
											{k} · {numberBR(n)}
										</span>
									))}
								</span>
							</div>
						);
					})}
					<p className="pt-4 text-xs leading-relaxed text-slate-400">
						Estimativa pela esteira de hoje; muda com os retornos (CPC) e com novas cargas. A lista de cada dia sai sozinha a partir das 06:00.
					</p>
				</div>
			)}
		</section>
	);
}
