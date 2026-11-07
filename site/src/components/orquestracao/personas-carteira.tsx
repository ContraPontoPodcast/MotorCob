import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { toast } from 'sonner';
import { Users, Wand2, X } from 'lucide-react';
import { numberBR, type PersonaUsuario } from '@/lib/supabase';
import { diaLabelEtapa, isFaseId, type Acao, type Definicao, type Passos } from '@/lib/estrategia';
import { copiarReguaPadrao, estagiosDaEstrategia, type EstagioDaEstrategia } from '@/lib/estagios-regua';

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
	(def.etapas ?? []).forEach(e => collect(e.passos));
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
	const norm = (passos: Passos): Passos => {
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
	return porFaseComPassos(def, norm);
}

/**
 * Aplica `f` aos passos de cada fase QUE TEM passos e aos das etapas. Fase sem a chave "passos" continua sem ela: para o
 * motor, sem "passos" = régua padrão do motor; "passos": {} = ninguém da fase recebe ação (lib/estagios-regua). Antes
 * o salvar gravava {} nas fases do modelo "Estágios clássicos" e elas paravam de acionar.
 */
export function porFaseComPassos(def: Definicao, f: (p: Passos) => Passos): Definicao {
	const out: Definicao = { ...def };
	for (const fase of ['localizacao', 'giro', 'preventivo', 'quebra'] as const) {
		const o = def[fase] as { passos?: Passos } | undefined;
		if (o && o.passos) (out as Record<string, unknown>)[fase] = { ...o, passos: f(o.passos) };
	}
	if (def.etapas) out.etapas = def.etapas.map(e => (e.passos ? { ...e, passos: f(e.passos) } : e));
	return out;
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
	return porFaseComPassos(def, p => limparPassos(p) ?? {});
}

/** Estágios que aceitam raia por persona (os que têm régua por dia): fases ligadas (menos Deu CPC) e etapas ligadas. */
export function estagiosParaPersonas(def: Definicao): EstagioDaEstrategia[] {
	return estagiosDaEstrategia(def).filter(e => e.ativo && e.id !== 'cpc');
}

/** Passos (régua por dia) de um estágio: fase → definicao.<fase>.passos; etapa → etapa.passos. */
export function passosDoEstagio(def: Definicao, id: string): Passos | undefined {
	if (isFaseId(id)) return (def[id] as { passos?: Passos } | undefined)?.passos;
	return (def.etapas ?? []).find(e => e.id === id)?.passos;
}

function comPassos(def: Definicao, id: string, passos: Passos): Definicao {
	if (isFaseId(id)) return { ...def, [id]: { ...(def[id] ?? {}), passos } } as Definicao;
	return { ...def, etapas: (def.etapas ?? []).map(e => (e.id === id ? { ...e, passos } : e)) };
}

/** Dias com ação do estágio, em ordem. */
export function diasComAcao(passos: Passos | undefined): number[] {
	if (!passos) return [];
	return Object.keys(passos).map(Number).filter(d => !Number.isNaN(d) && (passos[String(d)] ?? []).length > 0).sort((a, b) => a - b);
}

/** Personas que já têm raia em algum dia do estágio (o que vem marcado ao abrir). */
export function personasComRaia(passos: Passos | undefined): Set<string> {
	const ids = new Set<string>();
	for (const arr of Object.values(passos ?? {})) for (const a of arr) (a.personas ?? []).forEach(id => ids.add(id));
	return ids;
}

/** Cria a raia de cada persona marcada nos dias escolhidos (canal sugerido do dia); o resto do dia não muda. */
export function montarRaias(passos: Passos, marcadas: PersonaUsuario[], dias: number[], modelosMap: Record<string, string[]>): Passos {
	const novos: Passos = { ...passos };
	for (const p of marcadas) {
		const sug = canaisSugeridosDe(p, modelosMap);
		if (!sug.length) continue;
		dias.forEach((day, idx) => {
			const canal = sug[Math.min(idx, sug.length - 1)];
			const key = String(day);
			const arr = splitMultiPersona(novos[key] ?? []);
			novos[key] = [...arr.filter(a => !a.personas?.includes(p.id)), { canal, modo: 'sempre', personas: [p.id] }];
		});
	}
	return novos;
}

function rotuloDia(def: Definicao, id: string, d: number): string {
	if (id === 'preventivo') return d === 0 ? 'D0' : `D-${d}`;
	if (id === 'giro') return `Dia ${d} do ciclo`;
	if (isFaseId(id)) return `D+${d}`;
	const e = (def.etapas ?? []).find(x => x.id === id);
	return e ? diaLabelEtapa(e, d) : `Dia ${d}`;
}

