import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Download, Mail, Settings2, Save, Info, ChevronUp, ChevronDown, SlidersHorizontal, X } from 'lucide-react';
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { supabase, friendlyError, type Row } from '@/lib/supabase';
import { useMotorAuth } from '@/components/auth-provider';
import {
	PERIODO_REL, periodoDatas, periodoAnterior, montarFiltros, formatValor, metricaRotulo, variacao,
	type RelatorioBase, type RelatorioCampo, type ModeloRelatorio, type Metrica,
} from '@/lib/relatorios';
import { ExportarPainel } from '@/components/relatorios/exportar-painel';
import { EnvioEmail } from '@/components/relatorios/envio-email';
import { MontarRelatorio } from '@/components/relatorios/montar-relatorio';

type Props = {
	modelo: ModeloRelatorio;
	bases: RelatorioBase[];
	camposByBase: Record<string, RelatorioCampo[]>;
	onBack: () => void;
	onSaved: () => void;
};

type FiltroAtivo = { campo: string; rotulo: string; valor: string; valorRotulo: string };

export function RelatorioAberto({ modelo, bases, camposByBase, onBack, onSaved }: Props) {
	const { empresa, perfil } = useMotorAuth();
	const [modeloAtual, setModeloAtual] = useState(modelo);
	const base = bases.find(b => b.id === modeloAtual.base);
	const campos = camposByBase[modeloAtual.base] ?? [];
	const fotoDoDia = !!base?.foto_do_dia;

	const [periodo, setPeriodo] = useState('7d');
	const [de, setDe] = useState('');
	const [ate, setAte] = useState('');
	const [comparar, setComparar] = useState(true);
	const [filtrosAtivos, setFiltrosAtivos] = useState<FiltroAtivo[]>([]);
	const [filtroCampo, setFiltroCampo] = useState<string | null>(null);
	const [filtroBusca, setFiltroBusca] = useState('');
	const [filtroValores, setFiltroValores] = useState<Row[]>([]);
	const [carregandoValores, setCarregandoValores] = useState(false);
	const [topo, setTopo] = useState<Row | null>(null);
	const [topoAnt, setTopoAnt] = useState<Row | null>(null);
	const [linhas, setLinhas] = useState<Row[]>([]);
	const [totalLinha, setTotalLinha] = useState<Row | null>(null);
	const [ordem, setOrdem] = useState<string | null>(modelo.ordem);
	const [ordemDir, setOrdemDir] = useState<'asc' | 'desc'>('desc');
	const [busy, setBusy] = useState(false);
	const [erro, setErro] = useState('');
	const [exportarOpen, setExportarOpen] = useState(false);
	const [emailOpen, setEmailOpen] = useState(false);
	const [ajustar, setAjustar] = useState(false);

	const { de: deIso, ate: ateIso } = periodoDatas(periodo, de, ate);
	const { de: deAnt, ate: ateAnt } = periodoAnterior(deIso, ateIso);

	const metricas = (modeloAtual.metricas ?? []) as Metrica[];
	const agrupar = modeloAtual.agrupar ?? [];
	const colunas = modeloAtual.colunas ?? [];

	// Campo de data para o gráfico de linha (data/semana/mes ou tipo data).
	const campoData = useMemo(() => {
		const f = agrupar.find(a => ['data', 'semana', 'mes', 'dia'].includes(a)) ?? campos.find(c => c.tipo === 'data' && agrupar.includes(c.nome))?.nome;
		return f ?? null;
	}, [agrupar, campos]);

	const camposFiltraveis = campos.filter(c => c.filtravel);

	async function carregarValores(campoNome: string) {
		if (!supabase || !empresa) return;
		setFiltroCampo(campoNome);
		setFiltroBusca('');
		setCarregandoValores(true);
		const filtros = montarFiltros(empresa.id, fotoDoDia ? undefined : deIso, fotoDoDia ? undefined : ateIso, filtrosAtivos.filter(f => f.campo !== campoNome).map(f => ({ campo: f.campo, op: 'igual', valor: f.valor })));
		const { data, error } = await supabase.rpc('rodar_relatorio', {
			base: modeloAtual.base, colunas: null, filtros, agrupar: [campoNome],
			metricas: [{ funcao: 'contar', campo: null, nome: 'n' }], ordem: 'n desc', limite: 200,
		});
		setCarregandoValores(false);
		if (error) { setErro(friendlyError(error)); return; }
		setFiltroValores((data as Row[]) ?? []);
	}

	function aplicarFiltro(campoNome: string, valor: string, valorRotulo: string) {
		const c = campos.find(x => x.nome === campoNome);
		setFiltrosAtivos(prev => {
			const sem = prev.filter(f => f.campo !== campoNome);
			return valor ? [...sem, { campo: campoNome, rotulo: c?.rotulo ?? campoNome, valor, valorRotulo }] : sem;
		});
		setFiltroCampo(null);
	}

	async function rodar() {
		if (!supabase || !empresa) return;
		setBusy(true); setErro('');
		const camposFiltro = filtrosAtivos.map(f => ({ campo: f.campo, op: 'igual', valor: f.valor }));
		const filtros = montarFiltros(empresa.id, fotoDoDia ? undefined : deIso, fotoDoDia ? undefined : ateIso, camposFiltro);
		const ordemFinal = ordem ? `${ordem} ${ordemDir}` : null;

		// Topo: sem agrupar, com métricas (1 linha).
		const topoPromise = supabase.rpc('rodar_relatorio', { base: modeloAtual.base, colunas: null, filtros, agrupar: [], metricas, ordem: null, limite: 1 });
		// Linhas: com agrupar + métricas (ou colunas se linha a linha).
		const linhasPromise = agrupar.length
			? supabase.rpc('rodar_relatorio', { base: modeloAtual.base, colunas: null, filtros, agrupar, metricas, ordem: ordemFinal, limite: 1000 })
			: supabase.rpc('rodar_relatorio', { base: modeloAtual.base, colunas, filtros, agrupar: [], metricas: [], ordem: ordemFinal, limite: 1000 });
		// Total: sem agrupar (taxa recalculada).
		const totalPromise = agrupar.length
			? supabase.rpc('rodar_relatorio', { base: modeloAtual.base, colunas: null, filtros, agrupar: [], metricas, ordem: null, limite: 1 })
			: Promise.resolve({ data: null, error: null });

		const [t, l, tot] = await Promise.all([topoPromise, linhasPromise, totalPromise]);
		setBusy(false);
		if (t.error) { setErro(friendlyError(t.error)); return; }
		if (l.error) { setErro(friendlyError(l.error)); return; }
		setTopo(((t.data as Row[]) ?? [])[0] ?? null);
		setLinhas((l.data as Row[]) ?? []);
		setTotalLinha(((tot.data as Row[]) ?? [])[0] ?? null);

		// Comparar: período anterior.
		if (comparar && !fotoDoDia) {
			const filtrosAnt = montarFiltros(empresa.id, deAnt, ateAnt, camposFiltro);
			const { data: ta } = await supabase.rpc('rodar_relatorio', { base: modeloAtual.base, colunas: null, filtros: filtrosAnt, agrupar: [], metricas, ordem: null, limite: 1 });
			setTopoAnt(((ta as Row[]) ?? [])[0] ?? null);
		} else {
			setTopoAnt(null);
		}
	}

	// Roda ao abrir e quando filtros/período mudam (ou após ajustar o modelo).
	useEffect(() => {
		void rodar();
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [empresa?.id, modeloAtual.id, modeloAtual.base, JSON.stringify(modeloAtual.agrupar), JSON.stringify(modeloAtual.metricas), JSON.stringify(modeloAtual.colunas), periodo, de, ate, comparar, JSON.stringify(filtrosAtivos), ordem, ordemDir]);

	const heads = linhas.length ? Object.keys(linhas[0]) : [];
	const rotulo = (c: string) => campos.find(x => x.nome === c)?.rotulo ?? metricas.find(m => m.nome === c)?.rotulo ?? c;

	function ordenarPor(c: string) {
		if (ordem === c) { setOrdemDir(d => d === 'asc' ? 'desc' : 'asc'); }
		else { setOrdem(c); setOrdemDir('desc'); }
	}

	async function salvarComo() {
		if (!supabase || !empresa) return;
		const nome = prompt('Nome do seu relatório:', modeloAtual.nome);
		if (!nome) return;
		const { data, error } = await supabase.from('relatorios_modelos').insert({
			empresa_id: empresa.id, criado_por: perfil?.id, nome, descricao: modeloAtual.descricao, categoria: modeloAtual.categoria,
			base: modeloAtual.base, colunas: modeloAtual.colunas, agrupar: modeloAtual.agrupar, metricas: modeloAtual.metricas, ordem,
		}).select('*').single();
		if (error) { setErro(friendlyError(error)); return; }
		onSaved();
	}

	const ehSalvo = !!modeloAtual.empresa_id;

	// Dados do gráfico.
	const { chartData, stackedSeries } = useMemo(() => {
		if (!linhas.length) return { chartData: [] as Record<string, unknown>[], stackedSeries: [] as string[] };
		const metricaNome = metricas[0]?.nome ?? '';
		// Evolução da carteira: 2 agrupamentos (ex.: mês + situação) → colunas empilhadas.
		if (campoData && agrupar.length >= 2) {
			const serieCampo = agrupar.find(a => a !== campoData) ?? agrupar[1];
			const seriesSet = new Set<string>();
			const map: Record<string, Record<string, number>> = {};
			const xOrder: string[] = [];
			for (const r of linhas) {
				const x = String(r[campoData] ?? '');
				const s = String(r[serieCampo] ?? '');
				seriesSet.add(s);
				if (!map[x]) { map[x] = {}; xOrder.push(x); }
				map[x][s] = Number(r[metricaNome] ?? 0);
			}
			return { chartData: xOrder.map(x => ({ nome: x, ...map[x] })), stackedSeries: [...seriesSet] };
		}
		if (campoData) return { chartData: linhas.map(r => ({ nome: String(r[campoData] ?? ''), valor: Number(r[metricaNome] ?? 0) })), stackedSeries: [] };
		return { chartData: linhas.slice(0, 15).map(r => ({ nome: String(r[agrupar[0] ?? ''] ?? ''), valor: Number(r[metricaNome] ?? 0) })).sort((a, b) => Number(b.valor) - Number(a.valor)), stackedSeries: [] };
	}, [linhas, campoData, metricas, agrupar]);

	return (
		<div className="mx-auto max-w-[1080px] px-4 py-6">
			<button onClick={onBack} className="mb-4 inline-flex items-center gap-1.5 text-[14px] font-medium text-[#0A60D0] hover:underline"><ArrowLeft size={15} /> Voltar</button>
			<div className="mb-5 flex flex-wrap items-start justify-between gap-3">
				<div className="min-w-0">
					<h1 className="text-[22px] font-bold text-[#1D1D1F]">{modeloAtual.nome}</h1>
					{modeloAtual.descricao && <p className="mt-1 text-[14px] text-[#6E6E73]">{modeloAtual.descricao}</p>}
				</div>
				<div className="flex flex-wrap items-center gap-2">
					<button onClick={() => setExportarOpen(true)} className="flex h-9 items-center gap-2 rounded-full border border-[#D2D2D7] px-4 text-[14px] font-medium text-[#1D1D1F] hover:bg-[#F5F5F7]"><Download size={15} /> Exportar</button>
					<button onClick={() => setEmailOpen(true)} className="flex h-9 items-center gap-2 rounded-full border border-[#D2D2D7] px-4 text-[14px] font-medium text-[#1D1D1F] hover:bg-[#F5F5F7]"><Mail size={15} /> Enviar por e-mail</button>
					<button onClick={() => setAjustar(true)} className="flex h-9 items-center gap-2 rounded-full border border-[#D2D2D7] px-4 text-[14px] font-medium text-[#1D1D1F] hover:bg-[#F5F5F7]"><Settings2 size={15} /> Ajustar</button>
					<button onClick={salvarComo} className="flex h-9 items-center gap-2 rounded-full bg-[#1D1D1F] px-5 text-[14px] font-semibold text-white hover:opacity-85"><Save size={15} /> {ehSalvo ? 'Salvar' : 'Salvar como meu relatório'}</button>
				</div>
			</div>

			{erro && <div className="mb-4 rounded-xl bg-[#FFE8E6] px-4 py-3 text-[14px] text-[#FF3B30]">{erro}</div>}

			{/* Filtros */}
			<div className="mb-5 flex flex-wrap items-center gap-3">
				{!fotoDoDia ? (
					<>
						<select value={periodo} onChange={e => setPeriodo(e.target.value)} className="h-9 rounded-lg border border-[#D2D2D7] px-3 text-[14px] outline-none">
							{PERIODO_REL.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
						</select>
						{periodo === 'personalizado' && (<>
							<input type="date" value={de} onChange={e => setDe(e.target.value)} className="h-9 rounded-lg border border-[#D2D2D7] px-3 text-[14px] outline-none" />
							<input type="date" value={ate} onChange={e => setAte(e.target.value)} className="h-9 rounded-lg border border-[#D2D2D7] px-3 text-[14px] outline-none" />
						</>)}
						<label className="flex items-center gap-2 text-[13px] text-[#6E6E73]">
							Comparar com:
							<select value={comparar ? '1' : '0'} onChange={e => setComparar(e.target.value === '1')} className="h-9 rounded-lg border border-[#D2D2D7] px-3 text-[14px] outline-none">
								<option value="1">{`Período anterior`}</option>
								<option value="0">Não comparar</option>
							</select>
						</label>
					</>
				) : <p className="text-[14px] text-[#6E6E73]">Como está hoje.</p>}

				{camposFiltraveis.map(c => {
					const ativo = filtrosAtivos.find(f => f.campo === c.nome);
					return (
						<button key={c.nome} onClick={() => ativo ? aplicarFiltro(c.nome, '', '') : carregarValores(c.nome)} className={`flex h-9 items-center gap-1.5 rounded-full border px-3 text-[13px] font-medium ${ativo ? 'border-[#0A60D0] bg-[#E8F1FF] text-[#0A60D0]' : 'border-[#D2D2D7] text-[#1D1D1F] hover:bg-[#F5F5F7]'}`}>
							<SlidersHorizontal size={13} /> {c.rotulo}{ativo ? `: ${ativo.valorRotulo}` : ''}
						</button>
					);
				})}
			</div>

			{/* Popover de valores do filtro */}
			{filtroCampo && (
				<div className="fixed inset-0 z-[90] bg-black/30" onClick={() => setFiltroCampo(null)}>
					<div className="mx-auto mt-24 w-[90%] max-w-[420px] rounded-2xl bg-white p-4" style={{ boxShadow: '0 24px 60px -20px rgba(0,0,0,.4)' }} onClick={e => e.stopPropagation()}>
						<div className="mb-3 flex items-center justify-between">
							<h3 className="text-[15px] font-semibold text-[#1D1D1F]">{campos.find(c => c.nome === filtroCampo)?.rotulo}</h3>
							<button onClick={() => setFiltroCampo(null)} className="text-[#8E8E93]"><X size={18} /></button>
						</div>
						<div className="relative mb-3">
							<input value={filtroBusca} onChange={e => setFiltroBusca(e.target.value)} placeholder="Buscar" className="h-9 w-full rounded-lg bg-[#F5F5F7] pl-3 pr-3 text-[14px] outline-none" autoFocus />
						</div>
						<div className="max-h-[280px] overflow-y-auto">
							{carregandoValores ? <p className="py-4 text-center text-[13px] text-[#8E8E93]">Carregando…</p> :
								(filtroValores as Row[]).filter(v => String(v[filtroCampo] ?? '').toLowerCase().includes(filtroBusca.toLowerCase())).map(v => {
									const val = String(v[filtroCampo] ?? '');
									return <button key={val} onClick={() => aplicarFiltro(filtroCampo, val, val)} className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-[14px] hover:bg-[#F5F5F7]"><span>{val || '—'}</span><span className="text-[12px] text-[#8E8E93] tnum">{Number(v.n ?? 0).toLocaleString('pt-BR')}</span></button>;
								})}
						</div>
					</div>
				</div>
			)}

			{/* Números do topo */}
			{topo && metricas.length > 0 && (
				<div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
					{metricas.slice(0, 5).map(m => {
						const val = Number(topo[m.nome] ?? 0);
						const ant = topoAnt ? Number(topoAnt[m.nome] ?? 0) : null;
						const ehTaxa = m.funcao === 'taxa';
						const varInfo = ant != null && comparar ? variacao(val, ant, m.sentido, ehTaxa) : null;
						return (
							<div key={m.nome} className="rounded-2xl bg-white p-4" style={{ boxShadow: '0 0 0 1px #E5E5EA, 0 2px 12px rgba(0,0,0,.04)' }}>
								<div className="flex items-center gap-1.5">
									<p className="text-[12px] font-medium text-[#6E6E73]">{metricaRotulo(m)}</p>
									<InfoPopover texto={infoMetrica(m)} />
								</div>
								<p className="mt-1 text-[24px] font-bold tnum text-[#1D1D1F]">{ehTaxa ? formatValor(val, 'taxa') : formatValor(val, 'numero')}</p>
								{varInfo && <p className="mt-0.5 text-[12px] font-medium tnum" style={{ color: varInfo.cor }}>{varInfo.texto} que o período anterior</p>}
							</div>
						);
					})}
				</div>
			)}

			{/* Gráfico */}
			{chartData.length > 0 && (
				<div className="mb-6 rounded-2xl bg-white p-5" style={{ boxShadow: '0 0 0 1px #E5E5EA, 0 2px 12px rgba(0,0,0,.04)' }}>
					<h3 className="mb-4 text-[15px] font-semibold text-[#1D1D1F]">{stackedSeries.length > 0 ? `${metricaRotulo(metricas[0])} por ${campos.find(c => c.nome === campoData)?.rotulo ?? campoData} e ${campos.find(c => c.nome === (agrupar.find(a => a !== campoData) ?? agrupar[1]))?.rotulo ?? ''}` : campoData ? `${metricaRotulo(metricas[0])} por ${campos.find(c => c.nome === campoData)?.rotulo ?? campoData}` : `${metricaRotulo(metricas[0])} por ${campos.find(c => c.nome === agrupar[0])?.rotulo ?? agrupar[0]}`}</h3>
					<ResponsiveContainer width="100%" height={280}>
						{stackedSeries.length > 0 ? (
							<BarChart data={chartData} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
								<CartesianGrid strokeDasharray="3 3" stroke="#F0F0F2" />
								<XAxis dataKey="nome" tick={{ fontSize: 11, fill: '#8E8E93' }} />
								<YAxis tick={{ fontSize: 11, fill: '#8E8E93' }} />
								<Tooltip contentStyle={{ borderRadius: 12, border: '1px solid #E5E5EA', fontSize: 13 }} />
								{stackedSeries.map((s, i) => <Bar key={s} dataKey={s} stackId="a" fill={PALETA_GRAFICO[i % PALETA_GRAFICO.length]} name={s} />)}
							</BarChart>
						) : campoData ? (
							<LineChart data={chartData} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
								<CartesianGrid strokeDasharray="3 3" stroke="#F0F0F2" />
								<XAxis dataKey="nome" tick={{ fontSize: 11, fill: '#8E8E93' }} />
								<YAxis tick={{ fontSize: 11, fill: '#8E8E93' }} />
								<Tooltip contentStyle={{ borderRadius: 12, border: '1px solid #E5E5EA', fontSize: 13 }} />
								<Line type="monotone" dataKey="valor" stroke="#0A60D0" strokeWidth={2} dot={false} name={metricaRotulo(metricas[0])} />
							</LineChart>
						) : (
							<BarChart data={chartData} layout="vertical" margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
								<CartesianGrid strokeDasharray="3 3" stroke="#F0F0F2" horizontal={false} />
								<XAxis type="number" tick={{ fontSize: 11, fill: '#8E8E93' }} />
								<YAxis type="category" dataKey="nome" tick={{ fontSize: 11, fill: '#8E8E93' }} width={120} />
								<Tooltip contentStyle={{ borderRadius: 12, border: '1px solid #E5E5EA', fontSize: 13 }} />
								<Bar dataKey="valor" fill="#0A60D0" radius={[0, 4, 4, 0]} name={metricaRotulo(metricas[0])} />
							</BarChart>
						)}
					</ResponsiveContainer>
				</div>
			)}

			{/* Tabela */}
			<div className="rounded-2xl bg-white p-5" style={{ boxShadow: '0 0 0 1px #E5E5EA, 0 2px 12px rgba(0,0,0,.04)' }}>
				{busy ? <p className="py-8 text-center text-[14px] text-[#8E8E93]">Rodando relatório…</p> :
					linhas.length === 0 ? (
						<div className="py-10 text-center">
							<p className="text-[14px] text-[#6E6E73]">Nada no período. Tente outro período ou tire um filtro.</p>
							<button onClick={() => { setPeriodo('30d'); }} className="mt-3 h-9 rounded-full bg-[#1D1D1F] px-5 text-[14px] font-medium text-white hover:opacity-85">Últimos 30 dias</button>
						</div>
					) : (
						<div className="overflow-x-auto">
							<table className="w-full border-collapse text-[14px]">
								<thead><tr className="border-b border-[#E5E5EA] text-left text-[12px] font-semibold uppercase tracking-wide text-[#8E8E93]">
									{heads.map(h => {
										const m = metricas.find(x => x.nome === h);
										const tipo = m?.funcao === 'taxa' ? 'taxa' : m ? 'numero' : campos.find(c => c.nome === h)?.tipo;
										const ordenavel = agrupar.includes(h) || !!m;
										return (
											<th key={h} className="py-2 pr-4">
												{ordenavel ? (
													<button onClick={() => ordenarPor(h)} className="inline-flex items-center gap-1 hover:text-[#1D1D1F]">
														{rotulo(h)}
														{ordem === h && (ordemDir === 'asc' ? <ChevronUp size={12} /> : <ChevronDown size={12} />)}
													</button>
												) : rotulo(h)}
												{tipo && <span className="sr-only"> ({tipo})</span>}
											</th>
										);
									})}
								</tr></thead>
								<tbody>
									{linhas.map((r, i) => (
										<tr key={i} className="border-b border-[#F0F0F2]">
											{heads.map(h => {
												const m = metricas.find(x => x.nome === h);
												const tipo = m?.funcao === 'taxa' ? 'taxa' : m ? 'numero' : campos.find(c => c.nome === h)?.tipo;
												const v = r[h];
												return <td key={h} className="py-2.5 pr-4 tnum text-[#1D1D1F]">{formatValor(v, tipo)}</td>;
											})}
										</tr>
									))}
								</tbody>
								{totalLinha && agrupar.length > 0 && (
									<tfoot><tr className="border-t-2 border-[#E5E5EA] font-semibold">
										{heads.map(h => {
											const m = metricas.find(x => x.nome === h);
											const tipo = m?.funcao === 'taxa' ? 'taxa' : m ? 'numero' : null;
											if (!m) return <td key={h} className="py-2.5 pr-4 text-[#1D1D1F]">Total do período</td>;
											return <td key={h} className="py-2.5 pr-4 tnum text-[#1D1D1F]">{formatValor(totalLinha[h], tipo ?? undefined)}</td>;
										})}
									</tr></tfoot>
								)}
							</table>
						</div>
					)}
			</div>

			{exportarOpen && <ExportarPainel modelo={modelo} filtrosAtivos={filtrosAtivos} deIso={deIso} ateIso={ateIso} fotoDoDia={fotoDoDia} onClose={() => setExportarOpen(false)} />}
			{emailOpen && <EnvioEmail modelo={modelo} onClose={() => setEmailOpen(false)} onSaved={onSaved} />}
			{ajustar && <AjustarPainel modelo={modeloAtual} bases={bases} camposByBase={camposByBase} onClose={() => setAjustar(false)} onSaved={m => { setModeloAtual(m); setAjustar(false); onSaved(); }} />}
		</div>
	);
}

/** Paleta de cores para as séries do gráfico de colunas empilhadas. */
const PALETA_GRAFICO = ['#0A60D0', '#34C759', '#FF9500', '#AF52DE', '#FF3B30', '#5AC8FA', '#FFCC00', '#8E8E93'];

function infoMetrica(m: Metrica): string {
	if (m.funcao === 'taxa' && m.divisor) return `${metricaRotulo(m)} = ${m.campo ?? ''} ÷ ${m.divisor}`;
	if (m.funcao === 'contar') return `${metricaRotulo(m)} = contagem de linhas`;
	if (m.funcao === 'somar') return `${metricaRotulo(m)} = soma de ${m.campo ?? ''}`;
	if (m.funcao === 'media') return `${metricaRotulo(m)} = média de ${m.campo ?? ''}`;
	return metricaRotulo(m);
}

function InfoPopover({ texto }: { texto: string }) {
	const [open, setOpen] = useState(false);
	return (
		<div className="relative">
			<button onClick={() => setOpen(o => !o)} className="text-[#8E8E93] hover:text-[#1D1D1F]"><Info size={13} /></button>
			{open && (
				<>
					<div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
					<div className="absolute left-0 top-5 z-20 w-[220px] rounded-xl bg-[#1D1D1F] p-3 text-[12px] text-white" style={{ boxShadow: '0 8px 24px rgba(0,0,0,.3)' }}>{texto}</div>
				</>
			)}
		</div>
	);
}

// Painel "Ajustar" — abre o montador de 3 passos com o relatório atual.
function AjustarPainel({ modelo, bases, camposByBase, onClose, onSaved }: { modelo: ModeloRelatorio; bases: RelatorioBase[]; camposByBase: Record<string, RelatorioCampo[]>; onClose: () => void; onSaved: (m: ModeloRelatorio) => void }) {
	return (
		<div className="fixed inset-0 z-[100] bg-black/40" onClick={onClose}>
			<div className="absolute right-0 top-0 h-full w-full max-w-[600px] overflow-y-auto bg-[#F8F8F9] p-6" onClick={e => e.stopPropagation()}>
				<div className="mb-4 flex items-center justify-between">
					<h2 className="text-[18px] font-semibold text-[#1D1D1F]">Ajustar relatório</h2>
					<button onClick={onClose} className="text-[#8E8E93]"><X size={20} /></button>
				</div>
				<MontarRelatorio embedded modeloEdicao={modelo} bases={bases} camposByBase={camposByBase} onBack={onClose} onSaved={onSaved} />
			</div>
		</div>
	);
}
