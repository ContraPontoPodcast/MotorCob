import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { toast } from 'sonner';
import { Check, ExternalLink, Pencil, Star, Trash2, X } from 'lucide-react';
import { Loading, Notice, usePermissao } from '@/components/app-shell';
import { useMotorAuth } from '@/components/auth-provider';
import { friendlyError, supabase, type Credor, type Row } from '@/lib/supabase';

type Estrategia = { id: string; nome: string; padrao: boolean; frente?: string };
type ClusterRow = { id: string; codigo: string; nome: string; estrategia_id: string | null };
type SegCartRow = { cluster_id: string; credor_id: string; estrategia_id: string | null };

type UsoLinha =
	| { tipo: 'seg'; credorId: string; credorNome: string; clusterId: string; clusterNome: string }
	| { tipo: 'cluster'; clusterNome: string }
	| { tipo: 'carteira'; credorNome: string };

export function EstrategiasEmpresa({ estrategias, credores, onReload }: {
	estrategias: Estrategia[];
	credores: Credor[];
	onReload: () => void;
}) {
	const { empresa } = useMotorAuth();
	const podeVer = usePermissao('editar_orquestracao');
	const [clusters, setClusters] = useState<ClusterRow[]>([]);
	const [segs, setSegs] = useState<SegCartRow[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState('');
	const [busyId, setBusyId] = useState('');
	const [renameId, setRenameId] = useState<string | null>(null);
	const [renameVal, setRenameVal] = useState('');
	const [renameErr, setRenameErr] = useState('');
	const [deleteId, setDeleteId] = useState<string | null>(null);
	const [padraoConfirm, setPadraoConfirm] = useState<string | null>(null);

	async function reload() {
		if (!supabase || !empresa) { setLoading(false); return; }
		setLoading(true); setError('');
		const [cl, sc] = await Promise.all([
			supabase.from('clusters').select('id,codigo,nome,estrategia_id').eq('empresa_id', empresa.id),
			supabase.from('segmentos_carteira').select('cluster_id,credor_id,estrategia_id').eq('empresa_id', empresa.id),
		]);
		if (cl.error || sc.error) { setError(friendlyError()); setLoading(false); return; }
		setClusters((cl.data ?? []) as ClusterRow[]);
		setSegs((sc.data ?? []) as SegCartRow[]);
		setLoading(false);
	}
	useEffect(() => { void reload(); }, [empresa?.id]);

	if (!empresa || !podeVer) return null;

	const estrMotorcob = estrategias.filter(e => e.frente !== 'motorcli');
	const padrao = estrMotorcob.find(e => e.padrao) ?? null;

	const credorNome = (id: string) => credores.find(c => c.id === id)?.nome ?? '—';
	const clusterNome = (id: string) => clusters.find(c => c.id === id)?.nome ?? '—';

	function usoDe(id: string): UsoLinha[] {
		const linhas: UsoLinha[] = [];
		for (const s of segs) {
			if (s.estrategia_id === id) {
				linhas.push({ tipo: 'seg', credorId: s.credor_id, credorNome: credorNome(s.credor_id), clusterId: s.cluster_id, clusterNome: clusterNome(s.cluster_id) });
			}
		}
		for (const c of clusters) {
			if (c.estrategia_id === id) linhas.push({ tipo: 'cluster', clusterNome: c.nome });
		}
		for (const c of credores) {
			if (c.estrategia_id === id) linhas.push({ tipo: 'carteira', credorNome: c.nome });
		}
		return linhas;
	}

	async function salvarRename(est: Estrategia) {
		if (!supabase) return;
		const nome = renameVal.trim();
		setRenameErr('');
		if (nome.length < 1) { setRenameErr('Informe o nome.'); return; }
		if (nome.length > 80) { setRenameErr('Até 80 caracteres.'); return; }
		if (estrMotorcob.some(e => e.id !== est.id && e.nome.toLowerCase() === nome.toLowerCase())) { setRenameErr('Já existe uma estratégia com esse nome.'); return; }
		setBusyId(est.id);
		const { error } = await supabase.from('estrategias').update({ nome }).eq('id', est.id);
		if (error) {
			const msg = (error.message || '').toLowerCase();
			if (msg.includes('duplicate') || msg.includes('unique') || msg.includes('repetido')) setRenameErr('Já existe uma estratégia com esse nome.');
			else setRenameErr(friendlyError(error));
			setBusyId(''); return;
		}
		setRenameId(null); setBusyId('');
		toast.success('Nome atualizado · Clientes e Mapa mostram o nome novo a partir da próxima lista.');
		onReload();
	}

	async function excluir(est: Estrategia) {
		if (!supabase || !empresa) return;
		setBusyId(est.id);
		// Reconsulta os três usos antes de apagar.
		const [cl, sc, cr] = await Promise.all([
			supabase.from('clusters').select('id', { count: 'exact', head: true }).eq('empresa_id', empresa.id).eq('estrategia_id', est.id),
			supabase.from('segmentos_carteira').select('cluster_id', { count: 'exact', head: true }).eq('empresa_id', empresa.id).eq('estrategia_id', est.id),
			supabase.from('credores').select('id', { count: 'exact', head: true }).eq('empresa_id', empresa.id).eq('estrategia_id', est.id),
		]);
		const total = (cl.count ?? 0) + (sc.count ?? 0) + (cr.count ?? 0);
		if (total > 0) {
			toast.error('Ela passou a ser usada; atualize a lista.');
			setBusyId(''); setDeleteId(null); void reload(); onReload(); return;
		}
		const { error } = await supabase.from('estrategias').delete().eq('id', est.id);
		if (error) { setError(friendlyError(error)); setBusyId(''); setDeleteId(null); return; }
		toast.success('Estratégia excluída.');
		setBusyId(''); setDeleteId(null); onReload();
	}

	async function tornarPadrao(est: Estrategia) {
		if (!supabase || !empresa) return;
		setBusyId(est.id); setError('');
		// (1) desliga o padrão atual da Cobrança (só motorcob).
		if (padrao && padrao.id !== est.id) {
			const { error: e1 } = await supabase.from('estrategias').update({ padrao: false }).eq('id', padrao.id);
			if (e1) { setError(friendlyError(e1)); setBusyId(''); setPadraoConfirm(null); return; }
		}
		// (2) liga o novo padrão.
		const { error: e2 } = await supabase.from('estrategias').update({ padrao: true }).eq('id', est.id);
		if (e2) {
			// Reverte (1).
			if (padrao && padrao.id !== est.id) await supabase.from('estrategias').update({ padrao: true }).eq('id', padrao.id);
			setError(friendlyError(e2)); setBusyId(''); setPadraoConfirm(null); return;
		}
		toast.success('Padrão da empresa na Cobrança atualizado · vale a partir da próxima lista.');
		setBusyId(''); setPadraoConfirm(null); onReload();
	}

	if (loading) return <section className="mt-8 rounded-xl border border-[#dfe8ea] bg-white p-6"><Loading /></section>;

	return (
		<section className="mt-8 rounded-xl border border-[#dfe8ea] bg-white p-6 sm:p-8">
			<div className="mb-1 flex flex-wrap items-center justify-between gap-3">
				<h2 className="text-lg font-semibold text-[#163943]">Estratégias e modelos da empresa</h2>
				<span className="text-xs text-slate-400">Só estratégias da Cobrança</span>
			</div>
			<p className="mb-4 text-sm text-slate-500">Modelos e estratégias da Cobrança desta empresa. Veja onde cada uma é usada, renomeie, troque o padrão ou exclua as que estão sem uso.</p>

			<div className="mb-5 rounded-lg border border-[#d9e5e8] bg-[#eaf2f3] px-4 py-3 text-sm text-[#315d68]">
				{padrao ? <>Padrão da empresa na Cobrança: <strong>{padrao.nome}</strong></> : <span>Nenhuma (segmento sem estratégia segue o playbook do motor)</span>}
			</div>

			{error && <div className="mb-4"><Notice>{error}</Notice></div>}

			{estrMotorcob.length === 0 ? (
				<p className="rounded-lg border border-dashed border-[#cbd9dd] bg-[#fafcfc] px-6 py-10 text-center text-sm text-slate-400">Nenhuma estratégia da Cobrança nesta empresa.</p>
			) : (
				<div className="space-y-3">
					{estrMotorcob.map(est => {
						const linhas = usoDe(est.id);
						const n = linhas.length + (est.padrao ? 1 : 0);
						const renomeando = renameId === est.id;
						const excluindo = deleteId === est.id;
						return (
							<div key={est.id} className="rounded-lg border border-[#e2eaec] bg-[#fafcfc] p-4">
								<div className="flex flex-wrap items-start justify-between gap-3">
									<div className="min-w-0 flex-1">
										{renomeando ? (
											<div className="max-w-md">
												<input
													value={renameVal}
													onChange={e => { setRenameVal(e.target.value); setRenameErr(''); }}
													maxLength={80}
													className="h-9 w-full rounded-lg border border-[#d8e3e5] bg-white px-3 text-sm outline-none focus:border-[#0F4C5C]"
													aria-label="Novo nome da estratégia"
												/>
												{renameErr && <p role="alert" className="mt-1 text-xs text-[#C62828]">{renameErr}</p>}
												<p className="mt-1 text-[11px] text-slate-400">Clientes e Mapa mostram o nome novo a partir da próxima lista.</p>
											</div>
										) : (
											<div className="flex flex-wrap items-center gap-2">
												<h3 className="text-sm font-semibold text-[#163943]">{est.nome}</h3>
												{est.padrao && <span className="inline-flex items-center gap-1 rounded-full bg-[#eaf2f3] px-2 py-0.5 text-[10px] font-bold text-[#0F4C5C]"><Star size={10} /> Padrão da empresa</span>}
											</div>
										)}
									</div>
									<div className="flex flex-wrap items-center gap-2">
										{!renomeando && (
											<button onClick={() => { setRenameId(est.id); setRenameVal(est.nome); setRenameErr(''); }} disabled={!!busyId} className="flex h-8 items-center gap-1.5 rounded border border-[#c9dadd] px-3 text-xs font-semibold text-[#0F4C5C] hover:bg-[#edf4f5] disabled:opacity-50"><Pencil size={13} /> Renomear</button>
										)}
										{renomeando && (
											<>
												<button onClick={() => salvarRename(est)} disabled={!!busyId} className="flex h-8 items-center gap-1.5 rounded bg-[#0F4C5C] px-3 text-xs font-semibold text-white hover:bg-[#0d4252] disabled:opacity-50"><Check size={13} /> Salvar</button>
												<button onClick={() => { setRenameId(null); setRenameErr(''); }} disabled={!!busyId} className="flex h-8 items-center gap-1.5 rounded border border-[#c9dadd] px-3 text-xs font-semibold text-slate-600 hover:bg-white disabled:opacity-50"><X size={13} /> Cancelar</button>
											</>
										)}
										{!est.padrao && !renomeando && (
											padraoConfirm === est.id ? (
												<>
													<button onClick={() => tornarPadrao(est)} disabled={!!busyId} className="flex h-8 items-center gap-1.5 rounded bg-[#0F4C5C] px-3 text-xs font-semibold text-white hover:bg-[#0d4252] disabled:opacity-50"><Check size={13} /> Confirmar</button>
													<button onClick={() => setPadraoConfirm(null)} disabled={!!busyId} className="flex h-8 items-center gap-1.5 rounded border border-[#c9dadd] px-3 text-xs font-semibold text-slate-600 hover:bg-white disabled:opacity-50"><X size={13} /> Cancelar</button>
												</>
											) : (
												<button onClick={() => setPadraoConfirm(est.id)} disabled={!!busyId} className="flex h-8 items-center gap-1.5 rounded border border-[#0F4C5C] px-3 text-xs font-semibold text-[#0F4C5C] hover:bg-[#eaf2f3] disabled:opacity-50"><Star size={13} /> Tornar padrão</button>
											)
										)}
										{!renomeando && (
											excluindo ? (
												<>
													<button onClick={() => excluir(est)} disabled={!!busyId} className="flex h-8 items-center gap-1.5 rounded bg-[#C62828] px-3 text-xs font-semibold text-white hover:bg-[#a51f1f] disabled:opacity-50"><Trash2 size={13} /> Excluir</button>
													<button onClick={() => setDeleteId(null)} disabled={!!busyId} className="flex h-8 items-center gap-1.5 rounded border border-[#c9dadd] px-3 text-xs font-semibold text-slate-600 hover:bg-white disabled:opacity-50"><X size={13} /> Cancelar</button>
												</>
											) : (
												<button
													onClick={() => setDeleteId(est.id)}
													disabled={n > 0 || !!busyId}
													title={n > 0 ? `Em uso em ${n} lugares: troque nesses lugares antes.` : undefined}
													className="flex h-8 items-center gap-1.5 rounded border border-[#c9dadd] px-3 text-xs font-semibold text-[#C62828] hover:bg-[#ffe8e6] disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent"
												><Trash2 size={13} /> Excluir</button>
											)
										)}
									</div>
								</div>

								{excluindo && (
									<p className="mt-3 rounded-lg bg-[#ffe8e6] px-3 py-2 text-xs font-medium text-[#C62828]">Excluir a estratégia {est.nome}? Ela não está em uso. Isto não pode ser desfeito.</p>
								)}
								{padraoConfirm === est.id && (
									<p className="mt-3 rounded-lg bg-[#eaf2f3] px-3 py-2 text-xs font-medium text-[#0F4C5C]">A nova padrão passa a valer para os segmentos sem estratégia própria nas carteiras sem estratégia padrão. Vale a partir da próxima lista.</p>
								)}

								<div className="mt-3">
									<p className="mb-1 text-[10px] font-bold uppercase tracking-wider text-slate-400">Onde é usada</p>
									{linhas.length === 0 ? (
										<p className="text-xs text-slate-500">Sem uso (aparece como modelo da empresa na Orquestração)</p>
									) : (
										<ul className="space-y-1">
											{linhas.map((l, i) => (
												<li key={i} className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
													{l.tipo === 'seg' ? (
														<>
															<span>carteira {l.credorNome} · segmento {l.clusterNome}</span>
															<Link to={`/orquestracao?carteira=${l.credorId}&segmento=${l.clusterId}&passo=estagios`} className="inline-flex items-center gap-0.5 font-semibold text-[#0F4C5C] hover:underline"><ExternalLink size={11} /> Abrir na Orquestração</Link>
														</>
													) : l.tipo === 'cluster' ? (
														<span>segmento {l.clusterNome} (todas as carteiras sem estratégia própria)</span>
													) : (
														<span>padrão da carteira {l.credorNome}</span>
													)}
												</li>
											))}
										</ul>
									)}
									<p className="mt-1.5 text-[11px] text-slate-400">Em uso em {n} {n === 1 ? 'lugar' : 'lugares'}</p>
								</div>
							</div>
						);
					})}
				</div>
			)}
		</section>
	);
}
