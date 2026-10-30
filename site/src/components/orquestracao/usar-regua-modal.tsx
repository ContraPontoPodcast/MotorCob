import { useState } from 'react';
import { toast } from 'sonner';
import { X } from 'lucide-react';
import { type Definicao, type Passos, type Estrategia } from '@/lib/estrategia';
import { type EstagioId } from './regua-topo';

function normPassos(p: unknown): Passos {
	if (!p || typeof p !== 'object') return {};
	const out: Passos = {};
	for (const [k, v] of Object.entries(p as Record<string, unknown>)) {
		if (Array.isArray(v)) out[k] = v as never;
	}
	return out;
}

function passosTemAcao(passos: Passos | undefined): boolean {
	if (!passos) return false;
	for (const arr of Object.values(passos)) {
		if (arr.some(a => a.canal && a.canal !== 'sem_acao')) return true;
	}
	return false;
}

/** Diz se a estratégia tem régua no estágio escolhido. */
function temReguaEstagio(def: Definicao | null, id: EstagioId): boolean {
	if (!def) return false;
	if (id === 'localizacao') return passosTemAcao(normPassos(def.localizacao?.passos));
	if (id === 'cpc') return (def.cpc?.ordem?.some(a => a.canal) ?? false);
	if (id === 'giro') return passosTemAcao(normPassos(def.giro?.passos));
	// acordo
	return passosTemAcao(normPassos(def.preventivo?.passos)) || passosTemAcao(normPassos(def.quebra?.passos));
}

/** Copia os passos do estágio da origem para a definição destino. */
export function copiarReguaEstagio(dest: Definicao, origem: Definicao, id: EstagioId): Definicao {
	const next = { ...dest };
	if (id === 'localizacao') {
		next.localizacao = { ...(dest.localizacao ?? { passos: {}, dias_sem_contato_para_ncp: 8 }), passos: normPassos(origem.localizacao?.passos) };
	} else if (id === 'cpc') {
		next.cpc = { ...(dest.cpc ?? { ordem: [], junto: [], tentativas_por_canal: 3 }), ordem: origem.cpc?.ordem ?? [], junto: origem.cpc?.junto ?? [], tentativas_por_canal: origem.cpc?.tentativas_por_canal ?? 3, intervalo_cpa: origem.cpc?.intervalo_cpa, intervalo_cpb: origem.cpc?.intervalo_cpb };
	} else if (id === 'giro') {
		next.giro = { ...(dest.giro ?? { passos: {}, ciclo_dias: 8, max_ciclos: 3 }), passos: normPassos(origem.giro?.passos) };
	} else {
		// acordo: copia preventivo e quebra
		next.preventivo = { ...(dest.preventivo ?? { passos: {} }), passos: normPassos(origem.preventivo?.passos) };
		next.quebra = { ...(dest.quebra ?? { passos: {}, dias_para_estoque: 6 }), passos: normPassos(origem.quebra?.passos) };
	}
	return next;
}

export function UsarReguaModal({ open, onClose, estrategias, estrIdAtual, estagio, onAplicar }: {
	open: boolean;
	onClose: () => void;
	estrategias: Estrategia[];
	estrIdAtual: string | null;
	estagio: EstagioId;
	onAplicar: (def: Definicao, nome: string) => void;
}) {
	const [busy, setBusy] = useState('');
	if (!open) return null;
	// Estratégias da empresa (exceto a atual) que têm régua neste estágio.
	const opcoes = estrategias.filter(e => e.id !== estrIdAtual && temReguaEstagio(e.definicao, estagio));

	function aplicar(e: Estrategia) {
		if (!e.definicao) return;
		setBusy(e.id);
		onAplicar(e.definicao, e.nome);
		toast.success(`Régua de ${e.nome} copiada para este estágio. Revise e clique em Salvar.`);
		setBusy('');
		onClose();
	}

	return (
		<div className="fixed inset-0 z-50 grid place-items-center bg-[#102e38]/60 p-4" onClick={onClose}>
			<div role="dialog" aria-modal="true" aria-label="Usar a régua de" className="max-h-[88vh] w-full max-w-lg overflow-auto rounded-xl bg-[var(--base-cartao)] p-6 shadow-xl" onClick={e => e.stopPropagation()}>
				<div className="mb-4 flex items-center justify-between">
					<h2 className="text-base font-semibold text-[var(--base-texto)]">Usar a régua de…</h2>
					<button onClick={onClose} aria-label="Fechar" className="grid h-8 w-8 place-items-center rounded-lg text-[var(--base-texto-3)] hover:bg-[var(--base-fill)]"><X size={18} /></button>
				</div>
				<p className="mb-4 text-[13px] leading-relaxed text-[var(--base-texto-2)]">Réguas que a sua empresa já tem neste estágio. Usar = copiar. A cópia é sua: mudar aqui não muda a origem.</p>
				{opcoes.length === 0 ? (
					<p className="rounded-lg border border-dashed border-[var(--base-borda)] bg-[var(--base-fill)] px-4 py-6 text-center text-[13px] text-[var(--base-texto-3)]">Nenhuma estratégia da empresa tem régua neste estágio ainda.</p>
				) : (
					<div className="space-y-2">
						{opcoes.map(e => (
							<button key={e.id} type="button" onClick={() => aplicar(e)} disabled={busy === e.id} className="flex w-full items-center justify-between gap-3 rounded-lg border border-[var(--base-borda)] bg-[var(--base-fill)] px-4 py-3 text-left transition hover:bg-[var(--base-fill-2)] disabled:opacity-50">
								<div className="min-w-0">
									<p className="truncate text-[13px] font-semibold text-[var(--base-texto)]">{e.nome}</p>
									{e.descricao && <p className="truncate text-[11px] text-[var(--base-texto-3)]">{e.descricao}</p>}
								</div>
								<span className="shrink-0 rounded-full px-3 py-1 text-[11px] font-semibold text-[var(--destaque-texto)]" style={{ backgroundColor: 'var(--destaque)' }}>Usar</span>
							</button>
						))}
					</div>
				)}
			</div>
		</div>
	);
}
