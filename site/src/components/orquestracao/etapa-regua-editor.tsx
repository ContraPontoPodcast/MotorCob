import { useState } from 'react';
import { toast } from 'sonner';
import { ArrowLeft, Plus } from 'lucide-react';
import { canalLabel, diaFrase, diaLabelEtapa, faixaDiasEtapa, type Acao, type Definicao, type Passos } from '@/lib/estrategia';
import { AcaoCard } from '@/components/estrategias/estrategia-editor-core';

/** Editor simples da régua de uma etapa (passos por dia), reutilizando o AcaoCard. */
export function EtapaReguaEditor({ def, setDef, etapaId, canEdit, onVoltar }: {
	def: Definicao; setDef: (d: Definicao) => void; etapaId: string; canEdit: boolean; onVoltar: () => void;
}) {
	const etapa = (def.etapas ?? []).find(e => e.id === etapaId);
	const [novoDia, setNovoDia] = useState('');
	if (!etapa) return null;
	const passos: Passos = etapa.passos ?? {};
	const dias = Object.keys(passos).map(Number).sort((a, b) => a - b);
	const { min: minDia, max: maxDia } = faixaDiasEtapa(etapa);

	function setPassos(p: Passos) {
		const etapas = (def.etapas ?? []).map(e => e.id === etapaId ? { ...e, passos: p } : e);
		setDef({ ...def, etapas });
	}
	function addDia() {
		const n = Number(novoDia);
		if (novoDia === '' || Number.isNaN(n)) return;
		if (n < minDia || n > maxDia) { toast.error(`O dia precisa estar entre ${minDia} e ${maxDia}.`); return; }
		const key = String(n);
		if (passos[key]) return;
		setPassos({ ...passos, [key]: [{ canal: 'whatsapp', modo: 'sempre' }] });
		setNovoDia('');
	}
	function updDia(d: string, acoes: Acao[]) { setPassos({ ...passos, [d]: acoes }); }
	function delDia(d: string) { const next = { ...passos }; delete next[d]; setPassos(next); }

	return (
		<div className="rounded-xl border border-[var(--base-borda)] bg-[var(--base-cartao)] p-5">
			<div className="mb-4 flex items-center gap-3">
				<button type="button" onClick={onVoltar} className="flex h-9 items-center gap-1.5 rounded-lg border border-[var(--base-borda)] px-3 text-[13px] font-semibold text-[var(--base-texto)] hover:bg-[var(--base-fill)]"><ArrowLeft size={14} /> Estágios</button>
				<h3 className="text-[15px] font-bold text-[var(--base-texto)]">Régua de “{etapa.nome}”</h3>
			</div>
			<p className="mb-4 text-[12px] text-[var(--base-texto-2)]">Monte a régua por dia. O motor segue esta régua enquanto o cliente estiver neste estágio.</p>
			<div className="space-y-4">
				{dias.length === 0 && (
					<div className="rounded-lg border border-dashed border-[var(--base-borda)] bg-[var(--base-fill)] p-8 text-center text-sm text-[var(--base-texto-3)]">
						Nenhum dia ainda. {canEdit ? 'Adicione o primeiro dia abaixo.' : 'Sem régua — o motor ignora esta etapa.'}
					</div>
				)}
				{dias.map(d => {
					const key = String(d);
					const acoes = passos[key] ?? [];
					const fora = d < minDia || d > maxDia;
					return (
						<div key={key} className={`rounded-lg border bg-[var(--base-cartao)] p-4 ${fora ? 'border-[var(--estado-erro)]' : 'border-[var(--base-borda)]'}`}>
							<div className="mb-3 flex items-center justify-between">
								<span className={`text-xs font-bold ${fora ? 'text-[var(--estado-erro)]' : 'text-[var(--base-texto)]'}`}>{diaLabelEtapa(etapa, d)}{fora && <span className="ml-2 rounded-full bg-[var(--estado-erro-fundo)] px-1.5 py-0.5 text-[9px] font-bold uppercase text-[var(--estado-erro-texto)]">fora do prazo</span>}</span>
								{canEdit && <button type="button" onClick={() => delDia(key)} className="text-xs text-[var(--base-texto-3)] hover:text-[var(--estado-erro)]">remover dia</button>}
							</div>
							{canEdit ? (
								<div className="space-y-2">
									{acoes.map((a, i) => (
										<AcaoCard key={i} acao={a} index={i} total={acoes.length} comModo onChange={x => updDia(key, acoes.map((c, idx) => idx === i ? x : c))} onMove={dir => { const j = i + dir; if (j < 0 || j >= acoes.length) return; const next = [...acoes]; [next[i], next[j]] = [next[j], next[i]]; updDia(key, next); }} onRemove={() => updDia(key, acoes.filter((_, idx) => idx !== i))} />
									))}
									<button type="button" onClick={() => updDia(key, [...acoes, { canal: 'whatsapp', modo: 'senao' }])} className="flex items-center gap-1.5 rounded-lg border border-dashed border-[var(--area)] px-3 py-2 text-xs font-semibold text-[var(--area)] hover:bg-[var(--base-fill)]"><Plus size={14} /> ação</button>
								</div>
							) : (
								<p className="text-xs text-[var(--base-texto-2)]">{diaFrase(acoes) || '—'}</p>
							)}
							<p className="mt-3 rounded bg-[var(--base-fill)] px-3 py-2 text-xs text-[var(--base-texto-2)]">{diaFrase(acoes) || '—'}</p>
						</div>
					);
				})}
				{canEdit && (
					<div className="flex items-center gap-2">
						<span className="text-xs font-semibold text-[var(--base-texto-3)]">D+</span>
						<input type="number" value={novoDia} onChange={e => setNovoDia(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') addDia(); }} placeholder={`${minDia}–${maxDia}`} className="h-9 w-24 rounded border border-[var(--base-field-border)] bg-[var(--base-cartao)] px-2 text-xs outline-none focus:border-[var(--area)]" />
						<button type="button" onClick={addDia} className="flex items-center gap-1.5 rounded-lg border border-[var(--area)] px-3 py-2 text-xs font-semibold text-[var(--area)] hover:bg-[var(--base-fill)]"><Plus size={14} /> Adicionar dia</button>
					</div>
				)}
			</div>
			<p className="mt-4 text-[11px] text-[var(--base-texto-3)]">{Object.values(passos).flat().length} ações no total.</p>
		</div>
	);
}
