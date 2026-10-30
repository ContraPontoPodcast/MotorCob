import { useEffect, useMemo, useState } from 'react';
import { Check, Search, X } from 'lucide-react';
import { canalTipoMensagem, fraseCanalLabel, frasePreview, templateCodigoOf, type Frase } from '@/lib/frases';
import { canalLabel, type MensagemAcao, type MensagemRef } from '@/lib/estrategia';

function canalNome(canal: string) {
	return fraseCanalLabel[canal] ?? canalLabel[canal] ?? canal;
}

/** Lista pesquisável de templates/frases de um canal, com botão "Sem template/frase". */
export function ListaMensagens({ canal, frases, fraseId, onPick, onClear }: {
	canal: string; frases: Frase[]; fraseId: string | undefined;
	onPick: (id: string) => void; onClear: () => void;
}) {
	const isTemplate = canalTipoMensagem(canal) === 'template';
	const [busca, setBusca] = useState('');
	const lista = useMemo(() => {
		const q = busca.trim().toLowerCase();
		return frases.filter(f => f.canal === canal && f.ativo).filter(f => {
			if (!q) return true;
			return f.nome.toLowerCase().includes(q)
				|| frasePreview(f).toLowerCase().includes(q)
				|| templateCodigoOf(f).toLowerCase().includes(q);
		});
	}, [frases, canal, busca]);
	const placeholder = isTemplate ? 'Buscar por nome ou código do template' : 'Buscar por nome ou texto';
	const clearLabel = isTemplate ? 'Sem template' : 'Sem frase';
	return (
		<div className="flex flex-col">
			<div className="relative mb-3">
				<Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
				<input value={busca} onChange={e => setBusca(e.target.value)} placeholder={placeholder} className="h-9 w-full rounded-lg border border-[#d8e3e5] pl-9 pr-3 text-sm outline-none focus:border-[#0F4C5C]" />
			</div>
			<div className="max-h-[300px] overflow-auto">
				{lista.length === 0 ? (
					<p className="py-6 text-center text-sm text-slate-400">{busca ? `Nenhum resultado para “${busca}”.` : (isTemplate ? 'Nenhum template cadastrado neste canal.' : 'Nenhuma frase cadastrada neste canal.')}</p>
				) : (
					<div className="space-y-1.5">
						{lista.map(f => {
							const chosen = !!fraseId && f.id === fraseId;
							return (
								<button key={f.id} type="button" onClick={() => onPick(f.id)} className={`block w-full rounded-lg border p-3 text-left transition ${chosen ? 'border-[#0F4C5C] bg-[#eaf2f3] ring-1 ring-[#0F4C5C]' : 'border-[#e2eaec] hover:bg-[#f5f8f9]'}`}>
									<div className="flex items-center justify-between gap-2">
										<span className="text-[15px] font-semibold text-[#163943]">{f.nome}</span>
										{chosen && <Check size={16} className="shrink-0 text-[#0F4C5C]" />}
									</div>
									{isTemplate && <p className="mt-0.5 text-xs text-slate-400">{templateCodigoOf(f) || 'sem código'}</p>}
									<p className="mt-0.5 line-clamp-1 text-[13px] text-slate-500">{frasePreview(f)}</p>
								</button>
							);
						})}
					</div>
				)}
			</div>
			<div className="mt-3 flex justify-end border-t border-[#ecf0f1] pt-3">
				<button type="button" onClick={onClear} className="h-9 rounded-lg border border-[#c9dadd] px-4 text-sm font-semibold text-slate-600 hover:bg-[#edf4f5]">{clearLabel}</button>
			</div>
		</div>
	);
}

function useEsc(onClose: () => void) {
	useEffect(() => {
		function onEsc(e: KeyboardEvent) { if (e.key === 'Escape') onClose(); }
		window.addEventListener('keydown', onEsc);
		return () => window.removeEventListener('keydown', onEsc);
	}, [onClose]);
}

/** Painel de escolha de template/frase para uma ação de dia (público geral ou persona). */
export function EscolherMensagem({ canal, fraseId, frases, onSet, onClose, tituloExtra }: {
	canal: string; fraseId: string | undefined; frases: Frase[];
	onSet: (m: { frase_id: string } | null) => void; onClose: () => void; tituloExtra?: string;
}) {
	const isTemplate = canalTipoMensagem(canal) === 'template';
	const titulo = isTemplate ? 'Escolher template' : 'Escolher frase';
	const sub = isTemplate ? `${canalNome(canal)} · templates aprovados no provedor` : `${canalNome(canal)} · frases da empresa`;
	useEsc(onClose);
	return (
		<div className="fixed inset-0 z-50 grid place-items-center bg-[#102e38]/60 p-4" onClick={onClose}>
			<div role="dialog" aria-modal="true" className="max-h-[92vh] w-full max-w-[520px] overflow-auto rounded-2xl bg-white p-6 shadow-xl" onClick={e => e.stopPropagation()}>
				<div className="mb-4 flex items-start justify-between gap-3">
					<div>
						<h3 className="text-lg font-semibold">{titulo}{tituloExtra ? ` · ${tituloExtra}` : ''}</h3>
						<p className="text-xs text-slate-400">{sub}</p>
					</div>
					<button onClick={onClose} className="text-slate-400 hover:text-[#0F4C5C]"><X size={20} /></button>
				</div>
				<ListaMensagens canal={canal} frases={frases} fraseId={fraseId} onPick={id => onSet({ frase_id: id })} onClear={() => onSet(null)} />
			</div>
		</div>
	);
}

