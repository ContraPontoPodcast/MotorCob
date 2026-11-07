import { useEffect, useState } from 'react';
import { Layers, Plus, Sparkles, X } from 'lucide-react';
import { toast } from 'sonner';
import { friendlyError, supabase, type Row } from '@/lib/supabase';

/** Segmentação (protótipo aprovado, tela 1): três caminhos com o MESMO peso (mesmo tamanho, mesmo miolo; nenhum
 *  recomendado). "Descrever segmentos e régua" fica em breve até a etapa 5; o que já existe continua. */
export function CaminhosSegmentacao({ onNovo, onUsar, disabled }: { onNovo: () => void; onUsar: () => void; disabled?: boolean }) {
	const cls = 'flex min-h-[132px] flex-col items-start gap-2.5 rounded-xl border border-[var(--base-borda)] bg-[var(--base-cartao)] p-4 text-left transition enabled:hover:border-[var(--destaque)] enabled:hover:bg-[var(--base-fill)] disabled:cursor-not-allowed';
	const ico = 'grid h-8 w-8 flex-none place-items-center rounded-lg bg-[var(--base-fill)] text-[var(--base-texto-2)]';
	return (
		<div>
			<h2 className="text-[15px] font-bold text-[var(--base-texto)]">Como montar os segmentos desta carteira</h2>
			<div className="mt-3 grid auto-rows-fr gap-2.5 md:grid-cols-3" data-testid="caminhos-segmentacao">
				<button type="button" disabled={disabled} onClick={onNovo} className={`${cls} disabled:opacity-50`}>
					<span className={ico} aria-hidden="true"><Plus size={16} /></span>
					<span className="text-[13.5px] font-bold text-[var(--base-texto)]">Novo segmento</span>
					<span className="text-xs text-[var(--base-texto-2)]">Monte as condições no formulário, como hoje.</span>
				</button>
				<button type="button" disabled={disabled} onClick={onUsar} className={`${cls} disabled:opacity-50`}>
					<span className={ico} aria-hidden="true"><Layers size={16} /></span>
					<span className="text-[13.5px] font-bold text-[var(--base-texto)]">Usar segmento da empresa</span>
					<span className="text-xs text-[var(--base-texto-2)]">Ligue nesta carteira um segmento que a empresa já tem.</span>
				</button>
				<button type="button" disabled aria-disabled="true" title="Em breve" className={cls}>
					<span className={ico} aria-hidden="true"><Sparkles size={16} /></span>
					<span className="flex flex-wrap items-center gap-1.5">
						<span className="text-[13.5px] font-bold text-[var(--base-texto-2)]">Descrever segmentos e régua</span>
						<span className="rounded-full bg-[var(--base-fill)] px-2 py-0.5 text-[9px] font-bold uppercase text-[var(--base-texto-3)]">IA</span>
						<span className="rounded-full bg-[var(--base-fill)] px-2 py-0.5 text-[9px] font-bold uppercase text-[var(--base-texto-3)]">em breve</span>
					</span>
					<span className="text-xs text-[var(--base-texto-3)]">Escreva como a carteira se divide; a IA propõe segmentos e régua.</span>
				</button>
			</div>
			<p className="mt-2 text-[11px] text-[var(--base-texto-3)]">Os caminhos têm o mesmo peso e nenhum é recomendado. O cliente fica no 1º segmento em que se encaixa, de cima para baixo; segmentos com dias de atraso são reavaliados todo dia.</p>
		</div>
	);
}

type Candidato = { cluster_id: string; codigo: string; nome: string; ordem: number; vinculo: string };

/** Liga nesta carteira um segmento da empresa que ainda não está nela (segmentos_carteira). Segmento que valia só
 *  numa carteira (clusters.credor_id) ganha os vínculos de hoje antes, para não sair de onde já estava. */
