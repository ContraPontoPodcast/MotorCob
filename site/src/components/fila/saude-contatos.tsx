import { Activity } from 'lucide-react';
import { numberBR } from '@/lib/supabase';
import { canalEmpresaNome, contatosForaCanal, type RetornoCanalResumo } from '@/lib/canal-retorno';

/** Card "Saúde dos contatos" na Lista do dia — lê execucoes.resumo.retorno_canal. */
export function SaudeContatos({ retorno }: { retorno: RetornoCanalResumo | null | undefined }) {
	if (!retorno || !retorno.resumo) return null;
	const canais = Object.entries(retorno.resumo).filter(([, s]) => contatosForaCanal(s) > 0 || Number(retorno.oxigenados?.[Object.keys(retorno.resumo!)[0]] ?? 0) > 0);
	const oxigenados = retorno.oxigenados ?? {};
	const totalOxigenados = Object.values(oxigenados).reduce((n, v) => n + Number(v || 0), 0);

	const entradas = Object.entries(retorno.resumo).map(([canal, s]) => ({
		canal,
		nome: canalEmpresaNome(canal),
		fora: contatosForaCanal(s),
		oxigenados: Number(oxigenados[canal] ?? 0),
	})).filter(e => e.fora > 0 || e.oxigenados > 0);

	if (entradas.length === 0 && totalOxigenados === 0) return null;

	return (
		<section className="rounded-xl border border-[#dee7e9] bg-white p-6 sm:p-8">
			<div className="mb-5 flex items-center gap-3">
				<div className="grid h-10 w-10 place-items-center rounded-lg bg-[#eaf2f3] text-[#0F4C5C]"><Activity size={20} /></div>
				<div>
					<p className="text-[11px] font-bold uppercase tracking-[.13em] text-slate-400">SAÚDE DOS CONTATOS</p>
					<h2 className="text-lg font-semibold">Saúde dos contatos</h2>
				</div>
			</div>
			<p className="mb-5 max-w-2xl text-sm leading-relaxed text-slate-500">Quando um número volta inexistente, em pausa ou bloqueado, o MotorCX passa para o próximo contato do cliente.</p>
			<div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
				{entradas.map(e => (
					<div key={e.canal} className="rounded-lg border border-[#e2eaec] bg-[#f7fafb] p-4">
						<p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{e.nome}</p>
						<p className="mt-2 text-2xl font-semibold text-[#0F4C5C]">{numberBR(e.fora)} <span className="text-xs font-normal text-slate-400">contatos fora do canal</span></p>
						{e.oxigenados > 0 && <p className="mt-1 text-sm font-semibold text-[#2E7D32]">{numberBR(e.oxigenados)} clientes oxigenados hoje</p>}
					</div>
				))}
			</div>
		</section>
	);
}
