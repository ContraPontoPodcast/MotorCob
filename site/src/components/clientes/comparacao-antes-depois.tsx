import { useEffect, useState } from 'react';
import { GitCompareArrows } from 'lucide-react';
import { carregarAntes, fetchContagens, limparAntes, type ContagemSnapshot } from '@/lib/reenquadramento';
import { numberBR } from '@/lib/supabase';
import { segmentoNome, type ClusterInfo } from '@/lib/clientes';

type Atual = { segmentos: Record<string, number>; personas: Record<string, number>; total: number };

export function ComparacaoAntesDepois({
	empresaId,
	credorId,
	clusters,
	trigger,
}: {
	empresaId: string;
	credorId: string;
	clusters: ClusterInfo[];
	trigger: number;
}) {
	const [antes, setAntes] = useState<ContagemSnapshot | null>(null);
	const [atual, setAtual] = useState<Atual | null>(null);
	const [loading, setLoading] = useState(false);

	useEffect(() => {
		const snap = carregarAntes(credorId);
		setAntes(snap);
		if (!snap) { setAtual(null); return; }
		let active = true;
		setLoading(true);
		fetchContagens(empresaId, credorId)
			.then((c) => { if (active) { setAtual(c); setLoading(false); } })
			.catch(() => { if (active) setLoading(false); });
		return () => { active = false; };
	}, [credorId, trigger]);

	if (!antes) return null;

	const segLinhas = unionKeys(antes.segmentos, atual?.segmentos ?? {})
		.map((k) => ({ label: segmentoNome(k || null, clusters), antes: antes.segmentos[k] ?? 0, atual: atual?.segmentos[k] ?? 0 }))
		.sort((a, b) => b.atual - a.atual || b.antes - a.antes);

	const perLinhas = unionKeys(antes.personas, atual?.personas ?? {})
		.map((k) => ({ label: k.trim() ? k : 'Sem persona', antes: antes.personas[k] ?? 0, atual: atual?.personas[k] ?? 0 }))
		.sort((a, b) => b.atual - a.atual || b.antes - a.antes);

	return (
		<section className="mb-8 rounded-xl border border-[#dfe8ea] bg-white p-5 sm:p-6">
			<div className="mb-4 flex flex-wrap items-center justify-between gap-3">
				<div className="flex items-center gap-2">
					<GitCompareArrows size={18} className="text-[#0F4C5C]" />
					<h2 className="text-base font-semibold">Antes × depois do reenquadramento</h2>
				</div>
				<button
					onClick={() => { limparAntes(credorId); setAntes(null); }}
					className="flex h-8 items-center rounded-lg border border-[#c9dadd] px-3 text-xs font-semibold text-[#304b55] hover:bg-[#edf4f5]"
				>
					Limpar comparação
				</button>
			</div>
			<p className="mb-4 text-xs text-slate-500">
				Contagem de clientes na carga logo antes de pedir o reenquadramento (salva no navegador em {new Date(antes.salvoEm).toLocaleString('pt-BR')}) comparada à atual.
			</p>

			<div className="grid gap-6 lg:grid-cols-2">
				<Tabela titulo="Por segmento" linhas={segLinhas} loading={loading} />
				<Tabela titulo="Por persona" linhas={perLinhas} loading={loading} />
			</div>
		</section>
	);
}

function unionKeys(a: Record<string, number>, b: Record<string, number>): string[] {
	return Array.from(new Set([...Object.keys(a), ...Object.keys(b)]));
}

function Tabela({ titulo, linhas, loading }: { titulo: string; linhas: { label: string; antes: number; atual: number }[]; loading: boolean }) {
	return (
		<div>
			<h3 className="mb-2 text-xs font-bold uppercase tracking-wider text-slate-400">{titulo}</h3>
			<div className="overflow-hidden rounded-lg border border-[#e2eaec]">
				<table className="w-full text-left text-sm">
					<thead>
						<tr className="border-b border-[#e2eaec] bg-[#f7fafb] text-xs text-slate-400">
							<th className="px-3 py-2 font-medium">Segmento</th>
							<th className="px-3 py-2 text-right font-medium">Antes</th>
							<th className="px-3 py-2 text-right font-medium">Atual</th>
							<th className="px-3 py-2 text-right font-medium">Diferença</th>
						</tr>
					</thead>
					<tbody className="divide-y divide-[#eef3f4]">
						{loading ? (
							<tr><td colSpan={4} className="px-3 py-4 text-center text-xs text-slate-400">Carregando…</td></tr>
						) : linhas.length === 0 ? (
							<tr><td colSpan={4} className="px-3 py-4 text-center text-xs text-slate-400">Sem dados.</td></tr>
						) : linhas.map((l) => {
							const diff = l.atual - l.antes;
							return (
								<tr key={l.label}>
									<td className="px-3 py-2 font-medium text-[#163943]">{l.label}</td>
									<td className="px-3 py-2 text-right text-slate-500">{numberBR(l.antes)}</td>
									<td className="px-3 py-2 text-right font-semibold">{numberBR(l.atual)}</td>
									<td className={`px-3 py-2 text-right font-semibold ${diff > 0 ? 'text-[#2E7D32]' : diff < 0 ? 'text-[#C62828]' : 'text-slate-400'}`}>
										{diff > 0 ? `+${numberBR(diff)}` : diff < 0 ? `−${numberBR(Math.abs(diff))}` : '—'}
									</td>
								</tr>
							);
						})}
					</tbody>
				</table>
			</div>
		</div>
	);
}
