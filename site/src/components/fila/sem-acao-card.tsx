import { Link } from 'react-router';
import { AlertTriangle, CalendarClock } from 'lucide-react';
import { dateBR, numberBR } from '@/lib/supabase';
import { diaSemanaDataBR, semAcaoEntradas, type Execucao, type ProximoDia } from '@/lib/execucao';

function passosChips(passos: Record<string, number>) {
	return Object.entries(passos)
		.filter(([, n]) => Number(n) > 0)
		.map(([k, n]) => `${k} · ${numberBR(n)}`)
		.join(', ');
}

/** Cartão âmbar quando há execução mas nenhum cliente com ação na data. */
export function SemAcaoCard({ execucao, date }: { execucao: Execucao; date: string }) {
	const entradas = semAcaoEntradas(execucao.resumo?.sem_acao).filter(e => e.key !== 'com_acao');
	const proximos = execucao.resumo?.proximos ?? [];
	const proxima = proximos.find(p => Number(p.clientes) > 0) ?? null;
	const max = Math.max(...entradas.map(e => e.valor), 1);

	return (
		<div className="rounded-xl border border-amber-200 bg-[#fff7e8] p-6 sm:p-8">
			<div className="mb-5 flex items-center gap-3">
				<AlertTriangle size={19} className="text-[#9a631b]" />
				<div>
					<h2 className="font-semibold text-[#80520f]">Nenhum cliente com ação em {dateBR(date)}</h2>
					<p className="text-xs text-[#9a631b]/80">Veja por que a carteira ficou sem ação hoje e quando sai a próxima lista.</p>
				</div>
			</div>

			{entradas.length > 0 ? (
				<div className="space-y-2">
					{entradas.map(e => (
						<div key={e.key} className="flex items-center gap-3">
							<span className="w-56 shrink-0 truncate text-sm text-slate-600">{e.label}</span>
							<span className="hidden h-2.5 flex-1 overflow-hidden rounded-full bg-amber-100 sm:block">
								<span className="block h-full rounded-full bg-[#e9a23b]" style={{ width: `${(e.valor / max) * 100}%` }} />
							</span>
							<span className="w-16 text-right text-sm font-semibold text-[#80520f]">{numberBR(e.valor)}</span>
						</div>
					))}
				</div>
			) : (
				<p className="text-sm text-slate-500">Sem detalhes de motivos para esta data.</p>
			)}

			{proxima ? (
				<div className="mt-6 flex items-start gap-3 rounded-lg border border-amber-300 bg-white/70 px-4 py-3">
					<CalendarClock size={18} className="mt-0.5 shrink-0 text-[#0F4C5C]" />
					<p className="text-sm text-slate-700">
						<span className="font-semibold text-[#0F4C5C]">Próxima lista:</span> {diaSemanaDataBR(proxima.data)} com cerca de <strong>{numberBR(proxima.clientes)}</strong> clientes
						{passosChips(proxima.passos ?? {}) ? <span className="text-slate-500"> ({passosChips(proxima.passos ?? {})})</span> : null}
					</p>
				</div>
			) : (
				<div className="mt-6 rounded-lg border border-amber-300 bg-white/70 px-4 py-3 text-sm text-slate-600">
					Nenhuma ação prevista nos próximos 7 dias: <Link to="/orquestracao" className="font-semibold text-[#0F4C5C] hover:underline">confira a esteira</Link>.
				</div>
			)}
		</div>
	);
}

export type { ProximoDia };
