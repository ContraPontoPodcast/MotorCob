import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { ArrowDown, ArrowUp, MessageCircle, Plus, Trash2 } from 'lucide-react';
import {
	canalOpts, modoOpts, modoDesc, statusCert, origemOpts, fases,
	playbookDefinicao, diaFrase, passosFrase, isVazia, definicaoVazia,
	type Acao, type Contatos, type Definicao, type Passos,
} from '@/lib/estrategia';
import { ModelosModal } from '@/components/estrategias/modelos-modal';

const numerosOpts = [
	{ id: '', label: 'Padrão do canal' },
	{ id: '1', label: '1' }, { id: '2', label: '2' }, { id: '3', label: '3' }, { id: '99', label: 'Todos' },
];

export function AcaoCard({ acao, index, total, comModo, onChange, onMove, onRemove, hideSempre, onEditFrase }: {
	acao: Acao; index: number; total: number; comModo: boolean;
	onChange: (a: Acao) => void; onMove: (dir: -1 | 1) => void; onRemove: () => void;
	hideSempre?: boolean; onEditFrase?: () => void;
}) {
	const c = acao.contatos ?? {};
	const primeiro = index === 0;
	function setCont(patch: Partial<Contatos>) { onChange({ ...acao, contatos: { ...c, ...patch } }); }
	function toggleList(key: 'status' | 'origem', val: string) {
		const arr = c[key] ?? [];
		setCont({ [key]: arr.includes(val) ? arr.filter(x => x !== val) : [...arr, val] } as Partial<Contatos>);
	}
	return (
		<div className="rounded-lg border border-[#e2eaec] bg-[#fafcfc] p-3">
			<div className="flex flex-wrap items-center gap-2">
				<select value={acao.canal} onChange={e => onChange({ ...acao, canal: e.target.value })} className="h-9 w-[150px] rounded border border-[#d8e3e5] bg-white px-2 text-xs outline-none focus:border-[#0F4C5C]">
					{canalOpts.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
				</select>
				{comModo && (
					<select value={acao.modo ?? 'sempre'} disabled={primeiro} onChange={e => onChange({ ...acao, modo: e.target.value })} className="h-9 w-[110px] rounded border border-[#d8e3e5] bg-white px-2 text-xs outline-none focus:border-[#0F4C5C] disabled:opacity-60">
						{(hideSempre ? modoOpts.filter(o => o.id !== 'sempre') : modoOpts).map(o => <option key={o.id} value={o.id} disabled={primeiro && o.id !== 'sempre'}>{o.label}</option>)}
						{hideSempre && acao.modo === 'sempre' && <option value="sempre" disabled>Sempre</option>}
					</select>
				)}
				<select value={acao.numeros === undefined ? '' : String(acao.numeros)} onChange={e => onChange({ ...acao, numeros: e.target.value === '' ? undefined : Number(e.target.value) })} className="h-9 w-[140px] rounded border border-[#d8e3e5] bg-white px-2 text-xs outline-none focus:border-[#0F4C5C]">
					{numerosOpts.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
				</select>
				{onEditFrase && <button type="button" onClick={onEditFrase} className="flex h-9 items-center gap-1 rounded-lg border border-[#c9dadd] px-2.5 text-xs font-semibold text-[#0F4C5C] hover:bg-[#edf4f5]"><MessageCircle size={13} /> Frase</button>}
				<div className="ml-auto flex items-center gap-1">
					<button type="button" onClick={() => onMove(-1)} disabled={index === 0} aria-label="Subir" className="grid h-8 w-8 place-items-center rounded border border-[#c9dadd] text-[#0F4C5C] hover:bg-[#edf4f5] disabled:opacity-40"><ArrowUp size={14}/></button>
					<button type="button" onClick={() => onMove(1)} disabled={index === total - 1} aria-label="Descer" className="grid h-8 w-8 place-items-center rounded border border-[#c9dadd] text-[#0F4C5C] hover:bg-[#edf4f5] disabled:opacity-40"><ArrowDown size={14}/></button>
					<button type="button" onClick={onRemove} disabled={primeiro && comModo} aria-label="Remover" className="grid h-8 w-8 place-items-center rounded border border-[#c9dadd] text-slate-400 hover:bg-red-50 hover:text-[#C62828] disabled:opacity-40"><Trash2 size={14}/></button>
				</div>
			</div>
			{comModo && acao.modo && <p className="mt-2 text-[11px] text-slate-500">{modoDesc[acao.modo]}</p>}
			<div className="mt-3 border-t border-[#ecf0f1] pt-3">
				<p className="mb-2 text-[10px] font-bold uppercase tracking-wider text-slate-400">Quais contatos</p>
				<div className="flex flex-wrap gap-x-5 gap-y-2 text-xs">
					<label className="flex cursor-pointer items-center gap-1.5"><input type="checkbox" checked={!!c.whatsapp} onChange={e => setCont({ whatsapp: e.target.checked })} className="accent-[#0F4C5C]"/> Só com WhatsApp</label>
					<label className="flex cursor-pointer items-center gap-1.5"><input type="checkbox" checked={!!c.rcs} onChange={e => setCont({ rcs: e.target.checked })} className="accent-[#0F4C5C]"/> Só com RCS</label>
					<label className="flex cursor-pointer items-center gap-1.5"><input type="checkbox" checked={!!c.pertence} onChange={e => setCont({ pertence: e.target.checked })} className="accent-[#0F4C5C]"/> Só contato que pertence ao cliente</label>
					<label className="flex cursor-pointer items-center gap-1.5"><input type="checkbox" checked={!!c.sem_nao_perturbe} onChange={e => setCont({ sem_nao_perturbe: e.target.checked })} className="accent-[#0F4C5C]"/> Fora do Não Perturbe</label>
					<label className="flex items-center gap-1.5">Score bureau mín. <input type="number" min={1} max={5} value={c.score_bureau_min ?? ''} onChange={e => setCont({ score_bureau_min: e.target.value ? Number(e.target.value) : undefined })} className="h-8 w-14 rounded border border-[#d8e3e5] px-2 text-xs outline-none focus:border-[#0F4C5C]"/></label>
				</div>
				<div className="mt-3 grid gap-3 sm:grid-cols-2">
					<div>
						<p className="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-400">Certificação aceita</p>
						<div className="flex flex-wrap gap-x-4 gap-y-1.5 text-xs">
							{statusCert.map(s => <label key={s.id} className="flex cursor-pointer items-center gap-1.5"><input type="checkbox" checked={(c.status ?? []).includes(s.id)} onChange={() => toggleList('status', s.id)} className="accent-[#0F4C5C]"/> {s.label}</label>)}
						</div>
					</div>
					<div>
						<p className="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-400">Origem</p>
						<div className="flex flex-wrap gap-x-4 gap-y-1.5 text-xs">
							{origemOpts.map(s => <label key={s.id} className="flex cursor-pointer items-center gap-1.5"><input type="checkbox" checked={(c.origem ?? []).includes(s.id)} onChange={() => toggleList('origem', s.id)} className="accent-[#0F4C5C]"/> {s.label}</label>)}
						</div>
					</div>
				</div>
			</div>
		</div>
	);
}

function ListaAcoes({ acoes, comModo, onChange }: { acoes: Acao[]; comModo: boolean; onChange: (a: Acao[]) => void }) {
	function upd(i: number, a: Acao) { onChange(acoes.map((x, idx) => idx === i ? a : x)); }
	function move(i: number, dir: -1 | 1) { const j = i + dir; if (j < 0 || j >= acoes.length) return; const next = [...acoes]; [next[i], next[j]] = [next[j], next[i]]; onChange(next); }
	function del(i: number) { onChange(acoes.filter((_, idx) => idx !== i)); }
	function add() { const base: Acao = comModo ? { canal: 'whatsapp', modo: 'senao' } : { canal: 'whatsapp' }; onChange([...acoes, base]); }
	return (
		<div className="space-y-2">
			{acoes.map((a, i) => <AcaoCard key={i} acao={a} index={i} total={acoes.length} comModo={comModo} onChange={x => upd(i, x)} onMove={d => move(i, d)} onRemove={() => del(i)} />)}
			<button type="button" onClick={add} className="flex items-center gap-1.5 rounded-lg border border-dashed border-[#0F4C5C] px-3 py-2 text-xs font-semibold text-[#0F4C5C] hover:bg-[#eaf2f3]"><Plus size={14}/> ação</button>
		</div>
	);
}

function AddDiaControl({ prefixo, onAdd }: { prefixo: string; onAdd: (dia: number) => void }) {
	const [novoDia, setNovoDia] = useState('');
	function add() {
		const n = Number(novoDia);
		if (novoDia === '' || Number.isNaN(n)) return;
		onAdd(n);
		setNovoDia('');
	}
	return (
		<div className="flex items-center gap-2">
			<span className="text-xs font-semibold text-slate-400">{prefixo}</span>
			<input type="number" value={novoDia} onChange={e => setNovoDia(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') add(); }} placeholder="nº do dia" className="h-9 w-24 rounded border border-[#d8e3e5] px-2 text-xs outline-none focus:border-[#0F4C5C]"/>
			<button type="button" onClick={add} className="flex items-center gap-1.5 rounded-lg border border-[#0F4C5C] px-3 py-2 text-xs font-semibold text-[#0F4C5C] hover:bg-[#eaf2f3]"><Plus size={14}/> Adicionar dia</button>
		</div>
	);
}

function DiaHeader({ dia, prefixo, onRename }: { dia: string; prefixo: string; onRename: (novo: number) => void }) {
	const [val, setVal] = useState(dia);
	useEffect(() => { setVal(dia); }, [dia]);
	function commit() {
		const n = Number(val);
		if (val === '' || Number.isNaN(n)) { setVal(dia); return; }
		if (String(n) !== dia) onRename(n);
		else setVal(dia);
	}
	return (
		<div className="flex items-center gap-1.5">
			<span className="text-xs font-bold text-[#0F4C5C]">{prefixo}</span>
			<input type="number" value={val} onChange={e => setVal(e.target.value)} onBlur={commit} onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} className="h-8 w-16 rounded border border-[#d8e3e5] bg-white px-2 text-xs font-bold text-[#0F4C5C] outline-none focus:border-[#0F4C5C]"/>
		</div>
	);
}

function PassosEditor({ passos, prefixo, onChange, onVoltarPlaybook }: { passos: Passos; prefixo: string; onChange: (p: Passos) => void; onVoltarPlaybook: () => void }) {
	const passosRef = useRef(passos);
	passosRef.current = passos;
	const dias = Object.keys(passos).map(Number).sort((a, b) => a - b);

	function addDia(n: number) {
		const key = String(n);
		if (passos[key] !== undefined) { toast(`O dia ${prefixo}${n} já existe.`); return; }
		onChange({ ...passos, [key]: [{ canal: 'whatsapp', modo: 'sempre' }] });
	}

	function renomearDia(diaAntigo: string, diaNovo: number) {
		const keyNovo = String(diaNovo);
		if (keyNovo === diaAntigo) return;
		const next = { ...passos };
		const acoes = next[diaAntigo] ?? [];
		if (next[keyNovo]) {
			next[keyNovo] = [...next[keyNovo], ...acoes];
			delete next[diaAntigo];
			onChange(next);
			toast(`Ações juntadas no ${prefixo}${diaNovo}.`);
		} else {
			next[keyNovo] = acoes;
			delete next[diaAntigo];
			onChange(next);
		}
	}

	function delDia(d: string) {
		const next = { ...passos };
		const removido = next[d];
		delete next[d];
		onChange(next);
		toast(`Dia ${prefixo}${d} removido`, {
			duration: 10000,
			action: { label: 'Desfazer', onClick: () => onChange({ ...passosRef.current, [d]: removido }) },
		});
	}

	if (dias.length === 0) {
		return (
			<div className="space-y-4">
				<div className="rounded-lg border border-dashed border-[#cbd9dd] bg-[#fafcfc] p-8 text-center">
					<p className="text-sm text-slate-500">Nenhuma ação nesta fase. Clique em + Adicionar dia.</p>
					<div className="mt-4 flex justify-center"><AddDiaControl prefixo={prefixo} onAdd={addDia} /></div>
					<button type="button" onClick={onVoltarPlaybook} className="mt-4 text-xs text-[#0F4C5C] underline hover:text-[#0d4252]">Voltar ao padrão MotorCX</button>
				</div>
			</div>
		);
	}

	return (
		<div className="space-y-4">
			{dias.map(d => {
				const key = String(d);
				return (
					<div key={key} className="rounded-lg border border-[#e2eaec] bg-white p-4">
						<div className="mb-3 flex items-center justify-between">
							<DiaHeader dia={key} prefixo={prefixo} onRename={(novo) => renomearDia(key, novo)} />
							<button type="button" onClick={() => delDia(key)} className="text-xs text-slate-400 hover:text-[#C62828]">remover dia</button>
						</div>
						<ListaAcoes acoes={passos[key]} comModo onChange={a => onChange({ ...passos, [key]: a })} />
						<p className="mt-3 rounded bg-[#f2f6f7] px-3 py-2 text-xs text-[#365661]">{diaFrase(passos[key])}</p>
					</div>
				);
			})}
			<AddDiaControl prefixo={prefixo} onAdd={addDia} />
		</div>
	);
}

function faseVazia(d: Definicao, fid: string): boolean {
	if (fid === 'localizacao') return !d.localizacao;
	if (fid === 'cpc') return !d.cpc;
	if (fid === 'giro') return !d.giro;
	if (fid === 'preventivo') return !d.preventivo;
	return !d.quebra;
}

function personalizar(d: Definicao, fid: string): Definicao {
	if (fid === 'localizacao') return { ...d, localizacao: { passos: {}, dias_sem_contato_para_ncp: 8 } };
	if (fid === 'cpc') return { ...d, cpc: { ordem: [{ canal: 'whatsapp' }], junto: [], tentativas_por_canal: 3 } };
	if (fid === 'giro') return { ...d, giro: { passos: {}, ciclo_dias: 8, max_ciclos: 3 } };
	if (fid === 'preventivo') return { ...d, preventivo: { passos: {} } };
	return { ...d, quebra: { passos: {}, dias_para_estoque: 6 } };
}

function limparFase(d: Definicao, fid: string): Definicao {
	const next = { ...d };
	if (fid === 'localizacao') delete next.localizacao;
	else if (fid === 'cpc') delete next.cpc;
	else if (fid === 'giro') delete next.giro;
	else if (fid === 'preventivo') delete next.preventivo;
	else if (fid === 'quebra') delete next.quebra;
	return next;
}

/** Núcleo reutilizável do editor de estratégia: abas + fases. */
export function EstrategiaEditorCore({ def, setDef }: { def: Definicao; setDef: (d: Definicao) => void }) {
	const [aba, setAba] = useState<string>('localizacao');
	const [modelosOpen, setModelosOpen] = useState(false);
	const vazia = isVazia(def);
	const fase = fases.find(f => f.id === aba)!;

	return (
		<div className="rounded-xl border border-[#dfe8ea] bg-white p-6 sm:p-8">
			<div className="flex flex-wrap items-center gap-3">
				{vazia && <button type="button" onClick={() => setModelosOpen(true)} className="flex h-10 items-center gap-2 rounded-lg border border-[#9a631b] bg-[#fff7e8] px-4 text-xs font-semibold text-[#9a631b] hover:bg-[#fff1d8]">Começar de um modelo</button>}
				{!vazia && <button type="button" onClick={() => { if (window.confirm('Quem não cair em outro estágio fica sem ação. Continuar?')) setDef(definicaoVazia()); }} className="text-xs text-slate-400 hover:text-[#C62828]">Desligar todos os estágios</button>}
			</div>

			<div className="mt-5 flex flex-wrap gap-1 border-b border-[#e5edef] pb-3">
				{fases.map(f => (
					<button key={f.id} type="button" onClick={() => setAba(f.id)} className={`rounded-lg px-4 py-2 text-sm font-medium transition-colors ${aba === f.id ? 'bg-[#0F4C5C] text-white' : 'text-slate-500 hover:bg-[#edf4f5]'}`}>{f.label}</button>
				))}
			</div>

			<div className="mt-6">
				{faseVazia(def, fase.id) ? (
					<div className="rounded-lg border border-dashed border-[#cbd9dd] bg-[#fafcfc] p-8 text-center">
						<p className="text-sm text-slate-500">Seguindo o padrão MotorCX</p>
						<button type="button" onClick={() => setDef(personalizar(def, fase.id))} className="mt-4 rounded-lg bg-[#0F4C5C] px-4 py-2 text-xs font-semibold text-white hover:bg-[#0d4252]">Personalizar esta fase</button>
					</div>
				) : (
					<div>
						<div className="mb-4 flex items-center justify-between">
							<h3 className="text-sm font-semibold text-[#163943]">{fase.label}</h3>
							<button type="button" onClick={() => setDef(limparFase(def, fase.id))} className="text-xs text-slate-400 hover:text-[#C62828]">Voltar ao playbook</button>
						</div>

						{fase.id === 'localizacao' && def.localizacao && (
							<div className="space-y-5">
								<PassosEditor passos={def.localizacao.passos} prefixo="D+" onVoltarPlaybook={() => setDef(limparFase(def, fase.id))} onChange={p => setDef({ ...def, localizacao: { ...def.localizacao!, passos: p } })} />
								<div className="rounded-lg border border-[#e2eaec] p-4">
									<label className="mb-1 block text-xs font-medium text-slate-600">Vira Não CPC depois de N dias sem contato</label>
									<input type="number" min={1} value={def.localizacao.dias_sem_contato_para_ncp ?? 8} onChange={e => setDef({ ...def, localizacao: { ...def.localizacao!, dias_sem_contato_para_ncp: Number(e.target.value) } })} className="h-10 w-28 rounded border border-[#d8e3e5] px-3 text-sm outline-none focus:border-[#0F4C5C]"/>
								</div>
								<p className="rounded bg-[#f2f6f7] px-3 py-2 text-xs text-[#365661]">{passosFrase(def.localizacao.passos, 'D+') || '—'}</p>
							</div>
						)}

						{fase.id === 'cpc' && def.cpc && (
							<div className="space-y-6">
								<div>
									<p className="mb-2 text-xs font-semibold">Ordem dos canais</p>
									<p className="mb-3 text-xs text-slate-500">O cliente vai para o próximo canal quando esgota as tentativas no atual.</p>
									<ListaAcoes acoes={def.cpc.ordem} comModo={false} onChange={a => setDef({ ...def, cpc: { ...def.cpc!, ordem: a } })} />
								</div>
								<div>
									<p className="mb-2 text-xs font-semibold">Sempre junto</p>
									<p className="mb-3 text-xs text-slate-500">Ações que acompanham o canal da vez (ex.: e-mail).</p>
									<ListaAcoes acoes={def.cpc.junto} comModo={false} onChange={a => setDef({ ...def, cpc: { ...def.cpc!, junto: a } })} />
								</div>
								<div className="rounded-lg border border-[#e2eaec] p-4">
									<label className="mb-1 block text-xs font-medium text-slate-600">Tentativas por canal antes de trocar</label>
									<input type="number" min={1} value={def.cpc.tentativas_por_canal ?? 3} onChange={e => setDef({ ...def, cpc: { ...def.cpc!, tentativas_por_canal: Number(e.target.value) } })} className="h-10 w-28 rounded border border-[#d8e3e5] px-3 text-sm outline-none focus:border-[#0F4C5C]"/>
								</div>
							</div>
						)}

						{fase.id === 'giro' && def.giro && (
							<div className="space-y-5">
								<PassosEditor passos={def.giro.passos} prefixo="D+" onVoltarPlaybook={() => setDef(limparFase(def, fase.id))} onChange={p => setDef({ ...def, giro: { ...def.giro!, passos: p } })} />
								<div className="grid gap-4 sm:grid-cols-2">
									<div className="rounded-lg border border-[#e2eaec] p-4"><label className="mb-1 block text-xs font-medium text-slate-600">Duração do ciclo em dias</label><input type="number" min={1} value={def.giro.ciclo_dias ?? 8} onChange={e => setDef({ ...def, giro: { ...def.giro!, ciclo_dias: Number(e.target.value) } })} className="h-10 w-28 rounded border border-[#d8e3e5] px-3 text-sm outline-none focus:border-[#0F4C5C]"/></div>
									<div className="rounded-lg border border-[#e2eaec] p-4"><label className="mb-1 block text-xs font-medium text-slate-600">Ciclos antes de pedir novo enriquecimento</label><input type="number" min={1} value={def.giro.max_ciclos ?? 3} onChange={e => setDef({ ...def, giro: { ...def.giro!, max_ciclos: Number(e.target.value) } })} className="h-10 w-28 rounded border border-[#d8e3e5] px-3 text-sm outline-none focus:border-[#0F4C5C]"/></div>
								</div>
								<p className="rounded bg-[#f2f6f7] px-3 py-2 text-xs text-[#365661]">{passosFrase(def.giro.passos, 'D+') || '—'}</p>
							</div>
						)}

						{fase.id === 'preventivo' && def.preventivo && (
							<div className="space-y-3">
								<p className="text-xs text-slate-500">Dias <strong>antes</strong> do vencimento (D-3, D-1, D0…).</p>
								<PassosEditor passos={def.preventivo.passos} prefixo="D" onVoltarPlaybook={() => setDef(limparFase(def, fase.id))} onChange={p => setDef({ ...def, preventivo: { ...def.preventivo!, passos: p } })} />
								<p className="rounded bg-[#f2f6f7] px-3 py-2 text-xs text-[#365661]">{passosFrase(def.preventivo.passos, 'D') || '—'}</p>
							</div>
						)}

						{fase.id === 'quebra' && def.quebra && (
							<div className="space-y-5">
								<p className="text-xs text-slate-500">Dias <strong>depois</strong> da quebra (D+1, D+3…).</p>
								<PassosEditor passos={def.quebra.passos} prefixo="D+" onVoltarPlaybook={() => setDef(limparFase(def, fase.id))} onChange={p => setDef({ ...def, quebra: { ...def.quebra!, passos: p } })} />
								<div className="rounded-lg border border-[#e2eaec] p-4"><label className="mb-1 block text-xs font-medium text-slate-600">Volta ao estoque depois de N dias sem pagamento</label><input type="number" min={1} value={def.quebra.dias_para_estoque ?? 6} onChange={e => setDef({ ...def, quebra: { ...def.quebra!, dias_para_estoque: Number(e.target.value) } })} className="h-10 w-28 rounded border-[#d8e3e5] px-3 text-sm outline-none focus:border-[#0F4C5C]"/></div>
								<p className="rounded bg-[#f2f6f7] px-3 py-2 text-xs text-[#365661]">{passosFrase(def.quebra.passos, 'D+') || '—'}</p>
							</div>
						)}
					</div>
				)}
			</div>

			<div className="mt-6 rounded-xl border border-[#fff0d6] bg-[#fff7e8] p-5 text-sm text-[#80520f]">
				<p><strong>Travas que valem sempre:</strong> contato inválido, contestado ou que não pertence ao cliente nunca recebe; WhatsApp só em número confiável ou com WhatsApp válido, com freio por taxa de bloqueio; horário, domingo e feriado; 48h entre ações massivas.</p>
			</div>
			{modelosOpen && <ModelosModal open={modelosOpen} onClose={() => setModelosOpen(false)} onAplicar={(d) => { setDef(d); setModelosOpen(false); }} />}
		</div>
	);
}
