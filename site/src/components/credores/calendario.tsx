import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { CalendarDays, Plus, X } from 'lucide-react';
import { Loading, Notice } from '@/components/app-shell';
import { friendlyError, supabase, type Credor, type Row } from '@/lib/supabase';

type CalendarioPadrao = { dias_semana: number[]; feriados_nacionais: boolean; sem_acao: string[]; com_acao: string[] };
type CalendarioEstrategia = { seguir_padrao: boolean; dias_semana: number[]; feriados_nacionais: boolean; sem_acao: string[]; com_acao: string[] };
type Calendario = { padrao: CalendarioPadrao; estrategias: Record<string, CalendarioEstrategia> };

const DIAS = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'];
const PADRAO_DEFAULT: CalendarioPadrao = { dias_semana: [0, 1, 2, 3, 4, 5], feriados_nacionais: true, sem_acao: [], com_acao: [] };
const ESTR_DEFAULT: CalendarioEstrategia = { seguir_padrao: true, dias_semana: [0, 1, 2, 3, 4], feriados_nacionais: true, sem_acao: [], com_acao: [] };

// Feriados nacionais fixos (MM-DD) — os móveis são tratados pelo MotorCob.
const FERIADOS_NACIONAIS = new Set(['01-01', '04-21', '05-01', '09-07', '10-12', '11-02', '11-15', '12-25']);

function isFeriadoNacional(iso: string): boolean {
	return FERIADOS_NACIONAIS.has(iso.slice(5));
}

/** 0 = segunda … 6 = domingo, a partir de uma data ISO yyyy-mm-dd. */
function diaSemana(iso: string): number {
	const js = new Date(`${iso}T12:00:00-03:00`).getDay();
	return js === 0 ? 6 : js - 1;
}

