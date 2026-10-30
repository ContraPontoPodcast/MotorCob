import { useEffect, useState } from 'react';
import { Check, Sparkles, X } from 'lucide-react';
import { supabase, friendlyError, type Row } from '@/lib/supabase';
import { useMotorAuth } from '@/components/auth-provider';
import { canalLabel, fases, modeloClassicos, modeloSoDigital, passosFrase, type Definicao } from '@/lib/estrategia';

const QUEM_ENTRA: Record<string, string> = {
	localizacao: 'Cliente novo, ainda sem contato',
	cpc: 'Cliente que já teve contato (CPC), sem resposta',
	giro: 'Não CPC — em giro de recontato',
	preventivo: 'Acordo antes do vencimento',
	quebra: 'Acordo com parcela vencida',
};

const MODELOS_PARTIDA: { id: string; nome: string; desc: string; def: Definicao }[] = [
	{ id: 'classicos', nome: 'Estágios clássicos', desc: 'As 5 fases ligadas, com as réguas do motor.', def: modeloClassicos() },
	{ id: 'so-digital', nome: 'Só digital', desc: 'As 5 fases sem agente virtual e discador.', def: modeloSoDigital() },
];

function ModeloPreview({ def }: { def: Definicao }) {
	const ligadas = fases.filter(f => {
		const obj = (def as Record<string, unknown>)[f.id] as Record<string, unknown> | undefined;
		return !!obj && (obj as { ativo?: boolean }).ativo !== false;
	});
	if (ligadas.length === 0) return <p className="text-xs text-slate-400">Nenhum estágio ligado.</p>;
	return (
		<div className="space-y-2">
			{ligadas.map(f => {
				const obj = (def as Record<string, unknown>)[f.id] as Record<string, unknown> | undefined;
				let resumo = 'Réguas do motor';
				if (f.id === 'cpc') {
					const ordem = (obj as { ordem?: { canal: string }[] } | undefined)?.ordem;
					if (Array.isArray(ordem) && ordem.length) resumo = `Ordem: ${ordem.map(a => canalLabel[a.canal] ?? a.canal).join(' → ')}`;
				} else {
					const passos = (obj as { passos?: Parameters<typeof passosFrase>[0] } | undefined)?.passos;
					if (passos) resumo = passosFrase(passos, f.prefixo) || resumo;
				}
				return (
					<div key={f.id} className="rounded-lg border border-[#e2eaec] bg-[#fafcfc] px-3 py-2">
						<div className="flex items-center gap-1.5">
							<Check size={13} className="text-[#2E7D32]" />
							<span className="text-xs font-bold text-[#163943]">{f.label}</span>
						</div>
						<p className="mt-0.5 text-[11px] text-slate-500">{QUEM_ENTRA[f.id]}</p>
						<p className="mt-0.5 text-[11px] text-slate-400">{resumo}</p>
					</div>
				);
			})}
		</div>
	);
}

