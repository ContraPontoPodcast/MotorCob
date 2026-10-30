import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';
import { ArrowDown, ArrowUp, Download, Minus } from 'lucide-react';
import {
	Bar, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { Empty, Loading, Notice, PageHeading } from '@/components/app-shell';
import { useMotorAuth } from '@/components/auth-provider';
import { friendlyError, moneyBR, numberBR, supabase } from '@/lib/supabase';
import {
	allBuckets, bucketKey, bucketLabel, canalMeta, canalNome, canalOrdem,
	clusterNome, custoPorCpc, ehDiaUtil, fetchAcoes, mediaAtePrimeiroCpc, periodo7,
	periodoAnterior, periodo30, periodo60, periodoOntem, personaNome, reguaMeta, reguaOrdem,
	somar, taxaCpc, taxaRetorno, today, variacao, type AcaoRow, type Periodo,
} from '@/lib/acoes';

type Agrupar = 'dia' | 'semana' | 'mes';
type Quebra = 'canal' | 'regua' | 'cluster' | 'persona';

const PERIODO_PRESETS: { id: string; label: string; fn: () => Periodo }[] = [
	{ id: 'ontem', label: 'Ontem', fn: periodoOntem },
	{ id: '7', label: '7 dias', fn: periodo7 },
	{ id: '30', label: '30 dias', fn: periodo30 },
	{ id: '60', label: '60 dias', fn: periodo60 },
];

function parseList(v: string | null): string[] {
	return v ? v.split(',').map(s => s.trim()).filter(Boolean) : [];
}

function MultiSelect({ label, options, selected, onToggle, onClear }: {
	label: string;
	options: { id: string; label: string }[];
	selected: Set<string>;
	onToggle: (id: string) => void;
	onClear: () => void;
}) {
	const [open, setOpen] = useState(false);
	const all = selected.size === 0 || selected.size >= options.length;
	return (
		<div className="relative">
			<button
				type="button"
				onClick={() => setOpen(v => !v)}
				className={`flex h-9 items-center gap-2 rounded-lg border px-3 text-xs font-medium transition-colors ${open ? 'border-[#0F4C5C] bg-[#eaf2f3]' : 'border-[#dbe5e8] bg-white hover:bg-[#f5f8f9]'}`}
			>
				<span>{label}</span>
				<span className="rounded bg-[#eef3f4] px-1.5 py-0.5 text-[10px] text-slate-500">{all ? 'Todos' : selected.size}</span>
			</button>
			{open && (
				<>
					<button className="fixed inset-0 z-10 cursor-default" onClick={() => setOpen(false)} aria-hidden />
					<div className="absolute z-20 mt-1 min-w-[200px] max-h-64 overflow-auto rounded-lg border border-[#dbe5e8] bg-white p-2 shadow-lg">
						<div className="flex items-center justify-between px-1 pb-2">
							<span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">{label}</span>
							<button className="text-[10px] font-medium text-[#0F4C5C] hover:underline" onClick={onClear}>Limpar</button>
						</div>
						{options.length === 0 && <p className="px-1 py-2 text-xs text-slate-400">Sem opções no período.</p>}
						{options.map(o => (
							<label key={o.id} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-xs hover:bg-[#f5f8f9]">
								<input
									type="checkbox"
									checked={selected.has(o.id)}
									onChange={() => onToggle(o.id)}
									className="h-3.5 w-3.5 accent-[#0F4C5C]"
								/>
								<span>{o.label}</span>
							</label>
						))}
					</div>
				</>
			)}
		</div>
	);
}

function Variação({ curr, prev, invertido }: { curr: number; prev: number; invertido?: boolean }) {
	const v = variacao(curr, prev);
	if (v === null) return <span className="text-[11px] text-slate-300">—</span>;
	const up = v > 0.0001;
	const down = v < -0.0001;
	const bom = invertido ? down || !up : up;
	const cor = !up && !down ? 'text-slate-400' : bom ? 'text-[#2E7D32]' : 'text-[#C62828]';
	const Icon = up ? ArrowUp : down ? ArrowDown : Minus;
	return (
		<span className={`flex items-center gap-0.5 text-[11px] font-medium ${cor}`}>
			<Icon size={12} />
			{Math.abs(v * 100).toLocaleString('pt-BR', { maximumFractionDigits: 0 })}%
		</span>
	);
}

function pct(v: number | null): string {
	return v === null ? '—' : `${(v * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`;
}

export function Acoes() {
	const { empresa, credor } = useMotorAuth();
	const [params, setParams] = useSearchParams();

	const de = params.get('de') ?? periodo7().de;
	const ate = params.get('ate') ?? periodo7().ate;
	const agrupar = (params.get('agrupar') as Agrupar) ?? 'dia';
	const selCanal = new Set(parseList(params.get('canal')));
	const selRegua = new Set(parseList(params.get('regua')));
	const selCluster = new Set(parseList(params.get('cluster')));
	const selPersona = new Set(parseList(params.get('persona')));

	const [rows, setRows] = useState<AcaoRow[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState('');
	const [quebra, setQuebra] = useState<Quebra>('canal');
	const [sortKey, setSortKey] = useState<string>('enviadas');
	const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
	const [showAllAvisos, setShowAllAvisos] = useState(false);

	const periodo: Periodo = { de, ate };
	const prev = periodoAnterior(periodo);

	function update(next: Record<string, string | null>) {
		const p = new URLSearchParams(params);
		for (const [k, v] of Object.entries(next)) {
			if (v === null || v === '') p.delete(k); else p.set(k, v);
		}
		setParams(p, { replace: false });
	}

	useEffect(() => {
		if (!supabase || !empresa) return;
		let active = true;
		setLoading(true);
		(async () => {
			try {
				const data = await fetchAcoes(empresa.id, prev.de, ate, credor?.id);
				if (!active) return;
				setRows(data);
				setError('');
				setLoading(false);
			} catch {
				if (active) { setError(friendlyError()); setLoading(false); }
			}
		})();
		return () => { active = false; };
	}, [empresa?.id, prev.de, ate, credor?.id]);

	// Slice por período.
	const currentRows = useMemo(() => rows.filter(r => r.data >= de && r.data <= ate), [rows, de, ate]);
	const prevRows = useMemo(() => rows.filter(r => r.data >= prev.de && r.data <= prev.ate), [rows, prev.de, prev.ate]);

	// Opções dos selects (valores existentes no período atual).
	const optCanal = useMemo(() => canalOrdem.filter(c => currentRows.some(r => r.canal === c)).map(c => ({ id: c, label: canalNome(c) })), [currentRows]);
	const optRegua = useMemo(() => reguaOrdem.filter(r => currentRows.some(rr => rr.regua === r)).map(r => ({ id: r, label: reguaMeta[r] ?? r })), [currentRows]);
	const optCluster = useMemo(() => {
		const set = new Set<string>();
		currentRows.forEach(r => set.add(r.cluster ?? ''));
		return [...set].map(c => ({ id: c, label: clusterNome(c || null) })).sort((a, b) => a.label.localeCompare(b.label));
	}, [currentRows]);
	const optPersona = useMemo(() => {
		const set = new Set<string>();
		currentRows.forEach(r => set.add(r.persona ?? ''));
		return [...set].map(p => ({ id: p, label: personaNome(p || null) })).sort((a, b) => a.label.localeCompare(b.label));
	}, [currentRows]);

	// Aplica filtros multi-select (vazio = todos).
	const filtered = useMemo(() => currentRows.filter(r =>
		(selCanal.size === 0 || selCanal.has(r.canal)) &&
		(selRegua.size === 0 || selRegua.has(r.regua)) &&
		(selCluster.size === 0 || selCluster.has(r.cluster ?? '')) &&
		(selPersona.size === 0 || selPersona.has(r.persona ?? ''))
	), [currentRows, selCanal, selRegua, selCluster, selPersona]);
	const filteredPrev = useMemo(() => prevRows.filter(r =>
		(selCanal.size === 0 || selCanal.has(r.canal)) &&
		(selRegua.size === 0 || selRegua.has(r.regua)) &&
		(selCluster.size === 0 || selCluster.has(r.cluster ?? '')) &&
		(selPersona.size === 0 || selPersona.has(r.persona ?? ''))
	), [prevRows, selCanal, selRegua, selCluster, selPersona]);

	const totais = useMemo(() => somar(filtered), [filtered]);
	const totaisPrev = useMemo(() => somar(filteredPrev), [filteredPrev]);

	// Gráfico: buckets por canal + taxa de CPC.
	const chartData = useMemo(() => {
		const buckets = allBuckets(de, ate, agrupar);
		return buckets.map(bk => {
			const bucketRows = filtered.filter(r => bucketKey(r.data, agrupar) === bk);
			const entry: Record<string, number | null | string> = { label: bucketLabel(bk, agrupar), bucket: bk };
			for (const c of canalOrdem) {
				entry[c] = bucketRows.filter(r => r.canal === c && r.regua !== 'fora_da_lista').reduce((n, r) => n + (Number(r.enviadas) || 0), 0);
			}
			const tb = somar(bucketRows);
			entry.cpcRate = tb.enviadas ? tb.cpcs / tb.enviadas : null;
			return entry;
		});
	}, [filtered, de, ate, agrupar]);

	// Tabela por quebra.
	const tableRows = useMemo(() => {
		const groups = new Map<string, AcaoRow[]>();
		for (const r of filtered) {
			let key: string;
			if (quebra === 'canal') key = r.canal;
			else if (quebra === 'regua') key = r.regua;
			else if (quebra === 'cluster') key = r.cluster ?? '';
			else key = r.persona ?? '';
			if (!groups.has(key)) groups.set(key, []);
			groups.get(key)!.push(r);
		}
		const items = [...groups.entries()].map(([key, list]) => {
			const t = somar(list);
			let label: string;
			if (quebra === 'canal') label = canalNome(key);
			else if (quebra === 'regua') label = reguaMeta[key] ?? key;
			else if (quebra === 'cluster') label = clusterNome(key || null);
			else label = personaNome(key || null);
			return { key, label, t };
		});
		const sortVal = (t: typeof totais) => {
			switch (sortKey) {
				case 'enviadas': return t.enviadas;
				case 'com_retorno': return t.com_retorno;
				case 'taxa_retorno': return taxaRetorno(t) ?? -1;
				case 'cpcs': return t.cpcs;
				case 'taxa_cpc': return taxaCpc(t) ?? -1;
				case 'custo': return t.custo;
				case 'custo_cpc': return custoPorCpc(t) ?? -1;
				case 'media_cpc': return mediaAtePrimeiroCpc(t) ?? -1;
				default: return t.enviadas;
			}
		};
		items.sort((a, b) => {
			const diff = sortVal(a.t) - sortVal(b.t);
			return sortDir === 'asc' ? diff : -diff;
		});
		return items;
	}, [filtered, quebra, sortKey, sortDir]);

	// Avisos.
	const avisosSemOcorrencia = useMemo(() => {
		const out: { data: string; canal: string; enviadas: number }[] = [];
		const diasUteis = [...new Set(currentRows.map(r => r.data))].filter(d => d < today() && ehDiaUtil(d));
		for (const d of diasUteis) {
			const canais = [...new Set(currentRows.filter(r => r.data === d).map(r => r.canal))];
			for (const c of canais) {
				const rs = currentRows.filter(r => r.data === d && r.canal === c);
				const enviadas = rs.reduce((n, r) => n + (r.regua === 'fora_da_lista' ? 0 : (Number(r.enviadas) || 0)), 0);
				const comRetorno = rs.reduce((n, r) => n + (Number(r.com_retorno) || 0), 0);
				if (enviadas > 0 && comRetorno === 0) out.push({ data: d, canal: c, enviadas });
			}
		}
		return out.sort((a, b) => b.data.localeCompare(a.data));
	}, [currentRows]);

	const foraDaLista = useMemo(() => {
		const rs = filtered.filter(r => r.regua === 'fora_da_lista');
		return { count: rs.reduce((n, r) => n + (Number(r.com_retorno) || 0), 0), rows: rs.length };
	}, [filtered]);

	function toggleSelect(param: string, id: string, options: { id: string }[]) {
		const cur = new Set(parseList(params.get(param)));
		if (cur.has(id)) cur.delete(id); else cur.add(id);
		// Se vazio ou todos → remove param (significa "todos").
		const all = cur.size === 0 || cur.size >= options.length;
		update({ [param]: all ? null : [...cur].join(',') });
	}

	function setPreset(p: Periodo) { update({ de: p.de, ate: p.ate }); }

	function clearAll() {
		setParams(new URLSearchParams({ de: periodo7().de, ate: periodo7().ate, agrupar: 'dia' }), { replace: false });
	}

	function sortCol(key: string) {
		if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
		else { setSortKey(key); setSortDir('desc'); }
	}

	function baixarCSV() {
		const cols = ['Segmento', 'Enviadas', 'Com retorno', '% retorno', 'CPC', '% CPC', 'Custo', 'Custo por CPC', 'Ações até o 1º CPC'];
		const lines = [cols.join(';')];
		for (const r of tableRows) {
			lines.push([
				r.label,
				r.t.enviadas, r.t.com_retorno, pct(taxaRetorno(r.t)).replace('%', ''),
				r.t.cpcs, pct(taxaCpc(r.t)).replace('%', ''),
				r.t.custo.toFixed(2), custoPorCpc(r.t) === null ? '' : custoPorCpc(r.t)!.toFixed(2),
				mediaAtePrimeiroCpc(r.t) === null ? '' : mediaAtePrimeiroCpc(r.t)!.toFixed(1),
			].join(';'));
		}
		lines.push(['Total', totais.enviadas, totais.com_retorno, pct(taxaRetorno(totais)).replace('%', ''),
			totais.cpcs, pct(taxaCpc(totais)).replace('%', ''), totais.custo.toFixed(2),
			custoPorCpc(totais) === null ? '' : custoPorCpc(totais)!.toFixed(2),
			mediaAtePrimeiroCpc(totais) === null ? '' : mediaAtePrimeiroCpc(totais)!.toFixed(1)].join(';'));
		const blob = new Blob([`\uFEFF${lines.join('\n')}`], { type: 'text/csv;charset=utf-8;' });
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url; a.download = `acoes_${quebra}_${de}_${ate}.csv`;
		document.body.appendChild(a); a.click(); a.remove();
		setTimeout(() => URL.revokeObjectURL(url), 30000);
	}

	const presetAtivo = PERIODO_PRESETS.find(p => { const r = p.fn(); return r.de === de && r.ate === ate; });
	const isCustom = !presetAtivo;

	const cards = [
		{ key: 'enviadas', label: 'Ações enviadas', value: numberBR(totais.enviadas), sub: `+ ${numberBR(totais.reservas)} reservas exportadas`, invertido: false },
		{ key: 'com_retorno', label: 'Com retorno', value: numberBR(totais.com_retorno), sub: pct(taxaRetorno(totais)), invertido: false },
		{ key: 'cpcs', label: 'CPC', value: numberBR(totais.cpcs), sub: pct(taxaCpc(totais)), invertido: false },
		{ key: 'custo', label: 'Custo', value: moneyBR(totais.custo), sub: '', invertido: true },
		{ key: 'custo_cpc', label: 'Custo por CPC', value: custoPorCpc(totais) === null ? '—' : moneyBR(custoPorCpc(totais)), sub: '', invertido: true },
		{ key: 'media_cpc', label: 'Ações até o 1º CPC', value: mediaAtePrimeiroCpc(totais) === null ? '—' : mediaAtePrimeiroCpc(totais)!.toLocaleString('pt-BR', { maximumFractionDigits: 1 }), sub: `em ${numberBR(totais.primeiros_cpc)} clientes que deram o 1º CPC`, invertido: false },
	];
	const prevVals: Record<string, number> = {
		enviadas: totaisPrev.enviadas, com_retorno: totaisPrev.com_retorno, cpcs: totaisPrev.cpcs,
		custo: totaisPrev.custo, custo_cpc: custoPorCpc(totaisPrev) ?? 0, media_cpc: mediaAtePrimeiroCpc(totaisPrev) ?? 0,
	};

	const tableCols = [
		{ key: 'enviadas', label: 'Enviadas' }, { key: 'com_retorno', label: 'Com retorno' },
		{ key: 'taxa_retorno', label: '% retorno' }, { key: 'cpcs', label: 'CPC' },
		{ key: 'taxa_cpc', label: '% CPC' }, { key: 'custo', label: 'Custo' },
		{ key: 'custo_cpc', label: 'Custo por CPC' }, { key: 'media_cpc', label: 'Ações até o 1º CPC' },
	];

	return (
		<>
			<PageHeading eyebrow="OPERAÇÃO / AÇÕES" title="Ações" description="Quantas ações o MotorCX mandou fazer e o que voltou delas. Os números de um dia se completam quando a ocorrência da empresa chega." />

			{!empresa ? <Notice variant="warning">Escolha a empresa no topo para ver esta página.</Notice> : loading ? <Loading /> : error ? <Notice>{error}</Notice> : filtered.length === 0 ? (
				<div className="rounded-xl border border-dashed border-[#cbd9dd] bg-white px-6 py-12 text-center text-sm text-slate-500">
					As ações aparecem depois da primeira rotina do MotorCX. O CPC e o custo aparecem quando chegar a ocorrência da empresa.
				</div>
			) : (
				<div className="space-y-6">
					{/* Avisos */}
					{(avisosSemOcorrencia.length > 0 || foraDaLista.count > 0) && (
						<div className="space-y-3">
							{avisosSemOcorrencia.length > 0 && (
								<div className="rounded-lg border border-amber-200 bg-[#fff7e8] p-4">
									<p className="mb-2 flex items-center gap-2 text-xs font-bold uppercase text-[#946015]">Ações sem ocorrência</p>
									<ul className="space-y-1.5 text-sm text-[#80520f]">
										{(showAllAvisos ? avisosSemOcorrencia : avisosSemOcorrencia.slice(0, 5)).map((a, i) => (
											<li key={i}>
												{a.data.slice(8, 10)}/{a.data.slice(5, 7)} · {canalNome(a.canal)}: {numberBR(a.enviadas)} ações sem ocorrência de volta. Envie o arquivo de ocorrência em Enviar arquivos para o MotorCX contar CPC e custo.
											</li>
										))}
									</ul>
									{avisosSemOcorrencia.length > 5 && (
										<button className="mt-2 text-xs font-semibold text-[#946015] hover:underline" onClick={() => setShowAllAvisos(v => !v)}>
											{showAllAvisos ? 'ver menos' : `ver todos (${avisosSemOcorrencia.length})`}
										</button>
									)}
								</div>
							)}
							{foraDaLista.count > 0 && (
								<div className="rounded-lg border border-amber-200 bg-[#fff7e8] p-4 text-sm text-[#80520f]">
									{numberBR(foraDaLista.count)} ocorrências não batem com ações do MotorCX (a empresa acionou por fora ou mandou o ID errado). Essas linhas entram em “Com retorno” e “CPC” mas não em “Ações enviadas”.
								</div>
							)}
						</div>
					)}

					{/* Filtros */}
					<div className="rounded-xl border border-[#dee7e9] bg-white p-4 sm:p-5">
						<div className="flex flex-wrap items-center gap-2">
							{PERIODO_PRESETS.map(p => {
								const ativo = presetAtivo?.id === p.id;
								return <button key={p.id} onClick={() => setPreset(p.fn())} className={`h-9 rounded-lg px-3 text-xs font-medium transition-colors ${ativo ? 'bg-[#0F4C5C] text-white' : 'border border-[#dbe5e8] bg-white text-slate-600 hover:bg-[#f5f8f9]'}`}>{p.label}</button>;
							})}
							<button onClick={() => update({})} className={`h-9 rounded-lg px-3 text-xs font-medium transition-colors ${isCustom ? 'bg-[#0F4C5C] text-white' : 'border border-[#dbe5e8] bg-white text-slate-600 hover:bg-[#f5f8f9]'}`}>Personalizado</button>
							{isCustom && (
								<span className="flex items-center gap-1.5">
									<input type="date" value={de} onChange={e => update({ de: e.target.value })} className="h-9 rounded-lg border border-[#dbe5e8] px-2 text-xs outline-none" />
									<span className="text-xs text-slate-400">até</span>
									<input type="date" value={ate} onChange={e => update({ ate: e.target.value })} className="h-9 rounded-lg border border-[#dbe5e8] px-2 text-xs outline-none" />
								</span>
							)}
							<div className="mx-1 hidden h-6 w-px bg-[#e3e9eb] sm:block" />
							<div className="flex items-center gap-1">
								{(['dia', 'semana', 'mes'] as Agrupar[]).map(a => (
									<button key={a} onClick={() => update({ agrupar: a })} className={`h-9 rounded-lg px-3 text-xs font-medium capitalize transition-colors ${agrupar === a ? 'bg-[#eaf2f3] text-[#0F4C5C] border border-[#bcd6da]' : 'text-slate-500 hover:bg-[#f5f8f9]'}`}>{a === 'mes' ? 'Mês' : a === 'dia' ? 'Dia' : 'Semana'}</button>
								))}
							</div>
							<div className="mx-1 hidden h-6 w-px bg-[#e3e9eb] sm:block" />
							<MultiSelect label="Canal" options={optCanal} selected={selCanal} onToggle={id => toggleSelect('canal', id, optCanal)} onClear={() => update({ canal: null })} />
							<MultiSelect label="Momento" options={optRegua} selected={selRegua} onToggle={id => toggleSelect('regua', id, optRegua)} onClear={() => update({ regua: null })} />
							<MultiSelect label="Segmento" options={optCluster} selected={selCluster} onToggle={id => toggleSelect('cluster', id, optCluster)} onClear={() => update({ cluster: null })} />
							<MultiSelect label="Persona" options={optPersona} selected={selPersona} onToggle={id => toggleSelect('persona', id, optPersona)} onClear={() => update({ persona: null })} />
							<button onClick={clearAll} className="ml-auto h-9 rounded-lg px-3 text-xs font-medium text-slate-500 hover:bg-[#f5f8f9] hover:text-[#0F4C5C]">Limpar filtros</button>
						</div>
					</div>

					{/* Cartões */}
					<div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
						{cards.map(c => (
							<div key={c.key} className="rounded-xl border border-[#dfe8ea] bg-white p-5">
								<p className="text-xs text-slate-500">{c.label}</p>
								<div className="mt-2 flex items-baseline gap-2">
									<p className="text-2xl font-semibold tracking-tight text-[#0F4C5C]">{c.value}</p>
									<Variação curr={c.key === 'custo_cpc' || c.key === 'media_cpc' ? (c.key === 'custo_cpc' ? custoPorCpc(totais) ?? 0 : mediaAtePrimeiroCpc(totais) ?? 0) : (totais as Record<string, number>)[c.key] ?? 0} prev={prevVals[c.key]} invertido={c.invertido} />
								</div>
								{c.sub && <p className="mt-2 text-xs text-slate-400">{c.sub}</p>}
							</div>
						))}
					</div>

					{/* Gráfico */}
					<section className="rounded-xl border border-[#dee7e9] bg-white p-6 sm:p-8">
						<div className="mb-5 flex flex-wrap items-center justify-between gap-3">
							<h2 className="text-lg font-semibold">Ações enviadas e taxa de CPC</h2>
							<div className="flex flex-wrap gap-x-4 gap-y-1">
								{canalOrdem.filter(c => optCanal.some(o => o.id === c)).map(c => (
									<span key={c} className="flex items-center gap-1.5 text-xs text-slate-500">
										<span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: canalMeta[c]?.cor }} />
										{canalNome(c)}
									</span>
								))}
								<span className="flex items-center gap-1.5 text-xs text-slate-500">
									<span className="h-0.5 w-4" style={{ backgroundColor: '#e9a23b' }} />
									Taxa de CPC
								</span>
							</div>
						</div>
						<div className="h-[320px] w-full">
							<ResponsiveContainer width="100%" height="100%">
								<ComposedChart data={chartData} margin={{ top: 8, right: 8, bottom: 0, left: -12 }}>
									<CartesianGrid strokeDasharray="3 3" stroke="#eef2f3" vertical={false} />
									<XAxis dataKey="label" tick={{ fontSize: 11, fill: '#64748b' }} interval="preserveStartEnd" minTickGap={20} />
									<YAxis yAxisId="left" tick={{ fontSize: 11, fill: '#64748b' }} />
									<YAxis yAxisId="right" orientation="right" tickFormatter={v => `${Math.round(v * 100)}%`} tick={{ fontSize: 11, fill: '#64748b' }} domain={[0, 1]} />
									<Tooltip content={<ChartTooltip />} />
									{canalOrdem.filter(c => optCanal.some(o => o.id === c)).map(c => (
										<Bar key={c} yAxisId="left" dataKey={c} stackId="a" fill={canalMeta[c]?.cor} name={canalNome(c)} />
									))}
									<Line yAxisId="right" type="monotone" dataKey="cpcRate" stroke="#e9a23b" strokeWidth={2} dot={false} name="Taxa de CPC" connectNulls />
								</ComposedChart>
							</ResponsiveContainer>
						</div>
					</section>

					{/* Tabela */}
					<section className="rounded-xl border border-[#dee7e9] bg-white p-6 sm:p-8">
						<div className="mb-5 flex flex-wrap items-center justify-between gap-3">
							<div className="flex flex-wrap gap-1">
								{([['canal', 'Por canal'], ['regua', 'Por momento'], ['cluster', 'Por segmento'], ['persona', 'Por persona']] as [Quebra, string][]).map(([q, l]) => (
									<button key={q} onClick={() => setQuebra(q)} className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${quebra === q ? 'bg-[#0F4C5C] text-white' : 'text-slate-500 hover:bg-[#f5f8f9]'}`}>{l}</button>
								))}
							</div>
							<button onClick={baixarCSV} className="flex h-9 items-center gap-2 rounded-lg border border-[#dbe5e8] bg-white px-3 text-xs font-medium text-slate-600 hover:bg-[#f5f8f9]">
								<Download size={14} /> Baixar CSV
							</button>
						</div>
						<div className="overflow-x-auto">
							<table className="w-full min-w-[900px] text-left text-sm">
								<thead>
									<tr className="border-b border-[#e2eaec] text-xs text-slate-500">
										<th className="pb-3 pr-4 font-semibold capitalize">{quebra === 'regua' ? 'momento' : quebra === 'cluster' ? 'segmento' : quebra}</th>
										{tableCols.map(col => (
											<th key={col.key} onClick={() => sortCol(col.key)} className="cursor-pointer pb-3 pr-4 text-right font-semibold hover:text-[#0F4C5C]">
												{col.label}{sortKey === col.key ? (sortDir === 'asc' ? ' ↑' : ' ↓') : ''}
											</th>
										))}
									</tr>
								</thead>
								<tbody className="divide-y divide-[#e9eff0]">
									{tableRows.map(r => (
										<tr key={r.key} className="hover:bg-[#f6fafb]">
											<td className="py-3 pr-4 font-medium text-[#163943]">{r.label}</td>
											<td className="py-3 pr-4 text-right">{numberBR(r.t.enviadas)}</td>
											<td className="py-3 pr-4 text-right">{numberBR(r.t.com_retorno)}</td>
											<td className="py-3 pr-4 text-right text-slate-500">{pct(taxaRetorno(r.t))}</td>
											<td className="py-3 pr-4 text-right">{numberBR(r.t.cpcs)}</td>
											<td className="py-3 pr-4 text-right text-slate-500">{pct(taxaCpc(r.t))}</td>
											<td className="py-3 pr-4 text-right">{moneyBR(r.t.custo)}</td>
											<td className="py-3 pr-4 text-right">{custoPorCpc(r.t) === null ? '—' : moneyBR(custoPorCpc(r.t))}</td>
											<td className="py-3 pr-4 text-right">{mediaAtePrimeiroCpc(r.t) === null ? '—' : mediaAtePrimeiroCpc(r.t)!.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}</td>
										</tr>
									))}
									<tr className="border-t-2 border-[#cdd9db] font-bold">
										<td className="py-3 pr-4 text-[#163943]">Total</td>
										<td className="py-3 pr-4 text-right">{numberBR(totais.enviadas)}</td>
										<td className="py-3 pr-4 text-right">{numberBR(totais.com_retorno)}</td>
										<td className="py-3 pr-4 text-right">{pct(taxaRetorno(totais))}</td>
										<td className="py-3 pr-4 text-right">{numberBR(totais.cpcs)}</td>
										<td className="py-3 pr-4 text-right">{pct(taxaCpc(totais))}</td>
										<td className="py-3 pr-4 text-right">{moneyBR(totais.custo)}</td>
										<td className="py-3 pr-4 text-right">{custoPorCpc(totais) === null ? '—' : moneyBR(custoPorCpc(totais))}</td>
										<td className="py-3 pr-4 text-right">{mediaAtePrimeiroCpc(totais) === null ? '—' : mediaAtePrimeiroCpc(totais)!.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}</td>
									</tr>
								</tbody>
							</table>
						</div>
					</section>
				</div>
			)}
		</>
	);
}

function ChartTooltip({ active, payload, label }: { active?: boolean; payload?: any[]; label?: string }) {
	if (!active || !payload || payload.length === 0) return null;
	const bars = payload.filter(p => p.dataKey !== 'cpcRate' && (p.value as number) > 0);
	const total = bars.reduce((n, p) => n + (Number(p.value) || 0), 0);
	const cpc = payload.find(p => p.dataKey === 'cpcRate');
	return (
		<div className="rounded-lg border border-[#dbe5e8] bg-white p-3 text-xs shadow-lg">
			<p className="mb-2 font-semibold text-[#163943]">{label}</p>
			<div className="space-y-1">
				{bars.map(p => (
					<div key={p.dataKey} className="flex items-center justify-between gap-4">
						<span className="flex items-center gap-1.5 text-slate-600">
							<span className="h-2 w-2 rounded-sm" style={{ backgroundColor: p.color }} />
							{p.name}
						</span>
						<span className="font-medium">{numberBR(p.value)}</span>
					</div>
				))}
				{bars.length > 0 && (
					<div className="flex items-center justify-between gap-4 border-t border-[#eef2f3] pt-1 text-slate-500">
						<span>Total enviadas</span><span className="font-medium">{numberBR(total)}</span>
					</div>
				)}
				{cpc && cpc.value !== null && (
					<div className="flex items-center justify-between gap-4 border-t border-[#eef2f3] pt-1 text-[#946015]">
						<span>Taxa de CPC</span><span className="font-medium">{pct(Number(cpc.value))}</span>
					</div>
				)}
			</div>
		</div>
	);
}