export function UsarSegmentoModal({ open, empresaId, credorId, credorNome, onClose, onUsado }: {
	open: boolean; empresaId: string; credorId: string; credorNome: string; onClose: () => void; onUsado: (clusterId: string) => void;
}) {
	const [lista, setLista] = useState<Candidato[] | null>(null);
	const [erro, setErro] = useState('');
	const [busy, setBusy] = useState('');

	useEffect(() => {
		if (!open || !supabase) return;
		let ativo = true;
		setLista(null); setErro('');
		void (async () => {
			const [s, c] = await Promise.all([
				supabase!.from('segmentos_em_uso').select('cluster_id,codigo,nome,ordem,vinculo').eq('credor_id', credorId).eq('vinculado', false).order('ordem', { ascending: true }),
				supabase!.from('clusters').select('id,ativo').eq('empresa_id', empresaId),
			]);
			if (!ativo) return;
			if (s.error || c.error) { setErro(friendlyError()); setLista([]); return; }
			const ligados = new Set((c.data ?? []).filter((r: Row) => r.ativo).map((r: Row) => String(r.id)));
			setLista(((s.data ?? []) as Candidato[]).filter(x => ligados.has(String(x.cluster_id))));
		})();
		return () => { ativo = false; };
	}, [open, credorId, empresaId]);

	async function usar(x: Candidato) {
		if (!supabase) return;
		setBusy(x.cluster_id); setErro('');
		try {
			if (x.vinculo === 'uma') {
				// valia só em uma carteira (sem vínculos): grava o vínculo dela antes, senão ela perderia o segmento
				const { data: cl } = await supabase.from('clusters').select('credor_id').eq('id', x.cluster_id).maybeSingle();
				const outra = (cl as Row | null)?.credor_id as string | null | undefined;
				if (outra) {
					const r1 = await supabase.from('segmentos_carteira').upsert({ empresa_id: empresaId, cluster_id: x.cluster_id, credor_id: outra, ativo: true }, { onConflict: 'cluster_id,credor_id' });
					if (r1.error) throw r1.error;
				}
			}
			const r = await supabase.from('segmentos_carteira').upsert({ empresa_id: empresaId, cluster_id: x.cluster_id, credor_id: credorId, ativo: true }, { onConflict: 'cluster_id,credor_id' });
			if (r.error) throw r.error;
			if (x.vinculo === 'uma') await supabase.from('clusters').update({ credor_id: null }).eq('id', x.cluster_id);
			toast.success(`${x.nome} agora vale em ${credorNome} · a partir da próxima rotina`);
			onUsado(x.cluster_id);
		} catch (e) { setErro(friendlyError(e)); }
		setBusy('');
	}

	if (!open) return null;
	return (
		<div className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-4" onClick={onClose}>
			<div role="dialog" aria-modal="true" aria-label="Usar segmento da empresa" className="max-h-[85vh] w-full max-w-lg overflow-auto rounded-xl bg-[var(--base-cartao)] p-6 shadow-xl" onClick={e => e.stopPropagation()}>
				<div className="mb-2 flex items-center justify-between gap-3">
					<h2 className="text-lg font-semibold text-[var(--base-texto)]">Usar segmento da empresa</h2>
					<button type="button" onClick={onClose} aria-label="Fechar" className="text-[var(--base-texto-2)]"><X size={20} /></button>
				</div>
				<p className="text-xs text-[var(--base-texto-2)]">O segmento é da empresa: as condições e a ordem são as mesmas em todas as carteiras que o usam. Ele entra em {credorNome} na posição dele na ordem.</p>
				<div className="mt-4 space-y-2">
					{lista === null && <p className="text-sm text-[var(--base-texto-2)]">Carregando…</p>}
					{lista && lista.length === 0 && !erro && <p className="text-sm text-[var(--base-texto-2)]">Todos os segmentos ligados da empresa já estão nesta carteira.</p>}
					{lista?.map(x => (
						<div key={x.cluster_id} className="flex items-center justify-between gap-3 rounded-lg border border-[var(--base-borda)] px-3 py-2">
							<div className="flex min-w-0 items-center gap-2">
								<span className="grid h-7 min-w-7 place-items-center rounded-md px-1 text-[11px] font-bold" style={{ backgroundColor: 'var(--area)', color: 'var(--area-ativo-texto)' }}>{x.codigo}</span>
								<span className="truncate text-sm font-medium text-[var(--base-texto)]">{x.nome}</span>
							</div>
							<button type="button" disabled={!!busy} onClick={() => void usar(x)} className="h-8 rounded-lg px-3 text-xs font-semibold text-[var(--destaque-texto)] disabled:opacity-50" style={{ backgroundColor: 'var(--destaque)' }}>{busy === x.cluster_id ? 'Ligando…' : 'Usar nesta carteira'}</button>
						</div>
					))}
				</div>
				{erro && <p role="alert" className="mt-3 text-sm text-[var(--estado-erro)]">{erro}</p>}
			</div>
		</div>
	);
}
