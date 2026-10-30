import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { toast } from 'sonner';
import { Users, Wand2, X } from 'lucide-react';
import { friendlyError, numberBR, supabase, type PersonaUsuario } from '@/lib/supabase';
import { ErrorDetail } from '@/components/error-detail';
import { type Acao, type Definicao, type Passos } from '@/lib/estrategia';

/** Os 6 canais de contato (sem enriquecimento). */
const CANAIS_6 = [
	{ id: 'whatsapp', label: 'WhatsApp', cor: '#1F8A4C' },
	{ id: 'rcs', label: 'RCS', cor: '#3B5BA9' },
	{ id: 'sms', label: 'SMS', cor: '#7A4FB0' },
	{ id: 'email', label: 'E-mail', cor: '#A2552B' },
	{ id: 'agente_voz', label: 'Agente virtual', cor: '#0E7C86' },
	{ id: 'discador', label: 'Discador', cor: '#475569' },
] as const;
const canalIdPorLabel: Record<string, string> = Object.fromEntries(CANAIS_6.map(c => [c.label, c.id]));
const canalLabelPorId: Record<string, string> = Object.fromEntries(CANAIS_6.map(c => [c.id, c.label]));

/** Canais sugeridos de uma persona: do modelo de mesmo nome, ou lidos da descrição. */
export function canaisSugeridosDe(persona: PersonaUsuario, modelosMap: Record<string, string[]>): string[] {
	const m = modelosMap[persona.nome];
	if (m?.length) return [...m];
	if (!persona.descricao) return [];
	const idx = persona.descricao.indexOf(' · Canais sugeridos: ');
	if (idx < 0) return [];
	const rest = persona.descricao.slice(idx + ' · Canais sugeridos: '.length);
	return rest.split(',').map(s => s.trim()).map(n => canalIdPorLabel[n]).filter(Boolean) as string[];
}

/** Conjunto de ids de persona que aparecem em alguma ação da esteira. */
export function personaIdsNaEsteira(def: Definicao | null | undefined): Set<string> {
	const ids = new Set<string>();
	const collect = (passos?: Passos) => {
		if (!passos) return;
		for (const arr of Object.values(passos)) {
			for (const a of arr) {
				if (a.personas) a.personas.forEach(id => ids.add(id));
			}
		}
	};
	if (!def) return ids;
	collect(def.localizacao?.passos);
	collect(def.giro?.passos);
	collect(def.preventivo?.passos);
	collect(def.quebra?.passos);
	return ids;
}

/** Divide ações com várias personas em uma ação por persona. */
export function splitMultiPersona(arr: Acao[]): Acao[] {
	const out: Acao[] = [];
	for (const a of arr) {
		if (a.personas && a.personas.length > 1) {
			for (const id of a.personas) out.push({ ...a, personas: [id] });
		} else {
			out.push(a);
		}
	}
	return out;
}

/** Mantém só a 1ª ocorrência de cada canal dentro de uma raia (público geral ou persona). */
function dedupLane(arr: Acao[]): Acao[] {
	const seen = new Set<string>();
	const out: Acao[] = [];
	for (const a of arr) {
		if (seen.has(a.canal)) continue;
		seen.add(a.canal);
		out.push(a);
	}
	return out;
}

/** Normaliza a definição para gravar: uma ação por persona, público geral primeiro, personas na ordem, sem canal repetido na mesma raia. */
export function normalizarDefinicao(def: Definicao, personaOrder: string[]): Definicao {
	const norm = (passos?: Passos): Passos | undefined => {
		if (!passos) return passos;
		const out: Passos = {};
		for (const [k, arr] of Object.entries(passos)) {
			const split = splitMultiPersona(arr);
			const lanes: Record<string, Acao[]> = { pub: [] };
			for (const a of split) {
				const key = a.personas?.length === 1 ? a.personas[0] : 'pub';
				(lanes[key] ??= []).push(a);
			}
			const ordered: Acao[] = [...dedupLane(lanes.pub)];
			for (const pid of personaOrder) if (lanes[pid]) ordered.push(...dedupLane(lanes[pid]));
			for (const pid of Object.keys(lanes)) if (pid !== 'pub' && !personaOrder.includes(pid)) ordered.push(...dedupLane(lanes[pid]));
			out[k] = ordered;
		}
		return out;
	};
	return {
		...def,
		localizacao: def.localizacao ? { ...def.localizacao, passos: norm(def.localizacao.passos) ?? {} } : def.localizacao,
		giro: def.giro ? { ...def.giro, passos: norm(def.giro.passos) ?? {} } : def.giro,
		preventivo: def.preventivo ? { ...def.preventivo, passos: norm(def.preventivo.passos) ?? {} } : def.preventivo,
		quebra: def.quebra ? { ...def.quebra, passos: norm(def.quebra.passos) ?? {} } : def.quebra,
	};
}