function hojeISO(): string {
	return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

function somaDias(iso: string, n: number): string {
	const d = new Date(`${iso}T12:00:00-03:00`);
	d.setDate(d.getDate() + n);
	return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

function exportaDia(p: CalendarioPadrao, iso: string): boolean {
	if (p.com_acao.includes(iso)) return true;
	if (p.sem_acao.includes(iso)) return false;
	if (!p.dias_semana.includes(diaSemana(iso))) return false;
	if (p.feriados_nacionais && isFeriadoNacional(iso)) return false;
	return true;
}

function normalizar(raw: unknown): Calendario {
	const r = (raw ?? {}) as Partial<Calendario>;
	const padrao: CalendarioPadrao = { ...PADRAO_DEFAULT, ...(r.padrao ?? {}), dias_semana: r.padrao?.dias_semana ?? PADRAO_DEFAULT.dias_semana, sem_acao: r.padrao?.sem_acao ?? [], com_acao: r.padrao?.com_acao ?? [] };
	const estrategias: Record<string, CalendarioEstrategia> = {};
	for (const [k, v] of Object.entries(r.estrategias ?? {})) {
		estrategias[k] = { ...ESTR_DEFAULT, ...v, dias_semana: v.dias_semana ?? ESTR_DEFAULT.dias_semana, sem_acao: v.sem_acao ?? [], com_acao: v.com_acao ?? [] };
	}
	return { padrao, estrategias };
}

type EstrategiaInfo = { id: string; nome: string };

export function AbCalendario({ credor, canEdit, onSaved }: {
	credor: Credor; canEdit: boolean; onSaved: () => void;
}) {
	const [cal, setCal] = useState<Calendario>(() => normalizar((credor as Row).calendario));
	const [estrategias, setEstrategias] = useState<EstrategiaInfo[]>([]);
	const [loading, setLoading] = useState(true);
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState('');

	useEffect(() => {
		let active = true;
		async function load() {
			if (!supabase) return;
			const ids = new Set<string>();
			if (credor.estrategia_id) ids.add(credor.estrategia_id);
			const { data: segs } = await supabase.from('segmentos_em_uso').select('estrategia_id').eq('credor_id', credor.id).eq('em_uso', true);
			(segs ?? []).forEach((r: Row) => { if (r.estrategia_id) ids.add(r.estrategia_id as string); });
			if (ids.size === 0) { if (active) { setEstrategias([]); setLoading(false); } return; }
			const { data: ests } = await supabase.from('estrategias').select('id,nome').in('id', [...ids]).order('nome');
			if (active) { setEstrategias((ests ?? []) as EstrategiaInfo[]); setLoading(false); }
		}
		void load();
		return () => { active = false; };
	}, [credor.id]);

	function setPadrao(patch: Partial<CalendarioPadrao>) { setCal(prev => ({ ...prev, padrao: { ...prev.padrao, ...patch } })); }
	function setEstr(id: string, patch: Partial<CalendarioEstrategia>) {
		setCal(prev => {
			const cur = prev.estrategias[id] ?? ESTR_DEFAULT;
			return { ...prev, estrategias: { ...prev.estrategias, [id]: { ...cur, ...patch } } };
		});
	}
	function toggleDia(p: CalendarioPadrao, d: number): CalendarioPadrao {
		return { ...p, dias_semana: p.dias_semana.includes(d) ? p.dias_semana.filter(x => x !== d) : [...p.dias_semana, d].sort() };
	}

	async function salvar() {
		if (!supabase) return;
		setSaving(true); setError('');
		const { error } = await supabase.from('credores').update({ calendario: cal, atualizado_em: new Date().toISOString() }).eq('id', credor.id);
		if (error) { setError(friendlyError()); setSaving(false); return; }
		toast.success('Calendário salvo · vale a partir da próxima rotina (em até 1 minuto)');
		setSaving(false);
		onSaved();
	}

	const proximos14 = useMemo(() => {
		const hoje = hojeISO();
		return Array.from({ length: 14 }, (_, i) => somaDias(hoje, i));
	}, []);

	if (loading) return <Loading />;

	return (
		<div className="space-y-5">
			<div className="rounded-xl border border-[#d9e5e8] bg-[#eaf2f3] p-5 text-sm text-[#315d68]">
				<p>Nos dias sem exportação, a Lista do dia não traz os clientes daquela estratégia e a esteira dela pausa (o D+ não anda). Os feriados nacionais já estão cadastrados no MotorCX.</p>
			</div>
			{error && <Notice>{error}</Notice>}

			{/* Padrão do credor */}
			<section className="rounded-xl border border-[#dfe8ea] bg-white p-6">
				<h3 className="mb-4 text-base font-semibold text-[#163943]">Padrão do credor</h3>
				<div className="mb-5">
					<p className="mb-2 text-xs font-semibold text-slate-600">Dias da semana</p>
					<div className="flex flex-wrap gap-2">
						{DIAS.map((d, i) => {
							const on = cal.padrao.dias_semana.includes(i);
							return (
								<button key={d} type="button" disabled={!canEdit} onClick={() => setPadrao(toggleDia(cal.padrao, i))}
									className={`h-10 w-12 rounded-lg border text-sm font-semibold transition disabled:opacity-50 ${on ? 'border-[#0F4C5C] bg-[#0F4C5C] text-white' : 'border-[#c9dadd] bg-white text-slate-400 hover:bg-[#edf4f5]'}`}>{d}</button>
							);
						})}
					</div>
				</div>
				<label className="mb-5 flex cursor-pointer items-center gap-2 text-sm">
					<input type="checkbox" checked={cal.padrao.feriados_nacionais} disabled={!canEdit} onChange={e => setPadrao({ feriados_nacionais: e.target.checked })} className="accent-[#0F4C5C]" />
					Não exportar em feriado nacional
				</label>
				<ListaDatas label="Datas sem exportação" valores={cal.padrao.sem_acao} canEdit={canEdit} onChange={v => setPadrao({ sem_acao: v })} />
				<ListaDatas label="Datas com exportação mesmo assim" valores={cal.padrao.com_acao} canEdit={canEdit} onChange={v => setPadrao({ com_acao: v })} />
			</section>

			{/* Por estratégia */}
			{estrategias.length > 0 && (
				<section className="rounded-xl border border-[#dfe8ea] bg-white p-6">
					<h3 className="mb-1 text-base font-semibold text-[#163943]">Por estratégia</h3>
					<p className="mb-4 text-xs text-slate-500">Estratégias usadas por este credor. Cada uma pode seguir o padrão do credor ou ter os seus próprios dias.</p>
					<div className="space-y-4">
						{estrategias.map(est => {
							const e = cal.estrategias[est.id] ?? ESTR_DEFAULT;
							const seguir = e.seguir_padrao !== false;
							return (
								<div key={est.id} className="rounded-lg border border-[#e2eaec] p-4">
									<div className="mb-3 flex items-center justify-between gap-3">
										<span className="text-sm font-semibold text-[#163943]">{est.nome}</span>
										<label className="flex cursor-pointer items-center gap-2 text-xs">
											<input type="checkbox" checked={seguir} disabled={!canEdit} onChange={ev => setEstr(est.id, { seguir_padrao: ev.target.checked })} className="accent-[#0F4C5C]" />
											Seguir o padrão do credor
										</label>
									</div>
									{!seguir && (
										<div className="space-y-4 border-t border-[#ecf0f1] pt-4">
											<div>
												<p className="mb-2 text-xs font-semibold text-slate-600">Dias da semana</p>
												<div className="flex flex-wrap gap-2">
													{DIAS.map((d, i) => {
														const on = e.dias_semana.includes(i);
														return (
															<button key={d} type="button" disabled={!canEdit} onClick={() => setEstr(est.id, { dias_semana: toggleDia(e, i).dias_semana })}
																className={`h-9 w-11 rounded-lg border text-xs font-semibold transition disabled:opacity-50 ${on ? 'border-[#0F4C5C] bg-[#0F4C5C] text-white' : 'border-[#c9dadd] bg-white text-slate-400 hover:bg-[#edf4f5]'}`}>{d}</button>
														);
													})}
												</div>
											</div>
											<label className="flex cursor-pointer items-center gap-2 text-xs">
												<input type="checkbox" checked={e.feriados_nacionais} disabled={!canEdit} onChange={ev => setEstr(est.id, { feriados_nacionais: ev.target.checked })} className="accent-[#0F4C5C]" />
												Não exportar em feriado nacional
											</label>
											<ListaDatas label="Datas sem exportação" valores={e.sem_acao} canEdit={canEdit} onChange={v => setEstr(est.id, { sem_acao: v })} compacta />
											<ListaDatas label="Datas com exportação mesmo assim" valores={e.com_acao} canEdit={canEdit} onChange={v => setEstr(est.id, { com_acao: v })} compacta />
										</div>
									)}
								</div>
							);
						})}
					</div>
				</section>
			)}

			{/* Prévia */}
			<section className="rounded-xl border border-[#dfe8ea] bg-white p-6">
				<div className="mb-4 flex items-center gap-2">
					<CalendarDays size={18} className="text-[#0F4C5C]" />
					<h3 className="text-base font-semibold text-[#163943]">Próximos 14 dias</h3>
				</div>
				<div className="overflow-x-auto">
					<table className="w-full min-w-[640px] text-left text-xs">
						<thead>
							<tr className="border-b border-[#e5edef] text-slate-400">
								<th className="pb-2 pr-3 font-medium">Estratégia</th>
								{proximos14.map(iso => {
									const ds = diaSemana(iso);
									const fer = isFeriadoNacional(iso);
									return <th key={iso} className="pb-2 px-1 text-center font-medium" title={iso}>{DIAS[ds]}{fer ? ' •' : ''}<br /><span className="text-[10px] text-slate-300">{iso.slice(8)}/{iso.slice(5, 7)}</span></th>;
								})}
							</tr>
						</thead>
						<tbody className="divide-y divide-[#ecf0f1]">
							<tr>
								<td className="py-2 pr-3 font-semibold text-[#0F4C5C]">Padrão do credor</td>
								{proximos14.map(iso => <td key={iso} className="py-2 px-1 text-center"><span className={`inline-block h-5 w-5 rounded ${exportaDia(cal.padrao, iso) ? 'bg-[#2E7D32]' : 'bg-slate-200'}`} title={iso} /></td>)}
							</tr>
							{estrategias.map(est => {
								const e = cal.estrategias[est.id] ?? ESTR_DEFAULT;
								const efetivo = e.seguir_padrao !== false ? cal.padrao : e;
								return (
									<tr key={est.id}>
										<td className="py-2 pr-3 font-medium text-slate-600">{est.nome}</td>
										{proximos14.map(iso => <td key={iso} className="py-2 px-1 text-center"><span className={`inline-block h-5 w-5 rounded ${exportaDia(efetivo, iso) ? 'bg-[#2E7D32]' : 'bg-slate-200'}`} title={iso} /></td>)}
									</tr>
								);
							})}
						</tbody>
					</table>
				</div>
				<p className="mt-3 text-xs text-slate-400">Verde = exporta · cinza = não exporta · • = feriado nacional. Estimativa no site; o MotorCX aplica as regras na rotina.</p>
			</section>

			{canEdit && (
				<div className="flex justify-end">
					<button onClick={salvar} disabled={saving} className="h-11 rounded-lg bg-[#0F4C5C] px-6 text-sm font-semibold text-white disabled:opacity-50">{saving ? 'Salvando...' : 'Salvar calendário'}</button>
				</div>
			)}
		</div>
	);
}

function ListaDatas({ label, valores, canEdit, onChange, compacta }: {
	label: string; valores: string[]; canEdit: boolean; onChange: (v: string[]) => void; compacta?: boolean;
}) {
	const [novo, setNovo] = useState('');
	function add() {
		if (!novo) return;
		if (!valores.includes(novo)) onChange([...valores, novo].sort());
		setNovo('');
	}
	function del(v: string) { onChange(valores.filter(x => x !== v)); }
	return (
		<div className={compacta ? '' : 'mb-4'}>
			<p className="mb-2 text-xs font-semibold text-slate-600">{label}</p>
			<div className="flex flex-wrap items-center gap-2">
				{valores.map(v => (
					<span key={v} className="inline-flex items-center gap-1 rounded-lg border border-[#d8e3e5] bg-[#f5f8f9] px-2.5 py-1 text-xs text-slate-600">
						{v.split('-').reverse().join('/')}
						{canEdit && <button type="button" onClick={() => del(v)} className="text-slate-400 hover:text-[#C62828]" aria-label="Remover"><X size={12} /></button>}
					</span>
				))}
				{canEdit && (
					<span className="inline-flex items-center gap-1">
						<input type="date" value={novo} onChange={e => setNovo(e.target.value)} className="h-9 rounded border border-[#d8e3e5] px-2 text-xs outline-none focus:border-[#0F4C5C]" />
						<button type="button" onClick={add} disabled={!novo} className="flex h-9 items-center gap-1 rounded-lg border border-[#0F4C5C] px-2.5 text-xs font-semibold text-[#0F4C5C] hover:bg-[#eaf2f3] disabled:opacity-50"><Plus size={13} /></button>
					</span>
				)}
			</div>
		</div>
	);
}
