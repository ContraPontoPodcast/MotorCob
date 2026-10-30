import { useEffect, useState } from 'react';
import { Copy, X } from 'lucide-react';
import { supabase, friendlyError, type Credor, type Row } from '@/lib/supabase';
import { type Definicao } from '@/lib/estrategia';

/** Três caminhos lado a lado, nenhum marcado como recomendado. */
export function TresCaminhos({ aviso, onCriarDoZero, onCopiar, onModelo, criarLabel, disabled }: {
	aviso?: React.ReactNode;
	onCriarDoZero: () => void;
	onCopiar: () => void;
	onModelo: () => void;
	criarLabel?: string;
	/** Perfis sem permissão de edição veem os caminhos, mas sem botões ativos. */
	disabled?: boolean;
}) {
	const btnCls = 'flex flex-col rounded-xl border border-[#dfe8ea] bg-white p-5 text-left transition hover:border-[#0F4C5C] hover:bg-[#fafcfc] disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:border-[#dfe8ea] disabled:hover:bg-white';
	return (
		<div className="mt-4 space-y-3">
			{aviso}
			<div className="grid gap-3 sm:grid-cols-3">
				<button type="button" disabled={disabled} onClick={onCriarDoZero} className={btnCls}>
					<span className="text-sm font-bold text-[#163943]">{criarLabel ?? 'Criar do zero'}</span>
					<p className="mt-1.5 text-xs leading-relaxed text-slate-500">Comece uma estratégia vazia e monte do seu jeito.</p>
				</button>
				<button type="button" disabled={disabled} onClick={onCopiar} className={btnCls}>
					<span className="text-sm font-bold text-[#163943]">Copiar de outra carteira</span>
					<p className="mt-1.5 text-xs leading-relaxed text-slate-500">Vira cópia desta carteira: mudar aqui não muda a origem.</p>
				</button>
				<button type="button" disabled={disabled} onClick={onModelo} className={btnCls}>
					<div className="flex items-center gap-2">
						<span className="text-sm font-bold text-[#163943]">Começar de um modelo</span>
						<span className="rounded-full bg-[#f5f8f9] px-2 py-0.5 text-[9px] font-bold uppercase text-slate-400">opcional</span>
					</div>
					<p className="mt-1.5 text-xs leading-relaxed text-slate-500">Modelos prontos para editar e desligar.</p>
				</button>
			</div>
		</div>
	);
}

/** Modal simples: lista carteiras que usam o segmento e copia a definição inteira. */
export function CopiarSegmentoModal({ open, onClose, clusterId, clusterNome, credores, currentCredorId, estrategias, onAplicar }: {
	open: boolean;
	onClose: () => void;
	clusterId: string;
	clusterNome: string;
	credores: Credor[];
	currentCredorId: string;
	estrategias: { id: string; nome: string; definicao: Definicao | null }[];
	onAplicar: (def: Definicao, origemNome: string) => void;
}) {
	const [origens, setOrigens] = useState<{ credorId: string; credorNome: string; def: Definicao }[]>([]);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState('');

	useEffect(() => {
		if (!open || !supabase || !clusterId) return;
		let active = true;
		setLoading(true); setError('');
		(async () => {
			const { data, error: e } = await supabase.from('segmentos_em_uso').select('credor_id,estrategia_id').eq('cluster_id', clusterId).eq('vinculado', true);
			if (!active) return;
			if (e) { setError(friendlyError()); setLoading(false); return; }
			const rows = (data ?? []) as Row[];
			const lista = rows
				.filter(r => r.credor_id !== currentCredorId)
				.map(r => {
					const cred = credores.find(c => c.id === r.credor_id);
					const eid = (r.estrategia_id as string | null) ?? null;
					const est = eid ? estrategias.find(x => x.id === eid) : null;
					return { credorId: r.credor_id as string, credorNome: cred?.nome ?? (r.credor_id as string), def: est?.definicao ?? null };
				})
				.filter((x): x is { credorId: string; credorNome: string; def: Definicao } => !!x.def);
			setOrigens(lista);
			setLoading(false);
		})();
		return () => { active = false; };
	}, [open, clusterId, currentCredorId, estrategias, credores]);

	if (!open) return null;

	return (
		<div className="fixed inset-0 z-[80] grid place-items-center bg-[#102e38]/60 p-4" onClick={onClose}>
			<div role="dialog" aria-modal="true" aria-label="Copiar de outra carteira" className="max-h-[92vh] w-full max-w-lg overflow-auto rounded-xl bg-white p-6 shadow-xl sm:p-8" onClick={e => e.stopPropagation()}>
				<div className="mb-5 flex items-center justify-between">
					<div className="flex items-center gap-2"><Copy size={20} className="text-[#0F4C5C]" /><h2 className="text-lg font-semibold">Copiar de outra carteira</h2></div>
					<button onClick={onClose} aria-label="Fechar"><X size={20} /></button>
				</div>
				<p className="mb-4 text-sm text-slate-500">Carteiras que usam o segmento <strong>{clusterNome}</strong>. Escolher uma copia a estratégia inteira para esta carteira.</p>
				{loading ? <p className="text-xs text-slate-400">Carregando...</p> : error ? <p className="text-sm text-[#C62828]">{error}</p> : origens.length === 0 ? (
					<p className="rounded-lg border border-dashed border-[#cbd9dd] bg-[#fafcfc] px-3 py-6 text-center text-xs text-slate-400">Nenhuma outra carteira usa este segmento com estratégia.</p>
				) : (
					<div className="space-y-2">
						{origens.map(o => (
							<button key={o.credorId} type="button" onClick={() => onAplicar(o.def, o.credorNome)} className="flex w-full items-center gap-2 rounded-lg border border-[#e2eaec] bg-[#fafcfc] px-3 py-2.5 text-left hover:bg-[#f5f8f9]">
								<span className="text-sm font-medium text-[#163943]">{o.credorNome}</span>
							</button>
						))}
					</div>
				)}
				<p className="mt-3 text-[11px] text-slate-400">Vira cópia desta carteira: mudar aqui não muda a origem.</p>
			</div>
		</div>
	);
}
