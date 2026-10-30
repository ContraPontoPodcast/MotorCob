import { useState } from 'react';
import { Link } from 'react-router';
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover';
import { CANAL_NOME, faseCor, faseLabel, type PersonaResumo } from '@/lib/personas';
import { numberBR } from '@/lib/supabase';

/** Popover de personas para os chips ★/☆ da Orquestração.
 *  Abre ao passar o mouse (desktop) ou tocar (mobile). */
export function PersonaCanalPopover({ personas, children }: { personas: PersonaResumo[]; children: React.ReactNode }) {
	const [open, setOpen] = useState(false);
	const [timer, setTimer] = useState<number | null>(null);

	function clearT() { if (timer != null) { window.clearTimeout(timer); setTimer(null); } }
	function scheduleOpen() { clearT(); const t = window.setTimeout(() => setOpen(true), 120); setTimer(t); }
	function scheduleClose() { clearT(); const t = window.setTimeout(() => setOpen(false), 160); setTimer(t); }

	const top = [...personas].sort((a, b) => b.clientes - a.clientes).slice(0, 5);

	return (
		<Popover open={open} onOpenChange={setOpen}>
			<span
				className="inline-flex"
				onMouseEnter={scheduleOpen}
				onMouseLeave={scheduleClose}
				onFocus={() => { clearT(); setOpen(true); }}
				onBlur={scheduleClose}
				onClick={() => setOpen(v => !v)}
			>
				<PopoverAnchor asChild>{children as React.ReactElement}</PopoverAnchor>
			</span>
			<PopoverContent align="center" sideOffset={6} className="w-72 max-w-[calc(100vw-1.5rem)] p-0">
				<div className="border-b border-[#ecf0f1] px-3 py-2">
					<p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Personas desta carteira</p>
				</div>
				{top.length === 0 ? (
					<p className="px-3 py-3 text-xs text-slate-500">Sem personas formadas ainda.</p>
				) : (
					<ul className="divide-y divide-[#ecf0f1]">
						{top.map(p => (
							<li key={p.nome} className="px-3 py-2">
								<div className="flex items-center justify-between gap-2">
									<span className="truncate text-xs font-semibold text-[#163943]">{p.nome}</span>
									<span className="shrink-0 text-[10px] text-slate-400">{numberBR(p.clientes)} clientes</span>
								</div>
								<div className="mt-1 flex items-center gap-2 text-[11px]">
									<span className="text-slate-500">
										<span className="font-bold text-[#e9a23b]">★</span> {p.canal1 ? (CANAL_NOME[p.canal1] ?? p.canal1) : '—'}
										<span className="mx-1 text-slate-300">·</span>
										<span className="font-bold text-slate-400">☆</span> {p.canal2 ? (CANAL_NOME[p.canal2] ?? p.canal2) : '—'}
									</span>
								</div>
								<span className="mt-1 inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[9px] font-bold" style={{ backgroundColor: `${faseCor(p.fase)}1a`, color: faseCor(p.fase) }}>
									{faseLabel(p.fase)}
								</span>
							</li>
						))}
					</ul>
				)}
				<div className="border-t border-[#ecf0f1] px-3 py-2">
					<Link to="/personas" className="text-[11px] font-semibold text-[#0F4C5C] hover:underline">Ver Personas</Link>
				</div>
			</PopoverContent>
		</Popover>
	);
}
