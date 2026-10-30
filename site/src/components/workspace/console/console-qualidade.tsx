import { useEffect, useMemo, useState } from 'react';
import { supabase, friendlyError, type Row } from '@/lib/supabase';
import { ConsoleShell, cardShadow } from './console-shell';
import { useConsolePerms } from './console-perms';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts';
import { ChevronDown, Settings2, X } from 'lucide-react';

const CANAIS = [{ id: 'sms', nome: 'SMS' }, { id: 'rcs', nome: 'RCS' }];
const MENSAGEM_COR = '#7A2E3B';
const CORES_LINHAS = ['#7A2E3B', '#0A60D0', '#34C759', '#FF9500', '#5856D6', '#30B0C7', '#A2552B', '#1F8A4C'];

const CAMPOS_CONFIG = [
	{ key: 'minutos_sem_dlr', label: 'Minutos sem DLR', suffix: 'min' },
	{ key: 'pct_sem_dlr', label: '% sem DLR (limite)', suffix: '%' },
	{ key: 'dlr_p90_segundos', label: 'DLR p90 (limite)', suffix: 's' },
	{ key: 'janela_minutos', label: 'Janela de análise', suffix: 'min' },
];

function pad2(n: number) { return String(n).padStart(2, '0'); }
function toLocalInput(d: Date) { return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`; }
function defaultDe() { return toLocalInput(new Date(Date.now() - 24 * 3600 * 1000)); }
function defaultAte() { return toLocalInput(new Date()); }
function toISO(s: string) { try { return new Date(s).toISOString(); } catch { return s; } }

function num(r: Row | undefined, k: string): number { if (!r) return 0; const v = r[k]; return typeof v === 'number' ? v : Number(v ?? 0); }
function str(r: Row | undefined, k: string): string { if (!r) return ''; const v = r[k]; return v == null ? '' : String(v); }
function numBR(v: unknown) { return Number(v ?? 0).toLocaleString('pt-BR'); }
function pctBR(v: unknown) { return `${Number(v ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`; }
function secBR(v: unknown) { const n = Number(v ?? 0); if (!n) return '—'; return `${n.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} s`; }
function median(nums: number[]) { if (!nums.length) return 0; const s = [...nums].sort((a, b) => a - b); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; }
function maskDestino(d: string) { if (!d) return '—'; if (d.includes('•') || d.includes('*')) return d; return d.length > 4 ? `${d.slice(0, 2)}••••${d.slice(-2)}` : d; }
function dtSeg(v: unknown) { if (!v) return '—'; try { return new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(new Date(String(v))); } catch { return String(v); } }

export function ConsoleQualidadePage() {
	const { can } = useConsolePerms();
	const podeVer = can('ver_qualidade');
	const podeDetalhe = can('ver_detalhe_tecnico');
	const podeLimites = can('configurar_score');

	const [canal, setCanal] = useState('sms');
	const [de, setDe] = useState(defaultDe());
	const [ate, setAte] = useState(defaultAte());
	const [fornecedorSel, setFornecedorSel] = useState('');

	const [fornecedores, setFornecedores] = useState<Row[]>([]);
	const [alertas, setAlertas] = useState<Row[]>([]);
	const [tabela, setTabela] = useState<Row[]>([]);
	const [porHora, setPorHora] = useState<Row[]>([]);
	const [config, setConfig] = useState<Row | null>(null);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState('');
	const [limitesOpen, setLimitesOpen] = useState(false);

	async function reload() {
		if (!supabase) return;
		setLoading(true); setError('');
		const deIso = toISO(de), ateIso = toISO(ate);
		const [fr, al, tb, ph, cfg] = await Promise.all([
			supabase.from('mensageria_fornecedores').select('id,nome,codigo,canais,ativo').order('nome'),
			supabase.rpc('alertas_qualidade', { canal }),
			supabase.rpc('qualidade_fornecedores', { de: deIso, ate: ateIso, canal }),
			supabase.rpc('qualidade_por_hora', { de: deIso, ate: ateIso, canal }),
			supabase.from('mensageria_alertas_config').select('*'),
		]);
		setFornecedores((fr.data ?? []) as Row[]);
		setAlertas((al.data ?? []) as Row[]);
		setTabela((tb.data ?? []) as Row[]);
		setPorHora((ph.data ?? []) as Row[]);
		const cfgRows = (cfg.data ?? []) as Row[];
		setConfig(cfgRows.find(r => String(r.canal) === canal) ?? cfgRows[0] ?? null);
		const err = tb.error || ph.error || al.error;
		if (err) setError(friendlyError(err));
		setLoading(false);
	}

	useEffect(() => { void reload(); /* eslint-disable-next-line */ }, [canal]);

	const chart = useMemo(() => {
		if (!porHora.length) return { data: [] as Record<string, number | string>[], fornecedores: [] as string[] };
		const longFormat = 'fornecedor' in porHora[0];
		if (!longFormat) return { data: porHora as Record<string, number | string>[], fornecedores: [] as string[] };
		const map: Record<string, Record<string, number | string>> = {};
		const fornSet = new Set<string>();
		for (const r of porHora) {
			const hora = String(r.hora ?? '');
			const forn = String(r.fornecedor ?? '');
			const val = Number(r.dlr_med ?? r.tempo_dlr ?? r.valor ?? 0);
			fornSet.add(forn);
			if (!map[hora]) map[hora] = { hora };
			map[hora][forn] = val;
		}
		const data = Object.values(map).sort((a, b) => String(a.hora).localeCompare(String(b.hora)));
		return { data, fornecedores: [...fornSet] };
	}, [porHora]);

	if (!podeVer) {
		return <ConsoleShell><div className="rounded-2xl bg-[#F5F5F7] px-6 py-12 text-center text-[14px] text-[#6E6E73]">Sua função não tem acesso à Qualidade dos fornecedores.</div></ConsoleShell>;
	}

	const fornecedoresCanal = fornecedores.filter(f => { const c = f.canais; return Array.isArray(c) ? c.includes(canal) : true; });
	const tabelaFiltrada = fornecedorSel ? tabela.filter(r => String(r.fornecedor) === fornecedorSel || String(r.fornecedor_id) === fornecedorSel) : tabela;

	const disparados = tabelaFiltrada.reduce((s, r) => s + num(r, 'disparados'), 0);
	const aceiteMed = median(tabelaFiltrada.map(r => num(r, 'aceite_med')));
	const dlrMed = median(tabelaFiltrada.map(r => num(r, 'dlr_med')));
	const semDlrCount = tabelaFiltrada.reduce((s, r) => s + Math.round(num(r, 'disparados') * num(r, 'sem_dlr_pct') / 100), 0);
	const nMin = config ? Number(config.minutos_sem_dlr ?? 0) : 0;
	const limiteGraf = config ? Number(config.dlr_p90_segundos ?? 0) : 0;

	return (
		<ConsoleShell>
			{error && <div className="mb-4 rounded-xl bg-[#FFE8E6] px-4 py-3 text-[14px] text-[#FF3B30]">{error}</div>}

			<div className="mb-5">
				<p className="text-[14px] text-[#6E6E73]">No SMS, o % entregue reflete a qualidade da lista. Aqui o fornecedor é medido pela velocidade e pela DLR.</p>
			</div>

			{/* Filtros */}
			<div className="mb-5 rounded-2xl bg-white p-4 sm:p-5" style={{ boxShadow: cardShadow }}>
				<div className="flex flex-wrap items-end gap-3">
					<label className="block">
						<span className="mb-1 block text-[12px] font-semibold text-[#6E6E73]">Canal</span>
						<div className="flex rounded-[10px] bg-[#F5F5F7] p-1">
							{CANAIS.map(c => <button key={c.id} onClick={() => setCanal(c.id)} className={`rounded-[8px] px-3 py-1.5 text-[13px] font-medium transition-colors ${canal === c.id ? 'bg-white text-[#1D1D1F] font-semibold shadow-[0_1px_3px_rgba(0,0,0,0.12)]' : 'text-[#1D1D1F] hover:bg-[#E8E8ED]'}`}>{c.nome}</button>)}
						</div>
					</label>
					<label className="block">
						<span className="mb-1 block text-[12px] font-semibold text-[#6E6E73]">De</span>
						<input type="datetime-local" value={de} onChange={e => setDe(e.target.value)} className="h-10 rounded-lg border border-[#D2D2D7] px-3 text-[14px] outline-none focus:border-[#1D1D1F]" />
					</label>
					<label className="block">
						<span className="mb-1 block text-[12px] font-semibold text-[#6E6E73]">Até</span>
						<input type="datetime-local" value={ate} onChange={e => setAte(e.target.value)} className="h-10 rounded-lg border border-[#D2D2D7] px-3 text-[14px] outline-none focus:border-[#1D1D1F]" />
					</label>
					<label className="block">
						<span className="mb-1 block text-[12px] font-semibold text-[#6E6E73]">Fornecedor</span>
						<select value={fornecedorSel} onChange={e => setFornecedorSel(e.target.value)} className="h-10 rounded-lg border border-[#D2D2D7] bg-white px-3 text-[14px] outline-none focus:border-[#1D1D1F]">
							<option value="">Todos</option>
							{fornecedoresCanal.map(f => <option key={f.id} value={String(f.nome)}>{String(f.nome)}</option>)}
						</select>
					</label>
					<button onClick={() => void reload()} className="h-10 rounded-full px-5 text-[14px] font-semibold text-white hover:opacity-90" style={{ backgroundColor: MENSAGEM_COR }}>Atualizar</button>
					{podeLimites && <button onClick={() => setLimitesOpen(true)} className="flex h-10 items-center gap-1.5 rounded-full border border-[#D2D2D7] px-4 text-[13px] font-medium text-[#1D1D1F] hover:bg-[#F5F5F7]"><Settings2 size={15} /> Limites</button>}
				</div>
			</div>

			{/* Cartões */}
			<div className="mb-5 grid grid-cols-2 gap-4 lg:grid-cols-4">
				<CardKpi titulo="Disparados" valor={numBR(disparados)} />
				<CardKpi titulo="Aceite pelo fornecedor (mediana)" valor={secBR(aceiteMed)} />
				<CardKpi titulo="Tempo até a DLR (mediana)" valor={secBR(dlrMed)} />
				<CardKpi titulo={`Sem DLR após ${nMin || '—'} min`} valor={numBR(semDlrCount)} />
			</div>

			{/* Alertas */}
			{alertas.length > 0 && (
				<section className="mb-5 rounded-2xl bg-white p-5 sm:p-6" style={{ boxShadow: cardShadow }}>
					<h2 className="mb-3 text-[16px] font-semibold text-[#1D1D1F]">Alertas abertos</h2>
					<div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
						{alertas.map((a, i) => {
							const nivel = String(a.nivel ?? 'atencao');
							const critico = nivel === 'critico';
							return (
								<div key={i} className="rounded-xl border p-4" style={{ borderColor: critico ? '#FF3B30' : '#FF9500', backgroundColor: critico ? '#FFE8E6' : '#FFF7E8' }}>
									<div className="mb-1 flex items-center gap-2">
										<span className="rounded-full px-2 py-0.5 text-[11px] font-semibold text-white" style={{ backgroundColor: critico ? '#FF3B30' : '#FF9500' }}>{critico ? 'Crítico' : 'Atenção'}</span>
										<span className="text-[13px] font-semibold text-[#1D1D1F]">{str(a, 'fornecedor') || '—'}</span>
									</div>
									{str(a, 'operadora') && <p className="text-[12px] text-[#6E6E73]">Operadora: {str(a, 'operadora')}</p>}
									<p className="mt-1 text-[13px] text-[#1D1D1F]">{str(a, 'motivo')}</p>
								</div>
							);
						})}
					</div>
				</section>
			)}

			{/* Tabela */}
			<section className="mb-5 rounded-2xl bg-white p-5 sm:p-6" style={{ boxShadow: cardShadow }}>
				<h2 className="mb-3 text-[16px] font-semibold text-[#1D1D1F]">Fornecedor × operadora</h2>
				{loading ? <p className="py-6 text-center text-[14px] text-[#8E8E93]">Carregando...</p> :
					tabelaFiltrada.length === 0 ? <p className="rounded-xl bg-[#F5F5F7] px-4 py-8 text-center text-[14px] text-[#8E8E93]">Sem dados no período.</p> :
					<div className="overflow-x-auto">
						<table className="w-full min-w-[820px] text-left text-sm">
							<thead><tr className="border-b border-[#F0F0F2] text-[12px] text-[#8E8E93]">
								<th className="pb-3 font-medium">Fornecedor</th>
								<th className="pb-3 font-medium">Operadora</th>
								<th className="pb-3 text-right font-medium">Disparados</th>
								<th className="pb-3 text-right font-medium">Aceite (med · p90)</th>
								<th className="pb-3 text-right font-medium">DLR (med · p90)</th>
								<th className="pb-3 text-right font-medium">Sem DLR %</th>
								<th className="pb-3 text-right font-medium">Entregue no lote %</th>
								<th className="pb-3 font-medium">Situação</th>
							</tr></thead>
							<tbody className="divide-y divide-[#F0F0F2]">
								{tabelaFiltrada.map((r, i) => {
									const sit = String(r.situacao ?? '').toLowerCase();
									const sitCor = sit === 'critico' ? '#FF3B30' : sit === 'atencao' ? '#9a631b' : '#248A3D';
									const sitLabel = sit === 'critico' ? 'Crítico' : sit === 'atencao' ? 'Atenção' : sit ? (sit.charAt(0).toUpperCase() + sit.slice(1)) : 'Normal';
									return (
										<tr key={i} className="align-top">
											<td className="py-3 font-medium text-[#1D1D1F]">{str(r, 'fornecedor') || '—'}</td>
											<td className="py-3 text-[#6E6E73]">{str(r, 'operadora') || '—'}</td>
											<td className="py-3 text-right tnum text-[#1D1D1F]">{numBR(num(r, 'disparados'))}</td>
											<td className="py-3 text-right tnum text-[#1D1D1F]">{secBR(num(r, 'aceite_med'))} · {secBR(num(r, 'aceite_p90'))}</td>
											<td className="py-3 text-right tnum text-[#1D1D1F]">{secBR(num(r, 'dlr_med'))} · {secBR(num(r, 'dlr_p90'))}</td>
											<td className="py-3 text-right tnum text-[#1D1D1F]">{pctBR(num(r, 'sem_dlr_pct'))}</td>
											<td className="py-3 text-right tnum text-[#1D1D1F]">{pctBR(num(r, 'entregue_lote_pct'))}</td>
											<td className="py-3"><span className="rounded-full px-2 py-0.5 text-[11px] font-semibold" style={{ backgroundColor: sitCor + '22', color: sitCor }}>{sitLabel}</span></td>
										</tr>
									);
								})}
							</tbody>
						</table>
					</div>}
				<p className="mt-3 text-[12px] text-[#8E8E93]">Dentro do mesmo lote a rota sorteia o tráfego: a coluna Entregue no lote compara fornecedores com a mesma qualidade de lista.</p>
			</section>

			{/* Gráfico */}
			<section className="mb-5 rounded-2xl bg-white p-5 sm:p-6" style={{ boxShadow: cardShadow }}>
				<h2 className="mb-3 text-[16px] font-semibold text-[#1D1D1F]">Tempo até a DLR, por hora</h2>
				{loading ? <p className="py-6 text-center text-[14px] text-[#8E8E93]">Carregando...</p> :
					chart.data.length === 0 ? <p className="rounded-xl bg-[#F5F5F7] px-4 py-8 text-center text-[14px] text-[#8E8E93]">Sem dados no período.</p> :
					<div className="h-[300px] w-full">
						<ResponsiveContainer width="100%" height="100%">
							<LineChart data={chart.data} margin={{ top: 5, right: 10, left: -10, bottom: 0 }}>
								<CartesianGrid strokeDasharray="3 3" stroke="#E5E5EA" />
								<XAxis dataKey="hora" tick={{ fontSize: 11, fill: '#8E8E93' }} stroke="#E5E5EA" />
								<YAxis tick={{ fontSize: 11, fill: '#8E8E93' }} stroke="#E5E5EA" />
								<Tooltip contentStyle={{ fontSize: 12, borderRadius: 12, border: '1px solid #E5E5EA' }} />
								{limiteGraf > 0 && <ReferenceLine y={limiteGraf} stroke="#FF9500" strokeDasharray="6 4" label={{ value: 'Limite', fontSize: 10, fill: '#9a631b' }} />}
								{chart.fornecedores.length > 0
									? chart.fornecedores.map((f, i) => <Line key={f} type="monotone" dataKey={f} stroke={CORES_LINHAS[i % CORES_LINHAS.length]} strokeWidth={2} dot={false} />)
									: <Line type="monotone" dataKey="dlr_med" stroke={MENSAGEM_COR} strokeWidth={2} dot={false} />}
							</LineChart>
						</ResponsiveContainer>
					</div>}
			</section>

			{/* Detalhe técnico */}
			<DetalheTecnico de={de} ate={ate} fornecedor={fornecedorSel} podeVer={podeDetalhe} />

			{limitesOpen && <LimitesModal canal={canal} config={config} onClose={() => setLimitesOpen(false)} onSaved={() => { setLimitesOpen(false); void reload(); }} />}
		</ConsoleShell>
	);
}

function CardKpi({ titulo, valor }: { titulo: string; valor: string }) {
	return <div className="rounded-2xl bg-[#F5F5F7] p-5"><p className="text-[13px] text-[#6E6E73]">{titulo}</p><p className="mt-1 text-[22px] font-bold tracking-tight tnum" style={{ color: 'var(--base-texto)' }}>{valor}</p></div>;
}

function DetalheTecnico({ de, ate, fornecedor, podeVer }: { de: string; ate: string; fornecedor: string; podeVer: boolean }) {
	const [open, setOpen] = useState(false);
	const [rows, setRows] = useState<Row[]>([]);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState('');

	async function load() {
		if (!supabase) return;
		setLoading(true); setError('');
		const { data, error: e } = await supabase.rpc('detalhe_tecnico_envios', { de: toISO(de), ate: toISO(ate), fornecedor: fornecedor || null, limite: 200 });
		setLoading(false);
		if (e) { setError(friendlyError(e)); return; }
		setRows((data ?? []) as Row[]);
	}
	useEffect(() => { if (open && podeVer) void load(); /* eslint-disable-next-line */ }, [open, de, ate, fornecedor, podeVer]);

	if (!podeVer) return null;
	return (
		<section className="rounded-2xl bg-white" style={{ boxShadow: cardShadow }}>
			<button onClick={() => setOpen(o => !o)} className="flex w-full items-center gap-2 px-5 py-4 text-left">
				<ChevronDown size={16} className={`text-[#8E8E93] transition-transform ${open ? '' : '-rotate-90'}`} />
				<span className="text-[15px] font-semibold text-[#1D1D1F]">Detalhe técnico</span>
			</button>
			{open && (
				<div className="border-t border-[#F0F0F2] px-5 pb-5">
					{error ? <p className="py-3 text-[14px] text-[#FF3B30]">{error}</p> :
						loading ? <p className="py-6 text-center text-[14px] text-[#8E8E93]">Carregando...</p> :
						rows.length === 0 ? <p className="py-6 text-center text-[14px] text-[#8E8E93]">Sem envios no período.</p> :
						<div className="mt-3 overflow-x-auto">
							<table className="w-full min-w-[960px] text-left text-[12px]">
								<thead><tr className="border-b border-[#F0F0F2] text-[#8E8E93]">
									<th className="pb-2 font-medium">Envio</th>
									<th className="pb-2 font-medium">Destino</th>
									<th className="pb-2 font-medium">Fornecedor</th>
									<th className="pb-2 font-medium">Operadora</th>
									<th className="pb-2 font-medium">Código original</th>
									<th className="pb-2 font-medium">Enviado</th>
									<th className="pb-2 font-medium">Confirmado</th>
									<th className="pb-2 font-medium">DLR</th>
									<th className="pb-2 font-medium">Fallback</th>
									<th className="pb-2 font-medium">Faixa do Score</th>
									<th className="pb-2 font-medium">Controle</th>
								</tr></thead>
								<tbody className="divide-y divide-[#F0F0F2]">
									{rows.map((r, i) => (
										<tr key={i} className="align-top">
											<td className="py-2 font-mono text-[#1D1D1F]">#{str(r, 'id')}</td>
											<td className="py-2 text-[#1D1D1F]">{maskDestino(str(r, 'destino'))}</td>
											<td className="py-2 text-[#6E6E73]">{str(r, 'fornecedor')}</td>
											<td className="py-2 text-[#6E6E73]">{str(r, 'operadora')}</td>
											<td className="py-2 font-mono text-[#1D1D1F]">{str(r, 'dlr_codigo')}</td>
											<td className="py-2 text-[#6E6E73]">{dtSeg(r.enviado)}</td>
											<td className="py-2 text-[#6E6E73]">{dtSeg(r.confirmado)}</td>
											<td className="py-2 text-[#6E6E73]">{dtSeg(r.dlr)}</td>
											<td className="py-2 text-[#6E6E73]">{str(r, 'fallback') || '—'}</td>
											<td className="py-2 text-[#6E6E73]">{str(r, 'faixa_score') || '—'}</td>
											<td className="py-2 text-[#6E6E73]">{str(r, 'controle') || '—'}</td>
										</tr>
									))}
								</tbody>
							</table>
						</div>}
				</div>
			)}
		</section>
	);
}

function LimitesModal({ canal, config, onClose, onSaved }: { canal: string; config: Row | null; onClose: () => void; onSaved: () => void }) {
	const [vals, setVals] = useState<Record<string, string>>({});
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState('');

	useEffect(() => {
		const v: Record<string, string> = {};
		for (const c of CAMPOS_CONFIG) v[c.key] = config ? String(config[c.key] ?? '') : '';
		setVals(v);
	}, [config]);

	useEffect(() => { const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose(); window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h); }, [onClose]);

	async function salvar() {
		if (!supabase || !config) { setError('Configuração não encontrada.'); return; }
		setBusy(true); setError('');
		const update: Record<string, number> = {};
		for (const c of CAMPOS_CONFIG) { const n = Number((vals[c.key] ?? '').replace(',', '.')); update[c.key] = isNaN(n) ? 0 : n; }
		const { error: e } = await supabase.from('mensageria_alertas_config').update(update).eq('id', String(config.id));
		setBusy(false);
		if (e) { setError(friendlyError(e)); return; }
		onSaved();
	}

	return (
		<div className="fixed inset-0 z-[100] grid place-items-center bg-black/40 px-4 py-8 overflow-y-auto" onClick={onClose}>
			<div role="dialog" aria-modal="true" className="my-auto w-full max-w-[480px] rounded-2xl bg-white p-6" style={{ boxShadow: '0 0 0 1px #E5E5EA, 0 24px 60px -20px rgba(0,0,0,.4)' }} onClick={e => e.stopPropagation()}>
				<div className="mb-5 flex items-center justify-between"><h2 className="text-[18px] font-semibold text-[#1D1D1F]">Limites de alerta</h2><button onClick={onClose} aria-label="Fechar" className="text-[#8E8E93]"><X size={20} /></button></div>
				{!config ? <p className="py-6 text-center text-[14px] text-[#8E8E93]">Configuração não encontrada para {canal.toUpperCase()}.</p> : (
					<div className="space-y-4">
						{CAMPOS_CONFIG.map(c => (
							<label key={c.key} className="block">
								<span className="mb-1 block text-[13px] font-semibold text-[#1D1D1F]">{c.label}</span>
								<div className="flex items-center gap-2">
									<input value={vals[c.key] ?? ''} onChange={e => setVals(v => ({ ...v, [c.key]: e.target.value }))} inputMode="decimal" className="h-10 w-full rounded-lg border border-[#D2D2D7] px-3 text-[15px] tnum outline-none focus:border-[#1D1D1F]" />
									<span className="text-[13px] text-[#8E8E93]">{c.suffix}</span>
								</div>
							</label>
						))}
						{error && <p role="alert" className="text-[14px] text-[#FF3B30]">{error}</p>}
						<div className="flex justify-end gap-3"><button onClick={onClose} className="h-10 rounded-lg border border-[#D2D2D7] px-5 text-[14px] font-medium text-[#1D1D1F] hover:bg-[#F5F5F7]">Cancelar</button><button onClick={salvar} disabled={busy} className="h-10 rounded-lg px-6 text-[14px] font-semibold text-white hover:opacity-90 disabled:opacity-50" style={{ backgroundColor: MENSAGEM_COR }}>{busy ? 'Salvando...' : 'Salvar'}</button></div>
					</div>
				)}
			</div>
		</div>
	);
}