/** Remove ids de persona que não estão mais ativos na carteira. */
export function limparPersonas(def: Definicao, idsValidos: Set<string>): Definicao {
	const limparPassos = (passos?: Passos): Passos | undefined => {
		if (!passos) return passos;
		const out: Passos = {};
		for (const [k, arr] of Object.entries(passos)) {
			out[k] = arr.map(a => {
				if (!a.personas?.length) return a;
				const limpos = a.personas.filter(id => idsValidos.has(id));
				if (limpos.length === a.personas.length) return a;
				const next: Acao = { ...a };
				if (limpos.length) next.personas = limpos; else delete next.personas;
				return next;
			});
		}
		return out;
	};
	return {
		...def,
		localizacao: def.localizacao ? { ...def.localizacao, passos: limparPassos(def.localizacao.passos) ?? {} } : def.localizacao,
		giro: def.giro ? { ...def.giro, passos: limparPassos(def.giro.passos) ?? {} } : def.giro,
		preventivo: def.preventivo ? { ...def.preventivo, passos: limparPassos(def.preventivo.passos) ?? {} } : def.preventivo,
		quebra: def.quebra ? { ...def.quebra, passos: limparPassos(def.quebra.passos) ?? {} } : def.quebra,
	};
}

export function PersonasDaCarteira({ personas, contagens, semPersona, def, modelosMap, canEdit, montarOpen, setMontarOpen, estrId, onSaved }: {
	personas: PersonaUsuario[];
	contagens: Record<string, number>;
	semPersona: number;
	def: Definicao;
	modelosMap: Record<string, string[]>;
	canEdit: boolean;
	montarOpen: boolean;
	setMontarOpen: (v: boolean) => void;
	estrId: string | null;
	onSaved: () => void;
}) {
	const naEsteira = useMemo(() => personaIdsNaEsteira(def), [def]);

	if (personas.length === 0) {
		return (
			<section className="mb-6 rounded-xl border border-[#dfe8ea] bg-white p-5">
				<div className="flex items-center gap-2"><Users size={16} className="text-[#0F4C5C]"/><h2 className="text-sm font-bold text-[#163943]">Personas desta carteira</h2></div>
				<p className="mt-3 text-sm text-slate-500">Esta carteira não tem personas. Crie em <Link to="/personas" className="font-semibold text-[#0F4C5C] underline">Personas</Link> ou use um modelo.</p>
				<p className="mt-2 text-xs text-slate-400">Cada cliente fica na primeira persona que combina com ele. Arraste a persona para um dia no Desenho da Esteira para tratá-la diferente, ou monte a esteira pelas personas.</p>
			</section>
		);
	}

	return (
		<section className="mb-6 rounded-xl border border-[#dfe8ea] bg-white p-5">
			<div className="mb-3 flex flex-wrap items-center justify-between gap-3">
				<div className="flex items-center gap-2"><Users size={16} className="text-[#0F4C5C]"/><h2 className="text-sm font-bold text-[#163943]">Personas desta carteira</h2></div>
				{canEdit && <button onClick={() => setMontarOpen(true)} className="flex h-9 items-center gap-1.5 rounded-lg bg-[#0F4C5C] px-4 text-xs font-semibold text-white hover:bg-[#0d4252]"><Wand2 size={14}/> Montar esteira pelas personas</button>}
			</div>
			<div className="flex flex-wrap items-center gap-2">
				{personas.map(p => {
					const na = naEsteira.has(p.id);
					return (
						<span key={p.id} className="inline-flex items-center gap-2 rounded-full border border-[#e2eaec] bg-[#fafcfc] py-1 pl-2 pr-3 text-xs">
							<span className="h-3 w-3 rounded-full" style={{ backgroundColor: p.cor }}/>
							<span className="font-semibold text-[#163943]">{p.nome}</span>
							<span className="text-slate-400">{numberBR(contagens[p.nome] ?? 0)} clientes</span>
							<span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${na ? 'bg-green-100 text-[#2E7D32]' : 'bg-[#fff3df] text-[#9a631b]'}`} title={na ? 'Tem raia em algum dia' : 'Segue o público geral'}>{na ? 'Na esteira' : 'Fora da esteira · segue o geral'}</span>
						</span>
					);
				})}
				<span className="inline-flex items-center gap-2 rounded-full border border-[#e2eaec] bg-[#f5f7f8] py-1 pl-2 pr-3 text-xs">
					<span className="h-3 w-3 rounded-full bg-slate-300"/>
					<span className="font-semibold text-slate-500">Sem persona</span>
					<span className="text-slate-400">{numberBR(semPersona)} clientes</span>
				</span>
			</div>
			<p className="mt-3 text-xs text-slate-400">Cada cliente fica na primeira persona que combina com ele. Arraste a persona para um dia no Desenho da Esteira para tratá-la diferente, ou monte a esteira pelas personas. <Link to="/personas" className="font-semibold text-[#0F4C5C] underline">Gerenciar personas</Link></p>

			{montarOpen && <MontarPorPersonas personas={personas} def={def} modelosMap={modelosMap} estrId={estrId} onClose={() => setMontarOpen(false)} onSaved={onSaved} />}
		</section>
	);
}

function MontarPorPersonas({ personas, def, modelosMap, estrId, onClose, onSaved }: {
	personas: PersonaUsuario[]; def: Definicao; modelosMap: Record<string, string[]>; estrId: string | null; onClose: () => void; onSaved: () => void;
}) {
	const [faixa, setFaixa] = useState<'localizacao' | 'giro'>('localizacao');
	const [marked, setMarked] = useState<Set<string>>(new Set());
	const [selectedDays, setSelectedDays] = useState<Set<number>>(new Set());
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState('');

	const passos = def[faixa]?.passos ?? {};
	const dias = useMemo(() => Object.keys(passos).map(Number).filter(d => (passos[String(d)] ?? []).length > 0).sort((a, b) => a - b), [passos]);
	useEffect(() => { setSelectedDays(new Set(dias)); }, [faixa, dias.join(',')]);

	function toggleMark(pid: string) {
		setMarked(prev => { const n = new Set(prev); if (n.has(pid)) n.delete(pid); else n.add(pid); return n; });
	}
	function toggleDay(d: number) {
		setSelectedDays(prev => { const n = new Set(prev); if (n.has(d)) n.delete(d); else n.add(d); return n; });
	}

	const markedPersonas = personas.filter(p => marked.has(p.id));
	const dayList = Array.from(selectedDays).sort((a, b) => a - b);

	const preview = useMemo(() => {
		if (markedPersonas.length === 0) return 'Marque ao menos uma persona para ver a prévia.';
		if (dayList.length === 0) return 'Selecione ao menos um dia.';
		return markedPersonas.map(p => {
			const sug = canaisSugeridosDe(p, modelosMap);
			if (sug.length === 0) return `${p.nome}: sem canais sugeridos`;
			const parts = dayList.map((d, idx) => {
				const canal = sug[Math.min(idx, sug.length - 1)];
				return `D+${d} ${canalLabelPorId[canal] ?? canal}`;
			});
			return `${p.nome}: ${parts.join(', ')}`;
		}).join('  ·  ');
	}, [markedPersonas, dayList]);

	async function confirmar() {
		if (!supabase || !estrId) { setError('Estratégia não encontrada.'); return; }
		if (markedPersonas.length === 0) { setError('Marque ao menos uma persona.'); return; }
		if (dayList.length === 0) { setError('Selecione ao menos um dia.'); return; }
		const semSug = markedPersonas.find(p => canaisSugeridosDe(p, modelosMap).length === 0);
		if (semSug) { setError(`${semSug.nome} não tem canais sugeridos.`); return; }
		if (!window.confirm('Isso cria a raia de cada persona marcada nesses dias, sem mexer no público geral nem nas personas não marcadas. Continuar?')) return;
		setBusy(true); setError('');
		const novosPassos: Passos = { ...passos };
		for (const p of markedPersonas) {
			const sug = canaisSugeridosDe(p, modelosMap);
			dayList.forEach((day, idx) => {
				const canal = sug[Math.min(idx, sug.length - 1)];
				const key = String(day);
				const arr = splitMultiPersona(novosPassos[key] ?? []);
				const without = arr.filter(a => !a.personas?.includes(p.id));
				const novo: Acao = { canal, modo: 'sempre', personas: [p.id] };
				novosPassos[key] = [...without, novo];
			});
		}
		const baseDef: Definicao = { ...def };
		if (faixa === 'localizacao') baseDef.localizacao = { ...(def.localizacao ?? { passos: {}, dias_sem_contato_para_ncp: 8 }), passos: novosPassos };
		else baseDef.giro = { ...(def.giro ?? { passos: {}, ciclo_dias: 8, max_ciclos: 3 }), passos: novosPassos };
		const novoDef = normalizarDefinicao(baseDef, personas.map(p => p.id));
		const { error: upErr } = await supabase.from('estrategias').update({ definicao: novoDef as unknown as Record<string, unknown> }).eq('id', estrId);
		setBusy(false);
		if (upErr) { setError(friendlyError()); return; }
		toast.success('Esteira salva · vale a partir da próxima rotina (em até 1 minuto)');
		onSaved();
		onClose();
	}

	return (
		<div className="fixed inset-0 z-50 grid place-items-center bg-[#102e38]/60 p-4" onClick={onClose}>
			<div role="dialog" aria-modal="true" aria-label="Montar esteira pelas personas" className="max-h-[92vh] w-full max-w-2xl overflow-auto rounded-xl bg-white p-6 shadow-xl sm:p-8" onClick={e => e.stopPropagation()}>
				<div className="mb-5 flex items-center justify-between"><h2 className="text-lg font-semibold">Montar esteira pelas personas</h2><button onClick={onClose} aria-label="Fechar"><X size={20}/></button></div>
				<p className="mb-5 text-sm text-slate-500">Marque quais personas devem ter raia própria. Para cada persona marcada, criamos a raia dela nos dias escolhidos, usando o canal sugerido do dia (1º dia = 1º canal sugerido, 2º dia = 2º…; quando acaba, repete o último). O público geral e as personas não marcadas não mudam.</p>

				<div className="mb-5">
					<label className="mb-2 block text-xs font-semibold">Faixa</label>
					<div className="flex gap-2">
						<button onClick={() => setFaixa('localizacao')} className={`rounded-lg px-4 py-2 text-sm font-semibold ${faixa === 'localizacao' ? 'bg-[#0F4C5C] text-white' : 'border border-[#c9dadd] text-[#0F4C5C] hover:bg-[#edf4f5]'}`}>Cliente novo</button>
						<button onClick={() => setFaixa('giro')} className={`rounded-lg px-4 py-2 text-sm font-semibold ${faixa === 'giro' ? 'bg-[#0F4C5C] text-white' : 'border border-[#c9dadd] text-[#0F4C5C] hover:bg-[#edf4f5]'}`}>Não CPC</button>
					</div>
				</div>

				<div className="mb-5 space-y-2">
					<label className="block text-xs font-semibold">Personas</label>
					{personas.map(p => {
						const on = marked.has(p.id);
						const sug = canaisSugeridosDe(p, modelosMap);
						return (
							<label key={p.id} className="flex cursor-pointer items-center gap-3 rounded-lg border border-[#e2eaec] bg-[#fafcfc] px-3 py-2.5">
								<input type="checkbox" checked={on} onChange={() => toggleMark(p.id)} className="accent-[#0F4C5C]" />
								<span className="h-3 w-3 rounded-full" style={{ backgroundColor: p.cor }} />
								<span className="text-sm font-semibold text-[#163943]">{p.nome}</span>
								<span className="ml-auto text-[11px] text-slate-400">{sug.length ? sug.map(c => canalLabelPorId[c] ?? c).join(' → ') : 'sem canais sugeridos'}</span>
							</label>
						);
					})}
				</div>

				<div className="mb-5">
					<label className="mb-2 block text-xs font-semibold">Dias ({dias.length ? dias.map(d => `D+${d}`).join(', ') : 'nenhum dia com ação nesta faixa'})</label>
					{dias.length === 0 ? (
						<p className="text-xs italic text-slate-400">Esta faixa ainda não tem dias com ação. Adicione canais no Desenho da Esteira primeiro.</p>
					) : (
						<div className="flex flex-wrap gap-2">
							{dias.map(d => (
								<label key={d} className={`flex cursor-pointer items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold ${selectedDays.has(d) ? 'border-[#0F4C5C] bg-[#eaf2f3] text-[#0F4C5C]' : 'border-[#c9dadd] text-slate-400'}`}>
									<input type="checkbox" checked={selectedDays.has(d)} onChange={() => toggleDay(d)} className="accent-[#0F4C5C]" /> D+{d}
								</label>
							))}
						</div>
					)}
				</div>

				<div className="mb-5 rounded-lg bg-[#f5f8f9] p-4">
					<p className="mb-1 text-[10px] font-bold uppercase tracking-wider text-slate-400">Prévia</p>
					<p className="text-xs leading-relaxed text-slate-600">{preview}</p>
				</div>

				{error && <p role="alert" className="mb-4 text-sm text-[#C62828]">{error}</p>}
				{error && <ErrorDetail/>}
				<div className="flex justify-end gap-3">
					<button onClick={onClose} className="h-11 rounded-lg border border-[#c9dadd] px-5 text-sm font-semibold text-[#304b55] hover:bg-[#edf4f5]">Cancelar</button>
					<button onClick={confirmar} disabled={busy || markedPersonas.length === 0 || dayList.length === 0} className="h-11 rounded-lg bg-[#0F4C5C] px-6 text-sm font-semibold text-white disabled:opacity-50">{busy ? 'Montando...' : 'Montar esteira'}</button>
				</div>
			</div>
		</div>
	);
}