function refFraseId(r: MensagemRef | undefined): string | undefined {
	if (r == null) return undefined;
	if (typeof r === 'string') return undefined;
	if ('frase_id' in r) return r.frase_id;
	return undefined;
}
function cpcRef(m: MensagemAcao | undefined, chave: 'cpa' | 'cpb'): string | undefined {
	if (m == null) return undefined;
	if (typeof m === 'string') return undefined;
	if ('frase_id' in m) return refFraseId(m as MensagemRef);
	const obj = m as Record<string, MensagemRef>;
	return refFraseId(obj?.[chave]);
}
function cpcMesma(m: MensagemAcao | undefined): boolean {
	if (m == null) return true;
	if (typeof m === 'string' || 'frase_id' in m) return true;
	const obj = m as Record<string, MensagemRef>;
	return JSON.stringify(obj?.cpa) === JSON.stringify(obj?.cpb);
}

/** Painel de escolha de template/frase para o Deu CPC, com CPC A / CPC B (mesma ou separadas). */
export function EscolherMensagemCpc({ canal, mensagem, frases, onClose, onSet, tituloExtra }: {
	canal: string; mensagem: MensagemAcao | undefined; frases: Frase[];
	onClose: () => void; onSet: (m: MensagemAcao | null) => void; tituloExtra?: string;
}) {
	const isTemplate = canalTipoMensagem(canal) === 'template';
	const titulo = isTemplate ? 'Escolher template' : 'Escolher frase';
	const sub = isTemplate ? `${canalNome(canal)} · templates aprovados no provedor` : `${canalNome(canal)} · frases da empresa`;
	const [mesma, setMesma] = useState(cpcMesma(mensagem));
	const cpaId = cpcRef(mensagem, 'cpa');
	const cpbId = cpcRef(mensagem, 'cpb');
	const sharedId = (() => {
		if (mensagem == null) return undefined;
		if (typeof mensagem === 'string' || 'frase_id' in (mensagem as object)) return refFraseId(mensagem as MensagemRef);
		return cpaId;
	})();
	useEsc(onClose);

	function setShared(id: string | null) {
		onSet(id ? { frase_id: id } : null);
	}
	function setCpa(id: string | null) {
		const cpa = id ? { frase_id: id } : undefined;
		const cpb = cpbId ? { frase_id: cpbId } : undefined;
		if (!cpa && !cpb) onSet(null);
		else onSet({ cpa, cpb } as unknown as MensagemAcao);
	}
	function setCpb(id: string | null) {
		const cpb = id ? { frase_id: id } : undefined;
		const cpa = cpaId ? { frase_id: cpaId } : undefined;
		if (!cpa && !cpb) onSet(null);
		else onSet({ cpa, cpb } as unknown as MensagemAcao);
	}

	return (
		<div className="fixed inset-0 z-50 grid place-items-center bg-[#102e38]/60 p-4" onClick={onClose}>
			<div role="dialog" aria-modal="true" className="max-h-[92vh] w-full max-w-[520px] overflow-auto rounded-2xl bg-white p-6 shadow-xl" onClick={e => e.stopPropagation()}>
				<div className="mb-4 flex items-start justify-between gap-3">
					<div>
						<h3 className="text-lg font-semibold">{titulo}{tituloExtra ? ` · ${tituloExtra}` : ''}</h3>
						<p className="text-xs text-slate-400">{sub}</p>
					</div>
					<button onClick={onClose} className="text-slate-400 hover:text-[#0F4C5C]"><X size={20} /></button>
				</div>
				<label className="mb-4 flex cursor-pointer items-center gap-2 text-xs font-semibold text-slate-600">
					<input type="checkbox" checked={mesma} onChange={e => { setMesma(e.target.checked); if (e.target.checked) setShared(cpaId ?? null); }} className="accent-[#0F4C5C]" />
					Mesma frase para CPC A e CPC B
				</label>
				{mesma ? (
					<ListaMensagens canal={canal} frases={frases} fraseId={sharedId} onPick={setShared} onClear={() => setShared(null)} />
				) : (
					<div className="space-y-5">
						<div>
							<p className="mb-2 text-xs font-bold uppercase tracking-wider text-slate-400">CPC A</p>
							<ListaMensagens canal={canal} frases={frases} fraseId={cpaId} onPick={setCpa} onClear={() => setCpa(null)} />
						</div>
						<div>
							<p className="mb-2 text-xs font-bold uppercase tracking-wider text-slate-400">CPC B</p>
							<ListaMensagens canal={canal} frases={frases} fraseId={cpbId} onPick={setCpb} onClear={() => setCpb(null)} />
						</div>
					</div>
				)}
			</div>
		</div>
	);
}
