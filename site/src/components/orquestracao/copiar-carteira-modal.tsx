import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Copy, X } from 'lucide-react';
import { friendlyError, supabase, type Credor, type Row } from '@/lib/supabase';
import { type Definicao } from '@/lib/estrategia';
import { ErrorDetail } from '@/components/error-detail';
import { limparPersonas, normalizarDefinicao } from './personas-carteira';

const PARTES = [
	{ id: 'regua', label: 'Régua das fases' },
	{ id: 'etapas', label: 'Etapas (dias e canais)' },
	{ id: 'orcamento', label: 'Orçamento e prioridade' },
	{ id: 'travas', label: 'Travas' },
	{ id: 'frases', label: 'Frases' },
	{ id: 'personas', label: 'Raias de personas (só as que existem aqui)' },
] as const;
type ParteId = (typeof PARTES)[number]['id'];

const deepCopy = <T,>(x: T): T => (typeof structuredClone === 'function' ? structuredClone(x) : JSON.parse(JSON.stringify(x)) as T);

/** Monta a definição copiada: partes marcadas da origem sobre a definição atual, filtrando personas inválidas. */
export function montarCopiaCarteira(origem: Definicao | null | undefined, atual: Definicao, partes: Set<ParteId>, destinoIds: Set<string>): { def: Definicao; droppedPersonas: boolean } {
	const out: Definicao = deepCopy(atual);
	let dropped = false;
	const fases = ['localizacao', 'cpc', 'giro', 'preventivo', 'quebra'] as const;
	// Régua + etapas + orcamento + travas por fase
	for (const fase of fases) {
		const src = (origem as Record<string, unknown>)?.[fase] as Record<string, unknown> | undefined;
		if (!src) continue;
		const cur = (out as Record<string, unknown>)[fase] as Record<string, unknown> | undefined;
		const merged: Record<string, unknown> = { ...(cur ?? {}) };
		if (partes.has('regua')) {
			for (const k of ['dias_sem_contato_para_ncp', 'ciclo_dias', 'max_ciclos', 'dias_para_estoque', 'carencia', 'tentativas_por_canal', 'intervalo_cpa', 'intervalo_cpb', 'ativo']) {
				if (src[k] !== undefined) merged[k] = deepCopy(src[k]);
			}
		}
		if (partes.has('etapas')) {
			if (fase === 'cpc') { merged.ordem = deepCopy(src.ordem ?? []); merged.junto = deepCopy(src.junto ?? []); }
			else merged.passos = deepCopy(src.passos ?? {});
		}
		if (partes.has('orcamento') && src.orcamento) merged.orcamento = deepCopy(src.orcamento);
		if (partes.has('travas') && src.travas) merged.travas = deepCopy(src.travas);
		(out as Record<string, unknown>)[fase] = merged;
	}
	// Travas da estratégia (topo)
	if (partes.has('travas') && origem?.travas) out.travas = deepCopy(origem.travas);
	// Orçamento e prioridade (topo)
	if (partes.has('orcamento') && origem?.prioridade_contatos) out.prioridade_contatos = deepCopy(origem.prioridade_contatos);
	// Frases
	if (partes.has('frases')) {
		if (origem?.mensagens) out.mensagens = deepCopy(origem.mensagens);
		if (origem?.cpc?.mensagem_hot) out.cpc = { ...(out.cpc ?? { ordem: [], junto: [] }), mensagem_hot: deepCopy(origem.cpc.mensagem_hot) };
	}
	// Personas: filtra ids inválidos nas passos
	if (partes.has('personas')) {
		const limpo = limparPersonas(out, destinoIds);
		// detecta se dropou
		const antes = JSON.stringify(out); const depois = JSON.stringify(limpo);
		if (antes !== depois) dropped = true;
		Object.assign(out, limpo);
	}
	return { def: out, droppedPersonas: dropped };
}