export function ModelosModal({ open, onClose, onAplicar }: {
	open: boolean;
	onClose: () => void;
	onAplicar: (def: Definicao, nome: string) => void;
}) {
	const { empresa, credores } = useMotorAuth();
	const [selecionado, setSelecionado] = useState<{ nome: string; def: Definicao } | null>(null);
	const [daEmpresa, setDaEmpresa] = useState<{ id: string; nome: string; def: Definicao }[]>([]);
	const [loading, setLoading] = useState(false);

	useEffect(() => {
		if (!open) return;
		setSelecionado(null);
		if (!supabase || !empresa) { setDaEmpresa([]); return; }
		let active = true;
		setLoading(true);
		(async () => {
			const credorIds = (credores ?? []).map(c => c.id);
			const [est, segs, creds] = await Promise.all([
				supabase.from('estrategias').select('id,nome,definicao,padrao').eq('empresa_id', empresa.id).eq('frente', 'motorcob').eq('padrao', false).order('nome'),
				credorIds.length ? supabase.from('segmentos_em_uso').select('estrategia_id,estrategia_segmento').in('credor_id', credorIds) : Promise.resolve({ data: [] as Row[], error: null }),
				supabase.from('credores').select('estrategia_id').eq('empresa_id', empresa.id).not('estrategia_id', 'is', null),
			]);
			if (!active) return;
			const emUso = new Set<string>();
			(segs.data ?? []).forEach((r: Row) => {
				const v = r.estrategia_id as string | null; if (v) emUso.add(v);
				const vs = r.estrategia_segmento as string | null; if (vs) emUso.add(vs);
			});
			(creds.data ?? []).forEach((r: Row) => { const v = r.estrategia_id as string | null; if (v) emUso.add(v); });
			const lista = (est.data ?? [])
				.filter((r: Row) => !emUso.has(r.id as string) && r.definicao)
				.map((r: Row) => ({ id: r.id as string, nome: r.nome as string, def: r.definicao as Definicao }));
			setDaEmpresa(lista);
			setLoading(false);
		})();
		return () => { active = false; };
	}, [open, empresa?.id, credores]);

	if (!open) return null;

	return (
		<div className="fixed inset-0 z-[80] grid place-items-center bg-[#102e38]/60 p-4" onClick={onClose}>
			<div role="dialog" aria-modal="true" aria-label="Começar de um modelo" className="max-h-[92vh] w-full max-w-3xl overflow-auto rounded-xl bg-white p-6 shadow-xl sm:p-8" onClick={e => e.stopPropagation()}>
				<div className="mb-5 flex items-center justify-between">
					<div className="flex items-center gap-2"><Sparkles size={20} className="text-[#0F4C5C]" /><h2 className="text-lg font-semibold">Começar de um modelo</h2></div>
					<button onClick={onClose} aria-label="Fechar"><X size={20} /></button>
				</div>

				<div className="grid gap-6 md:grid-cols-2">
					<div className="space-y-4">
						<div>
							<p className="mb-2 text-xs font-bold uppercase tracking-wider text-slate-400">Modelos de partida</p>
							<div className="space-y-2">
								{MODELOS_PARTIDA.map(m => (
									<button key={m.id} type="button" onClick={() => setSelecionado({ nome: m.nome, def: m.def })} className={`w-full rounded-lg border p-3 text-left transition ${selecionado?.nome === m.nome ? 'border-[#0F4C5C] bg-[#eaf2f3] ring-1 ring-[#0F4C5C]' : 'border-[#e2eaec] bg-[#fafcfc] hover:bg-[#f5f8f9]'}`}>
										<span className="text-sm font-bold text-[#163943]">{m.nome}</span>
										<p className="mt-0.5 text-[11px] text-slate-500">{m.desc}</p>
									</button>
								))}
							</div>
						</div>
						<div>
							<p className="mb-2 text-xs font-bold uppercase tracking-wider text-slate-400">Da sua empresa</p>
							{loading ? <p className="text-xs text-slate-400">Carregando...</p> : daEmpresa.length === 0 ? (
								<p className="rounded-lg border border-dashed border-[#cbd9dd] bg-[#fafcfc] px-3 py-4 text-center text-[11px] text-slate-400">Nenhuma estratégia da Cobrança disponível (sem uso).</p>
							) : (
								<div className="space-y-2">
									{daEmpresa.map(e => (
										<button key={e.id} type="button" onClick={() => setSelecionado({ nome: e.nome, def: e.def })} className={`w-full rounded-lg border p-3 text-left transition ${selecionado?.nome === e.nome ? 'border-[#0F4C5C] bg-[#eaf2f3] ring-1 ring-[#0F4C5C]' : 'border-[#e2eaec] bg-[#fafcfc] hover:bg-[#f5f8f9]'}`}>
											<span className="text-sm font-bold text-[#163943]">{e.nome}</span>
										</button>
									))}
								</div>
							)}
						</div>
					</div>
					<div>
						<p className="mb-2 text-xs font-bold uppercase tracking-wider text-slate-400">O que vem dentro</p>
						{selecionado ? <ModeloPreview def={selecionado.def} /> : <p className="rounded-lg border border-dashed border-[#cbd9dd] bg-[#fafcfc] px-3 py-8 text-center text-[11px] text-slate-400">Escolha um modelo para ver o conteúdo.</p>}
					</div>
				</div>

				<div className="mt-6 flex justify-end gap-3">
					<button type="button" onClick={onClose} className="h-11 rounded-lg border border-[#c9dadd] px-5 text-sm font-semibold text-[#304b55] hover:bg-[#edf4f5]">Cancelar</button>
					<button type="button" onClick={() => selecionado && onAplicar(selecionado.def, selecionado.nome)} disabled={!selecionado} className="flex h-11 items-center gap-2 rounded-lg bg-[#0F4C5C] px-6 text-sm font-semibold text-white hover:bg-[#0d4252] disabled:opacity-50"><Check size={16} /> Usar e editar</button>
				</div>
			</div>
		</div>
	);
}
