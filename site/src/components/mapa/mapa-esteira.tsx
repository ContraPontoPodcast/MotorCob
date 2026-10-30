import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';
import { Filter, X, ArrowRight, ArrowUpRight, ArrowDownRight } from 'lucide-react';
import { Loading, Notice, PageHeading } from '@/components/app-shell';
import { useMotorAuth } from '@/components/auth-provider';
import { friendlyError, moneyBR, numberBR, supabase, today, type Row } from '@/lib/supabase';
import { rotuloEstado, rotuloCiclo, rotuloPasso, canalCodigo, mapaCanais } from '@/lib/operacao';
import { PorQueHoje } from '@/components/por-que-hoje';

// --- ordem da jornada ---
const MASSIVAS = ['LOC', 'NCP', 'CPA', 'CPB'];
const ACORDO = ['COL', 'PRE', 'QBR', 'LIQ'];
const ACTIVE_BASE = ['LOC', 'NCP', 'CPA', 'CPB', 'COL', 'PRE', 'QBR'];

/** Verde = avanço (CPC, acordo, quitação, entrada); vermelho = recuo (quebra, Não CPC, bloqueio). */
function fluxoTipo(para: string): 'advance' | 'retreat' {
	if (['CPA', 'CPB', 'COL', 'PRE', 'LIQ', 'LOC'].includes(para)) return 'advance';
	return 'retreat';
}