export function CopiarCarteiraModal({ open, onClose, credores, currentCredorId, estrategias, defAtual, destinoPersonaIds, onAplicar }: {
	open: boolean;
	onClose: () => void;
	credores: Credor[];
	currentCredorId: string;
	estrategias: { id: string; nome: string; definicao: Definicao | null }[];
	defAtual: Definicao;
	destinoPersonaIds: Set<string>;
	onAplicar: (newDef: Definicao, origemNome: string, droppedPersonas: boolean) => void;
}) {
	const [origemCredorId, setOrigemCredorId] = useState('');
	const [segOptions, setSegOptions] = useState<{ clusterId: string; codigo: string; nome: string; estrategiaId: string | null }[]>([]);
	const [segClusterId, setSegClusterId] = useState('');
	const [segLoading, setSegLoading] = useState(false);
	const [partes, setPartes] = useState<Set<ParteId>>(new Set(PARTES.map(p => p.id)));
	const [error, setError] = useState('');

	useEffect(() => {
		if (!open) return;
		setOrigemCredorId(''); setSegClusterId(''); setSegOptions([]); setError('');
		setPartes(new Set(PARTES.map(p => p.id)));
	}, [open]);

	useEffect(() => {
		if (!open || !origemCredorId) { setSegOptions([]); return; }
		let active = true;
		setSegLoading(true);
		supabase?.from('segmentos_em_uso').select('cluster_id,codigo,nome,estrategia_id').eq('credor_id', origemCredorId).eq('vinculado', true).order('ordem', { ascending: true })
			.then(({ data, error: e }) => {
				if (!active) return;
				if (e) { setError(friendlyError()); setSegOptions([]); }
				else setSegOptions((data ?? []).map((r: Row) => ({ clusterId: r.cluster_id as string, codigo: r.codigo as string, nome: r.nome as string, estrategiaId: (r.estrategia_id as string | null) ?? null })));
				setSegLoading(false);
			});
		return () => { active = false; };
	}, [open, origemCredorId]);

	const origem = useMemo(() => {
		const seg = segOptions.find(s => s.clusterId === segClusterId);
		if (!seg) return null;
		const e = seg.estrategiaId ? estrategias.find(x => x.id === seg.estrategiaId) : null;
		const def = e?.definicao ?? null;
		return { nome: `${seg.nome} (${seg.codigo})`, def, outroCredor: origemCredorId !== currentCredorId };
	}, [segOptions, segClusterId, estrategias, origemCredorId, currentCredorId]);

	function toggleParte(id: ParteId) {
		setPartes(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
	}

	function aplicar() {
		if (!origem || !origem.def) { setError('Escolha uma carteira e um segmento de origem.'); return; }
		if (partes.size === 0) { setError('Marque ao menos uma parte para copiar.'); return; }
		const { def, droppedPersonas } = montarCopiaCarteira(origem.def, defAtual, partes, destinoPersonaIds);
		const norm = normalizarDefinicao(def, [...destinoPersonaIds]);
		onAplicar(norm, origem.nome, droppedPersonas || (origem.outroCredor && partes.has('personas')));
		onClose();
	}

	if (!open) return null;

	return (
		<div className="fixed inset-0 z-50 grid place-items-center bg-[#102e38]/60 p-4" onClick={onClose}>
			<div role="dialog" aria-modal="true" aria-label="Copiar de outra carteira" className="max-h-[92vh] w-full max-w-2xl overflow-auto rounded-xl bg-white p-6 shadow-xl sm:p-8" onClick={e => e.stopPropagation()}>
				<div className="mb-5 flex items-center justify-between">
					<div className="flex items-center gap-2"><Copy size={20} className="text-[#0F4C5C]" /><h2 className="text-lg font-semibold">Copiar de outra carteira</h2></div>
					<button onClick={onClose} aria-label="Fechar"><X size={20} /></button>
				</div>
				<p className="mb-5 text-sm text-slate-500">Copia partes da estratégia de origem para o editor, sem salvar. Revise e clique em Salvar para valer. Ao salvar, o MotorCX cria uma estratégia nova só desta carteira; a de origem não muda.</p>

				<div className="mb-4 space-y-3">
					<div>
						<label className="mb-1 block text-xs font-semibold text-slate-600">Carteira de origem</label>
						<select value={origemCredorId} onChange={e => { setOrigemCredorId(e.target.value); setSegClusterId(''); }} className="h-10 w-full rounded-lg border border-[#d8e3e5] bg-white px-3 text-sm outline-none focus:border-[#0F4C5C]">
							<option value="">Escolha a carteira...</option>
							{credores.filter(c => c.id !== currentCredorId).map(c => <option key={c.id} value={c.id}>{c.nome}</option>)}
						</select>
					</div>
					{origemCredorId && (
						segLoading ? <p className="text-xs text-slate-400">Carregando segmentos...</p> : (
							<div>
								<label className="mb-1 block text-xs font-semibold text-slate-600">Segmento de origem</label>
								<div className="max-h-44 space-y-1 overflow-auto rounded-lg border border-[#e2eaec] p-2">
									{segOptions.length === 0 && <p className="px-2 py-4 text-center text-xs text-slate-400">Nenhum segmento em uso nesta carteira.</p>}
									{segOptions.map(s => (
										<button key={s.clusterId} onClick={() => setSegClusterId(s.clusterId)} className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm ${segClusterId === s.clusterId ? 'bg-[#eaf2f3] ring-1 ring-[#0F4C5C]' : 'hover:bg-[#f5f8f9]'}`}>
											<span className="grid h-6 w-6 shrink-0 place-items-center rounded bg-[#0F4C5C] text-[9px] font-bold text-white">{s.codigo}</span>
											<span className="font-medium text-[#163943]">{s.nome}</span>
										</button>
									))}
								</div>
							</div>
						)
					)}
				</div>

				{origem?.outroCredor && partes.has('personas') && (
					<p className="mb-4 rounded-lg bg-[#fff7e8] px-4 py-3 text-xs leading-relaxed text-[#9a631b]">As raias de personas da origem são de outra carteira e só serão copiadas para as personas que existem aqui — o público geral vem completo.</p>
				)}

				<div className="mb-5">
					<p className="mb-2 text-xs font-semibold text-slate-600">O que copiar</p>
					<div className="grid gap-2 sm:grid-cols-2">
						{PARTES.map(p => (
							<label key={p.id} className="flex cursor-pointer items-center gap-2 rounded-lg border border-[#e2eaec] bg-[#fafcfc] px-3 py-2 text-sm">
								<input type="checkbox" checked={partes.has(p.id)} onChange={() => toggleParte(p.id)} className="accent-[#0F4C5C]" />
								<span className="text-[#163943]">{p.label}</span>
							</label>
						))}
					</div>
				</div>

				{error && <p role="alert" className="mb-4 text-sm text-[#C62828]">{error}</p>}
				{error && <ErrorDetail />}

				<div className="flex justify-end gap-3">
					<button onClick={onClose} className="h-11 rounded-lg border border-[#c9dadd] px-5 text-sm font-semibold text-[#304b55] hover:bg-[#edf4f5]">Cancelar</button>
					<button onClick={aplicar} disabled={!origem || partes.size === 0} className="flex h-11 items-center gap-2 rounded-lg bg-[#0F4C5C] px-6 text-sm font-semibold text-white hover:bg-[#0d4252] disabled:opacity-50"><Copy size={16} /> Copiar para o editor</button>
				</div>
				<p className="mt-3 text-[11px] text-slate-400">Copia para o editor sem salvar. Ao salvar, cria uma estratégia nova só desta carteira.</p>
			</div>
		</div>
	);
}