export function PersonasDaCarteira({ personas, contagens, semPersona, def, modelosMap, canEdit, montarOpen, setMontarOpen, estagio, onAplicar, onIrParaRegua }: {
	personas: PersonaUsuario[];
	contagens: Record<string, number>;
	semPersona: number;
	def: Definicao;
	modelosMap: Record<string, string[]>;
	canEdit: boolean;
	montarOpen: boolean;
	setMontarOpen: (v: boolean) => void;
	/** Estágio escolhido no passo Régua (o modal abre nele). */
	estagio: string;
	/** Aplica a definição no editor (fica em "Alterações não salvas" até Salvar). */
	onAplicar: (def: Definicao) => void;
	/** Leva à régua do estágio (para criar os dias antes das raias). */
	onIrParaRegua: (id: string) => void;
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

			{montarOpen && <MontarPorPersonas personas={personas} def={def} modelosMap={modelosMap} estagioInicial={estagio} onClose={() => setMontarOpen(false)} onAplicar={onAplicar} onIrParaRegua={onIrParaRegua} />}
		</section>
	);
}

function MontarPorPersonas({ personas, def, modelosMap, estagioInicial, onClose, onAplicar, onIrParaRegua }: {
	personas: PersonaUsuario[]; def: Definicao; modelosMap: Record<string, string[]>; estagioInicial: string;
	onClose: () => void; onAplicar: (def: Definicao) => void; onIrParaRegua: (id: string) => void;
}) {
	// Rascunho local: "Usar a régua padrão" muda só aqui até "Criar as raias".
	const [rascunho, setRascunho] = useState<Definicao>(def);
	const estagios = useMemo(() => estagiosParaPersonas(rascunho), [rascunho]);
	const [estagioId, setEstagioId] = useState<string>(() => (estagiosParaPersonas(def).some(e => e.id === estagioInicial) ? estagioInicial : estagiosParaPersonas(def)[0]?.id ?? ''));
	// Seleção POR estágio: marcar/desmarcar num estágio não mexe no outro. Ao abrir um estágio, vêm marcadas as
	// personas que já têm raia nele e todos os dias com ação.
	const [marcadas, setMarcadas] = useState<Record<string, Set<string>>>({});
	const [diasSel, setDiasSel] = useState<Record<string, Set<number>>>({});
	const [error, setError] = useState('');

	const estagio = estagios.find(e => e.id === estagioId) ?? null;
	const passos = estagio ? passosDoEstagio(rascunho, estagio.id) : undefined;
	const dias = useMemo(() => diasComAcao(passos), [passos]);
	const marked = marcadas[estagioId] ?? personasComRaia(passos);
	const selectedDays = diasSel[estagioId] ?? new Set(dias);

	function toggleMark(pid: string) {
		const n = new Set(marked); if (n.has(pid)) n.delete(pid); else n.add(pid);
		setMarcadas(prev => ({ ...prev, [estagioId]: n }));
	}
	function toggleDay(d: number) {
		const n = new Set(selectedDays); if (n.has(d)) n.delete(d); else n.add(d);
		setDiasSel(prev => ({ ...prev, [estagioId]: n }));
	}

	const markedPersonas = personas.filter(p => marked.has(p.id));
	const dayList = dias.filter(d => selectedDays.has(d));

	const preview = useMemo(() => {
		if (markedPersonas.length === 0) return 'Marque ao menos uma persona para ver a prévia.';
		if (dayList.length === 0) return 'Selecione ao menos um dia.';
		return markedPersonas.map(p => {
			const sug = canaisSugeridosDe(p, modelosMap);
			if (sug.length === 0) return `${p.nome}: sem canais sugeridos`;
			const parts = dayList.map((d, idx) => `${rotuloDia(rascunho, estagioId, d)} ${canalLabelPorId[sug[Math.min(idx, sug.length - 1)]] ?? sug[Math.min(idx, sug.length - 1)]}`);
			return `${p.nome}: ${parts.join(', ')}`;
		}).join('  ·  ');
	}, [markedPersonas, dayList, modelosMap, rascunho, estagioId]);

	function confirmar() {
		if (!estagio || !passos) return;
		if (markedPersonas.length === 0) { setError('Marque ao menos uma persona.'); return; }
		if (dayList.length === 0) { setError('Selecione ao menos um dia.'); return; }
		const semSug = markedPersonas.find(p => canaisSugeridosDe(p, modelosMap).length === 0);
		if (semSug) { setError(`${semSug.nome} não tem canais sugeridos.`); return; }
		const novoDef = normalizarDefinicao(comPassos(rascunho, estagio.id, montarRaias(passos, markedPersonas, dayList, modelosMap)), personas.map(p => p.id));
		onAplicar(novoDef);
		toast.success(`Raias criadas em “${estagio.nome}”. Revise e clique em Salvar para valer.`);
		onClose();
	}

	const btnEstagio = (on: boolean) => `rounded-lg px-4 py-2 text-sm font-semibold ${on ? 'bg-[#0F4C5C] text-white' : 'border border-[#c9dadd] text-[#0F4C5C] hover:bg-[#edf4f5]'}`;

	return (
		<div className="fixed inset-0 z-50 grid place-items-center bg-[#102e38]/60 p-4" onClick={onClose}>
			<div role="dialog" aria-modal="true" aria-label="Montar esteira pelas personas" className="max-h-[92vh] w-full max-w-2xl overflow-auto rounded-xl bg-white p-6 shadow-xl sm:p-8" onClick={e => e.stopPropagation()}>
				<div className="mb-5 flex items-center justify-between"><h2 className="text-lg font-semibold">Montar esteira pelas personas</h2><button onClick={onClose} aria-label="Fechar"><X size={20}/></button></div>
				<p className="mb-5 text-sm text-slate-500">Em cada estágio, marque quais personas devem ter raia própria. Para cada persona marcada, criamos a raia dela nos dias escolhidos, usando o canal sugerido do dia (1º dia = 1º canal sugerido, 2º dia = 2º…; quando acaba, repete o último). O público geral e as personas não marcadas não mudam.</p>

				<div className="mb-5">
					<label className="mb-2 block text-xs font-semibold">Estágio</label>
					{estagios.length === 0
						? <p className="text-xs italic text-slate-400">Nenhum estágio ligado com régua por dia. Ligue um estágio no passo Estágios.</p>
						: <div className="flex flex-wrap gap-2" role="tablist">
							{estagios.map(e => <button key={e.id} type="button" role="tab" aria-selected={e.id === estagioId} onClick={() => { setEstagioId(e.id); setError(''); }} className={btnEstagio(e.id === estagioId)}>{e.nome}</button>)}
						</div>}
				</div>

				{estagio && dias.length === 0 ? (
					// Sem dias com ação não há onde pôr a raia: não lista as personas; oferece o caminho para criar os dias.
					<div className="mb-5 rounded-lg border border-dashed border-[#cbd9dd] bg-[#fafcfc] p-4">
						<p className="text-sm font-semibold text-[#163943]">“{estagio.nome}” ainda não tem dias com ação.</p>
						{estagio.regua === 'padrao' ? (
							<>
								<p className="mt-1 text-xs text-slate-500">Hoje ele segue a régua padrão do motor, igual para todos. Para separar por persona, traga a régua padrão para este estágio e depois escolha as personas.</p>
								<button type="button" onClick={() => setRascunho(copiarReguaPadrao(rascunho, estagio.id as Parameters<typeof copiarReguaPadrao>[1]))} className="mt-3 h-9 rounded-lg bg-[#0F4C5C] px-4 text-xs font-semibold text-white">Usar a régua padrão do motor neste estágio</button>
							</>
						) : (
							<>
								<p className="mt-1 text-xs text-slate-500">Monte os dias da régua deste estágio primeiro; depois as personas aparecem aqui.</p>
								<button type="button" onClick={() => { onClose(); onIrParaRegua(estagio.id); }} className="mt-3 h-9 rounded-lg bg-[#0F4C5C] px-4 text-xs font-semibold text-white">Montar a régua de “{estagio.nome}”</button>
							</>
						)}
					</div>
				) : estagio && (
					<>
						<div className="mb-5 space-y-2">
							<label className="block text-xs font-semibold">Personas em “{estagio.nome}”</label>
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
							<label className="mb-2 block text-xs font-semibold">Dias</label>
							<div className="flex flex-wrap gap-2">
								{dias.map(d => (
									<label key={d} className={`flex cursor-pointer items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold ${selectedDays.has(d) ? 'border-[#0F4C5C] bg-[#eaf2f3] text-[#0F4C5C]' : 'border-[#c9dadd] text-slate-400'}`}>
										<input type="checkbox" checked={selectedDays.has(d)} onChange={() => toggleDay(d)} className="accent-[#0F4C5C]" /> {rotuloDia(rascunho, estagioId, d)}
									</label>
								))}
							</div>
						</div>

						<div className="mb-5 rounded-lg bg-[#f5f8f9] p-4">
							<p className="mb-1 text-[10px] font-bold uppercase tracking-wider text-slate-400">Prévia</p>
							<p className="text-xs leading-relaxed text-slate-600">{preview}</p>
						</div>
					</>
				)}

				{error && <p role="alert" className="mb-4 text-sm text-[#C62828]">{error}</p>}
				<div className="flex justify-end gap-3">
					<button onClick={onClose} className="h-11 rounded-lg border border-[#c9dadd] px-5 text-sm font-semibold text-[#304b55] hover:bg-[#edf4f5]">Cancelar</button>
					{estagio && dias.length > 0 && <button onClick={confirmar} disabled={markedPersonas.length === 0 || dayList.length === 0} className="h-11 rounded-lg bg-[#0F4C5C] px-6 text-sm font-semibold text-white disabled:opacity-50">Criar as raias</button>}
				</div>
			</div>
		</div>
	);
}