export function MapaEsteira() {
	const { empresa, credores } = useMotorAuth();
	const [searchParams, setSearchParams] = useSearchParams();
	const carteira = searchParams.get('carteira') || '';
	const medida = searchParams.get('medida') || 'clientes';
	const fCluster = searchParams.get('segmento') || '';
	const fCanal = searchParams.get('canal') || '';
	const mov = Number(searchParams.get('periodo') || '7');
	const sel = searchParams.get('sel') || '';

	const [mapaRows, setMapaRows] = useState<Row[]>([]);
	const [fluxoRows, setFluxoRows] = useState<Row[]>([]);
	const [filaDia, setFilaDia] = useState<Row[]>([]);
	const [run, setRun] = useState<Row | null>(null);
	const [clusterNames, setClusterNames] = useState<Record<string, string>>({});
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState('');

	function setParam(key: string, value: string) {
		setSearchParams(prev => {
			const next = new URLSearchParams(prev);
			if (value) next.set(key, value); else next.delete(key);
			return next;
		}, { replace: true });
	}

	useEffect(() => {
		if (!supabase || !empresa) return;
		const client = supabase; let active = true; setLoading(true); setError('');
		const desde = new Date(); desde.setDate(desde.getDate() - mov);
		const desdeStr = desde.toISOString().slice(0, 10);
		const cf = <T,>(q: T): T => (carteira ? (q as { eq: (c: string, v: string) => T }).eq('credor_id', carteira) : q);
		Promise.all([
			cf(client.from('mapa_esteira').select('*').eq('empresa_id', empresa.id)),
			cf(client.from('fluxo_esteira').select('*').eq('empresa_id', empresa.id).gte('data', desdeStr)),
			cf(client.from('fila_dia').select('tag').eq('empresa_id', empresa.id).eq('data', today())),
			cf(client.from('ultima_execucao').select('*').eq('empresa_id', empresa.id)),
			client.from('clusters').select('codigo,nome').eq('empresa_id', empresa.id),
		]).then(([a, b, c, d, e]) => {
			if (!active) return;
			if (a.error || b.error || c.error) { setError(friendlyError()); setLoading(false); return; }
			setMapaRows(a.data ?? []);
			setFluxoRows(b.data ?? []);
			setFilaDia(c.data ?? []);
			setRun((d.data ?? [])[0] ?? null);
			const cn: Record<string, string> = {};
			(e.data ?? []).forEach((r: Row) => { cn[r.codigo as string] = r.nome as string; });
			setClusterNames(cn);
			setLoading(false);
		}).catch(() => { if (active) { setError(friendlyError()); setLoading(false); } });
		return () => { active = false; };
	}, [empresa?.id, mov, carteira]);

	const clusterVals = useMemo(() => Array.from(new Set(mapaRows.map(r => r.cluster).filter(Boolean))) as string[], [mapaRows]);

	const filtered = useMemo(() => mapaRows.filter(r =>
		(!fCluster || r.cluster === fCluster) && (!fCanal || r.canal === fCanal)
	), [mapaRows, fCluster, fCanal]);

	const porEstado = useMemo(() => {
		const m: Record<string, { clientes: number; saldo: number }> = {};
		filtered.forEach(r => {
			const e = r.estado as string; if (!e) return;
			m[e] = m[e] ?? { clientes: 0, saldo: 0 };
			m[e].clientes += Number(r.clientes ?? 0); m[e].saldo += Number(r.saldo ?? 0);
		});
		return m;
	}, [filtered]);

	const fluxo = useMemo(() => {
		const m: Record<string, number> = {};
		fluxoRows.forEach(r => { const k = `${r.de ?? 'null'}→${r.para}`; m[k] = (m[k] ?? 0) + Number(r.clientes ?? 0); });
		return m;
	}, [fluxoRows]);

	const entraram = useMemo(() => {
		const m: Record<string, number> = {};
		fluxoRows.forEach(r => { const p = r.para as string; if (p) m[p] = (m[p] ?? 0) + Number(r.clientes ?? 0); });
		return m;
	}, [fluxoRows]);
	const sairam = useMemo(() => {
		const m: Record<string, number> = {};
		fluxoRows.forEach(r => { const d = r.de as string; if (d) m[d] = (m[d] ?? 0) + Number(r.clientes ?? 0); });
		return m;
	}, [fluxoRows]);

	const acaoHoje = useMemo(() => {
		const m: Record<string, number> = {};
		filaDia.forEach(r => { const parts = String(r.tag ?? '').split('-'); const e = parts[2]; if (e) m[e] = (m[e] ?? 0) + 1; });
		return m;
	}, [filaDia]);

	const activeBase = ACTIVE_BASE.reduce((n, e) => n + (porEstado[e]?.clientes ?? 0), 0);
	const activeBaseSaldo = ACTIVE_BASE.reduce((n, e) => n + (porEstado[e]?.saldo ?? 0), 0);
	const totalAcaoHoje = Object.values(acaoHoje).reduce((n, v) => n + v, 0);

	const medir = (e: string) => medida === 'saldo' ? (porEstado[e]?.saldo ?? 0) : (porEstado[e]?.clientes ?? 0);
	const medirFmt = (v: number) => medida === 'saldo' ? moneyBR(v) : numberBR(v);
	const baseVal = medida === 'saldo' ? activeBaseSaldo : activeBase;
	const pctDe = (e: string) => baseVal ? Math.round((medir(e) / baseVal) * 100) : 0;

	// movimento ordenado do maior para o menor
	const movimentos = useMemo(() => Object.entries(fluxo)
		.map(([k, v]) => { const [de, para] = k.split('→'); return { de: de === 'null' ? '' : de, para, v, tipo: fluxoTipo(para) }; })
		.sort((a, b) => b.v - a.v), [fluxo]);
	const maxFluxo = Math.max(...movimentos.map(m => m.v), 1);

	// detalhe da fase selecionada
	const porPasso = useMemo(() => {
		if (!sel) return [];
		const m: Record<string, number> = {};
		filtered.filter(r => r.estado === sel).forEach(r => { const et = r.etapa as string; if (et) m[et] = (m[et] ?? 0) + Number(r.clientes ?? 0); });
		return Object.entries(m).sort((a, b) => b[1] - a[1]);
	}, [filtered, sel]);

	const porCanal = useMemo(() => {
		if (!sel || !['CPA', 'CPB', 'PRE', 'QBR', 'COL'].includes(sel)) return [];
		const m: Record<string, number> = {};
		filtered.filter(r => r.estado === sel).forEach(r => { const c = r.canal as string; if (c) m[c] = (m[c] ?? 0) + Number(r.clientes ?? 0); });
		return Object.entries(m).sort((a, b) => b[1] - a[1]);
	}, [filtered, sel]);

	const porCluster = useMemo(() => {
		if (!sel) return [];
		const m: Record<string, number> = {};
		filtered.filter(r => r.estado === sel).forEach(r => { const c = (r.cluster as string) || 'PADRAO'; m[c] = (m[c] ?? 0) + Number(r.clientes ?? 0); });
		return Object.entries(m).sort((a, b) => b[1] - a[1]);
	}, [filtered, sel]);

	const selMov = useMemo(() => {
		if (!sel) return { veio: [] as [string, number][], foi: [] as [string, number][] };
		const veio: [string, number][] = []; const foi: [string, number][] = [];
		Object.entries(fluxo).forEach(([k, v]) => { const [de, para] = k.split('→'); if (para === sel && de !== 'null') veio.push([de, v]); if (de === sel) foi.push([para, v]); });
		return { veio: veio.sort((a, b) => b[1] - a[1]), foi: foi.sort((a, b) => b[1] - a[1]) };
	}, [fluxo, sel]);

	const clusterLabel = (code: string) => clusterNames[code] ? `${code} · ${clusterNames[code]}` : (/^[AB][123]$/.test(code) ? `${code} · Padrão` : code);
	const hasFilters = !!(fCluster || fCanal);

	const heading = <PageHeading eyebrow="VISÃO GERAL / ESTEIRA" title="Mapa da Esteira" description="Onde está a base hoje em cada etapa dos acionamentos, e quem se moveu entre elas." />;

	if (!empresa) return <>{heading}<Notice variant="warning">Escolha a empresa no topo para ver esta página.</Notice></>;
	if (loading) return <>{heading}<Loading /></>;
	if (error) return <>{heading}<Notice>{error}</Notice></>;

	if (mapaRows.length === 0 && !run) return <>
		{heading}
		<div className="rounded-xl border border-dashed border-[#cbd9dd] bg-white p-12 text-center text-sm text-slate-500">O mapa aparece depois da primeira rotina desta empresa.</div>
	</>;

	return <>
		{heading}

		{/* filtros */}
		<div className="mb-5 space-y-4 rounded-xl border border-[#dfe8ea] bg-white p-5">
			<div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
				<div>
					<p className="mb-2 text-[11px] font-bold uppercase tracking-wider text-slate-400">Carteira</p>
					<select value={carteira} onChange={e => setParam('carteira', e.target.value)} className="h-9 w-full rounded-lg border border-[#d8e3e5] bg-white px-2 text-sm outline-none focus:border-[#0F4C5C]">
						<option value="">Todas</option>
						{credores.map(c => <option key={c.id} value={c.id}>{c.nome}</option>)}
					</select>
				</div>
				<div>
					<p className="mb-2 text-[11px] font-bold uppercase tracking-wider text-slate-400">Medir por</p>
					<div className="inline-flex rounded-lg border border-[#d8e3e5] p-0.5">
						<button onClick={() => setParam('medida', '')} className={`rounded px-3 py-1.5 text-sm font-medium ${medida === 'clientes' ? 'bg-[#0F4C5C] text-white' : 'text-slate-600'}`}>Clientes</button>
						<button onClick={() => setParam('medida', 'saldo')} className={`rounded px-3 py-1.5 text-sm font-medium ${medida === 'saldo' ? 'bg-[#0F4C5C] text-white' : 'text-slate-600'}`}>Saldo</button>
					</div>
				</div>
				<div>
					<p className="mb-2 text-[11px] font-bold uppercase tracking-wider text-slate-400">Período</p>
					<div className="inline-flex rounded-lg border border-[#d8e3e5] p-0.5">
						<button onClick={() => setParam('periodo', '')} className={`rounded px-3 py-1.5 text-sm font-medium ${mov === 7 ? 'bg-[#0F4C5C] text-white' : 'text-slate-600'}`}>7 dias</button>
						<button onClick={() => setParam('periodo', '30')} className={`rounded px-3 py-1.5 text-sm font-medium ${mov === 30 ? 'bg-[#0F4C5C] text-white' : 'text-slate-600'}`}>30 dias</button>
					</div>
				</div>
				<div>
					<p className="mb-2 text-[11px] font-bold uppercase tracking-wider text-slate-400">Segmento</p>
					<select value={fCluster} onChange={e => setParam('segmento', e.target.value)} className="h-9 w-full rounded-lg border border-[#d8e3e5] bg-white px-2 text-sm outline-none focus:border-[#0F4C5C]">
						<option value="">Todos</option>
						{clusterVals.map(c => <option key={c} value={c}>{clusterLabel(c)}</option>)}
					</select>
				</div>
				<div>
					<p className="mb-2 text-[11px] font-bold uppercase tracking-wider text-slate-400">Canal</p>
					<select value={fCanal} onChange={e => setParam('canal', e.target.value)} className="h-9 w-full rounded-lg border border-[#d8e3e5] bg-white px-2 text-sm outline-none focus:border-[#0F4C5C]">
						<option value="">Todos</option>
						{mapaCanais.map(c => <option key={c.id} value={c.id}>{c.label} ({c.id})</option>)}
					</select>
				</div>
			</div>

			{/* chips de filtros ativos */}
			<div className="flex flex-wrap items-center gap-2 border-t border-[#eef2f3] pt-3">
				{!hasFilters && !carteira ? <span className="text-xs text-slate-400">Sem filtros: base inteira de todas as carteiras.</span> : <>
					<Filter size={13} className="text-slate-400" />
					{carteira && <Chip label={`Carteira: ${credores.find(c => c.id === carteira)?.nome ?? carteira}`} onClear={() => setParam('carteira', '')} />}
					{fCluster && <Chip label={`Segmento: ${clusterLabel(fCluster)}`} onClear={() => setParam('segmento', '')} />}
					{fCanal && <Chip label={`Canal: ${canalCodigo[fCanal] ?? fCanal}`} onClear={() => setParam('canal', '')} />}
					<button onClick={() => { setParam('carteira', ''); setParam('segmento', ''); setParam('canal', ''); }} className="text-xs font-semibold text-[#0F4C5C] hover:underline">Limpar filtros</button>
				</>}
			</div>

			{/* linha de totais */}
			<div className="flex flex-wrap gap-x-8 gap-y-2 border-t border-[#eef2f3] pt-3 text-sm">
				<span className="text-slate-500">Base ativa: <strong className="text-[#0F4C5C]">{numberBR(activeBase)}</strong></span>
				<span className="text-slate-500">Saldo ativo: <strong className="text-[#0F4C5C]">{moneyBR(activeBaseSaldo)}</strong></span>
				<span className="text-slate-500">Com ação hoje: <strong className="text-[#0F4C5C]">{numberBR(totalAcaoHoje)}</strong></span>
				{run && <span className="text-slate-500">Rotina: <strong className="text-[#0F4C5C]">{run.data_ref ?? '—'}</strong></span>}
			</div>
		</div>

		<PorQueHoje />

		{/* cartões na ordem da jornada */}
		<div className="mt-6 space-y-6">
			<Banda label="Massivas" estados={MASSIVAS} porEstado={porEstado} medir={medir} medirFmt={medirFmt} medida={medida} pctDe={pctDe} entraram={entraram} sairam={sairam} sel={sel} onSelect={(id) => setParam('sel', id === sel ? '' : id)} />
			<Banda label="Acordo" estados={ACORDO} porEstado={porEstado} medir={medir} medirFmt={medirFmt} medida={medida} pctDe={pctDe} entraram={entraram} sairam={sairam} sel={sel} onSelect={(id) => setParam('sel', id === sel ? '' : id)} />

			{/* Bloqueado — cartão cinza à parte */}
			<div>
				<div className="mb-2 flex items-center gap-2">
					<h2 className="text-xs font-bold uppercase tracking-wider text-slate-400">Bloqueado</h2>
					<span className="text-xs text-slate-400">opt-out / óbito</span>
				</div>
				<div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
					<PhaseCard estado="BLQ" bloqueado porEstado={porEstado} medir={medir} medirFmt={medirFmt} medida={medida} pctDe={pctDe} entraram={entraram} sairam={sairam} sel={sel} onSelect={(id) => setParam('sel', id === sel ? '' : id)} />
				</div>
			</div>
		</div>

		{/* movimento entre fases */}
		{movimentos.length > 0 && <section className="mt-6 rounded-xl border border-[#dfe8ea] bg-white p-5">
			<div className="mb-4 flex flex-wrap items-center justify-between gap-2">
				<h3 className="text-sm font-semibold text-[#163943]">Movimento entre fases · últimos {mov} dias</h3>
				<div className="flex items-center gap-4 text-[11px]">
					<span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-[#2E7D32]" /> avanço</span>
					<span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-[#C62828]" /> recuo</span>
				</div>
			</div>
			<p className="mb-4 text-xs text-slate-500">Os maiores fluxos do período, do maior para o menor.</p>
			<div className="space-y-2.5">
				{movimentos.map(m => (
					<div key={`${m.de || 'entrada'}-${m.para}`} className="grid grid-cols-[1fr_auto] items-center gap-3">
						<div className="min-w-0">
							<div className="flex flex-wrap items-center gap-1.5 text-xs">
								<span className="font-medium text-slate-700">{m.de ? rotuloEstado[m.de] ?? m.de : 'Entrada'}</span>
								<ArrowRight size={12} className="shrink-0 text-slate-400" />
								<span className="font-medium text-slate-700">{rotuloEstado[m.para] ?? m.para}</span>
							</div>
							<div className="mt-1 h-2.5 overflow-hidden rounded-full bg-[#eef2f3]">
								<div className={`h-full rounded-full ${m.tipo === 'advance' ? 'bg-[#2E7D32]' : 'bg-[#C62828]'}`} style={{ width: `${(m.v / maxFluxo) * 100}%` }} />
							</div>
						</div>
						<span className={`text-sm font-bold tnum ${m.tipo === 'advance' ? 'text-[#2E7D32]' : 'text-[#C62828]'}`}>{numberBR(m.v)}</span>
					</div>
				))}
			</div>
		</section>}

		{/* detalhe da fase selecionada */}
		{sel && <div className="mt-6 grid gap-4 lg:grid-cols-2">
			<PanelCard title={`Por passo · ${rotuloEstado[sel] ?? sel}`}>
				{porPasso.length ? <Bars data={porPasso} fmt={rotuloPasso} /> : <p className="text-xs text-slate-400">Sem detalhe de passo.</p>}
				{sel === 'NCP' && porPasso.some(([k]) => k === 'RE') && (() => {
					const re = porPasso.find(([k]) => k === 'RE')?.[1] ?? 0;
					return <p className="mt-3 rounded-lg bg-[#fff7e8] px-3 py-2 text-xs text-[#80520f]">{rotuloCiclo('', 'RE')}: {numberBR(re)} clientes parados esperando o bureau voltarem ao giro.</p>;
				})()}
			</PanelCard>
			{['CPA', 'CPB', 'PRE', 'QBR', 'COL'].includes(sel) && <PanelCard title="Canal da vez">
				{porCanal.length ? <Bars data={porCanal.map(([k, v]) => [canalCodigo[k] ?? k, v] as [string, number])} /> : <p className="text-xs text-slate-400">Sem canal definido.</p>}
			</PanelCard>}
			<PanelCard title="Por segmento">
				{porCluster.length ? <Bars data={porCluster.map(([k, v]) => [k === 'PADRAO' ? 'Padrão' : clusterLabel(k), v] as [string, number])} /> : <p className="text-xs text-slate-400">Sem segmentos nesta fase.</p>}
			</PanelCard>
			<PanelCard title="Movimento">
				{selMov.veio.length === 0 && selMov.foi.length === 0 ? <p className="text-xs text-slate-400">Sem movimento no período.</p> : <div className="space-y-3 text-xs">
					{selMov.veio.length > 0 && <div><p className="mb-1 font-semibold text-slate-500">Vieram de:</p><div className="flex flex-wrap gap-1.5">{selMov.veio.map(([k, v]) => <span key={k} className="rounded-full bg-[#eaf2f3] px-2.5 py-1 text-[#0F4C5C]">{rotuloEstado[k] ?? k}: {numberBR(v)}</span>)}</div></div>}
					{selMov.foi.length > 0 && <div><p className="mb-1 font-semibold text-slate-500">Foram para:</p><div className="flex flex-wrap gap-1.5">{selMov.foi.map(([k, v]) => <span key={k} className="rounded-full bg-[#eaf2f3] px-2.5 py-1 text-[#0F4C5C]">{rotuloEstado[k] ?? k}: {numberBR(v)}</span>)}</div></div>}
				</div>}
			</PanelCard>
		</div>}
	</>;
}

function Banda({ label, estados, porEstado, medir, medirFmt, medida, pctDe, entraram, sairam, sel, onSelect }: {
	label: string;
	estados: string[];
	porEstado: Record<string, { clientes: number; saldo: number }>;
	medir: (e: string) => number;
	medirFmt: (v: number) => string;
	medida: string;
	pctDe: (e: string) => number;
	entraram: Record<string, number>;
	sairam: Record<string, number>;
	sel: string;
	onSelect: (id: string) => void;
}) {
	return (
		<div>
			<div className="mb-2 flex items-center gap-2">
				<h2 className="text-xs font-bold uppercase tracking-wider text-slate-400">{label}</h2>
			</div>
			<div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
				{estados.map(e => (
					<PhaseCard key={e} estado={e} porEstado={porEstado} medir={medir} medirFmt={medirFmt} medida={medida} pctDe={pctDe} entraram={entraram} sairam={sairam} sel={sel} onSelect={onSelect} />
				))}
			</div>
		</div>
	);
}

function PhaseCard({ estado, porEstado, medir, medirFmt, medida, pctDe, entraram, sairam, sel, onSelect, bloqueado }: {
	estado: string;
	porEstado: Record<string, { clientes: number; saldo: number }>;
	medir: (e: string) => number;
	medirFmt: (v: number) => string;
	medida: string;
	pctDe: (e: string) => number;
	entraram: Record<string, number>;
	sairam: Record<string, number>;
	sel: string;
	onSelect: (id: string) => void;
	bloqueado?: boolean;
}) {
	const valor = medir(estado);
	const other = medida === 'saldo' ? (porEstado[estado]?.clientes ?? 0) : (porEstado[estado]?.saldo ?? 0);
	const pct = pctDe(estado);
	const ent = entraram[estado] ?? 0;
	const sai = sairam[estado] ?? 0;
	const selected = sel === estado;
	return (
		<button type="button" onClick={() => onSelect(estado)}
			className={`group flex flex-col rounded-xl border p-4 text-left transition ${bloqueado ? 'border-[#e5edef] bg-[#f5f5f7]' : 'border-[#dfe8ea] bg-white hover:border-[#0F4C5C]'} ${selected ? 'ring-2 ring-[#e9a23b]' : ''}`}>
			<h3 className={`text-sm font-semibold ${bloqueado ? 'text-slate-500' : 'text-[#0F4C5C]'}`}>{rotuloEstado[estado] ?? estado}</h3>
			<p className="mt-2 text-2xl font-bold tnum text-[#163943]">{medirFmt(valor)}</p>
			<p className="text-xs text-slate-500">{medida === 'saldo' ? `${numberBR(other)} clientes` : moneyBR(other)}</p>
			<div className="mt-3 h-1.5 overflow-hidden rounded-full bg-[#eef2f3]">
				<div className={`h-full rounded-full ${bloqueado ? 'bg-[#AEAEB2]' : 'bg-[#0F4C5C]'}`} style={{ width: `${Math.min(pct, 100)}%` }} />
			</div>
			<p className="mt-1.5 text-[11px] text-slate-400">{pct}% da base</p>
			<div className="mt-3 flex items-center gap-3 text-[11px]">
				<span className="inline-flex items-center gap-1 text-[#2E7D32]"><ArrowUpRight size={12} /> {numberBR(ent)} entraram</span>
				<span className="inline-flex items-center gap-1 text-[#C62828]"><ArrowDownRight size={12} /> {numberBR(sai)} saíram</span>
			</div>
		</button>
	);
}

function Chip({ label, onClear }: { label: string; onClear: () => void }) {
	return <span className="inline-flex items-center gap-1 rounded-full bg-[#eaf2f3] px-2.5 py-1 text-xs font-medium text-[#0F4C5C]">{label}<button onClick={onClear} aria-label="Remover filtro"><X size={12} className="hover:text-[#C62828]" /></button></span>;
}

function PanelCard({ title, children }: { title: string; children: React.ReactNode }) {
	return <section className="rounded-xl border border-[#dfe8ea] bg-white p-5"><h3 className="mb-4 text-sm font-semibold text-[#163943]">{title}</h3>{children}</section>;
}

function Bars({ data, fmt }: { data: [string, number][]; fmt?: (k: string) => string }) {
	const max = Math.max(...data.map(([, v]) => v), 1);
	return <div className="space-y-2">{data.map(([k, v]) => (
		<div key={k} className="grid grid-cols-[96px_1fr_52px] items-center gap-2 text-xs sm:grid-cols-[120px_1fr_60px]">
			<span className="truncate text-slate-600" title={k}>{fmt ? fmt(k) : k}</span>
			<div className="h-2.5 overflow-hidden rounded-full bg-[#eef2f3]"><div className="h-full rounded-full bg-[#0F4C5C]" style={{ width: `${(v / max) * 100}%` }} /></div>
			<span className="text-right font-semibold">{numberBR(v)}</span>
		</div>
	))}</div>;
}
