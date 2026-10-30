import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { HelpCircle } from 'lucide-react';
import { useMotorAuth } from '@/components/auth-provider';
import { friendlyError, numberBR, supabase, type Row } from '@/lib/supabase';

/** Bloco "Por que hoje": barras horizontais da view motivos_hoje da carteira.
 *  Clicar num motivo abre a aba Clientes já filtrada por ele. */
export function PorQueHoje() {
	const { empresa, credor } = useMotorAuth();
	const navigate = useNavigate();
	const [rows, setRows] = useState<Row[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState('');

	useEffect(() => {
		if (!supabase || !empresa || !credor) { setRows([]); setLoading(false); return; }
		let active = true;
		setLoading(true); setError('');
		supabase
			.from('motivos_hoje')
			.select('motivo,clientes')
			.eq('empresa_id', empresa.id)
			.eq('credor_id', credor.id)
			.then(({ data, error }) => {
				if (!active) return;
				if (error) { setError(friendlyError()); setRows([]); }
				else setRows((data ?? []).sort((a, b) => Number(b.clientes ?? 0) - Number(a.clientes ?? 0)));
				setLoading(false);
			});
		return () => { active = false; };
	}, [empresa?.id, credor?.id]);

	if (!empresa || !credor) return null;
	if (loading) return null;
	if (error || rows.length === 0) return null;

	const max = Math.max(...rows.map(r => Number(r.clientes) || 0), 1);
	const total = rows.reduce((n, r) => n + (Number(r.clientes) || 0), 0);

	return (
		<section className="rounded-xl border border-[#dfe8ea] bg-white p-6 sm:p-8">
			<div className="mb-5 flex items-center gap-3">
				<HelpCircle size={19} className="text-[#0F4C5C]" />
				<div>
					<h2 className="font-semibold">Por que hoje</h2>
					<p className="text-xs text-slate-500">Por que cada cliente está ou não na lista de hoje · {numberBR(total)} clientes</p>
				</div>
			</div>
			<div className="space-y-2">
				{rows.map(r => {
					const motivo = String(r.motivo ?? '');
					const comAcao = motivo.toLowerCase().startsWith('com ação');
					const v = Number(r.clientes) || 0;
					return (
						<button
							key={motivo}
							onClick={() => navigate(`/clientes?motivo=${encodeURIComponent(motivo)}`)}
							className="group flex w-full items-center gap-3 rounded-lg border border-[#e9eff0] px-4 py-3 text-left transition-colors hover:bg-[#f6fafb]"
						>
							<span
								className="h-2.5 w-2.5 shrink-0 rounded-full"
								style={{ backgroundColor: comAcao ? '#2E7D32' : '#e9a23b' }}
							/>
							<span className="min-w-0 flex-1 truncate text-sm font-medium text-slate-700">{motivo}</span>
							<span className="hidden h-2.5 w-32 overflow-hidden rounded-full bg-[#eef2f3] sm:block">
								<span
									className="block h-full rounded-full"
									style={{ width: `${(v / max) * 100}%`, backgroundColor: comAcao ? '#2E7D32' : '#e9a23b' }}
								/>
							</span>
							<span
								className="w-14 text-right text-sm font-semibold"
								style={{ color: comAcao ? '#2E7D32' : '#9a631b' }}
							>
								{numberBR(v)}
							</span>
						</button>
					);
				})}
			</div>
			<p className="mt-3 text-xs text-slate-400">Clique num motivo para ver os clientes na aba Clientes.</p>
		</section>
	);
}
