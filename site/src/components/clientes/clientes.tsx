import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { Download, Search, X } from 'lucide-react';
import { Empty, Loading, Notice, PageHeading } from '@/components/app-shell';
import { useMotorAuth } from '@/components/auth-provider';
import { dateBR, dateTimeBR, friendlyError, moneyBR, numberBR, supabase } from '@/lib/supabase';
import {
	type ClienteFiltros,
	type ClienteRow,
	type ClusterInfo,
	type Enquadramento,
	canalNome,
	fetchClusters,
	fetchClientes,
	fetchEnquadramento,
	fetchMotivosHoje,
	fetchTodosClientes,
	isPropensaoDisponivel,
	momentoComCiclo,
	momentoNome,
	momentoOrdem,
	segmentoNome,
} from '@/lib/clientes';
import { FaixaBadge } from '@/components/propensao/faixa-badge';
import { Info } from '@/components/glossario/info';
import { ReenquadramentoButton, type ReenquadramentoHandle } from '@/components/reenquadramento/reenquadramento-button';
import { ComparacaoAntesDepois } from '@/components/clientes/comparacao-antes-depois';

const POR_PAGINA = 50;

export function Clientes() {
	const { empresa, credores, credor } = useMotorAuth();
	const navigate = useNavigate();
	const [enq, setEnq] = useState<Enquadramento[]>([]);
	const [clusters, setClusters] = useState<ClusterInfo[]>([]);
	const [rows, setRows] = useState<ClienteRow[]>([]);
	const [total, setTotal] = useState(0);
	const [pagina, setPagina] = useState(0);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState('');
	const [soNaCarga, setSoNaCarga] = useState(true);
	const [filtros, setFiltros] = useState<ClienteFiltros>({
		segmento: null, estrategia: null, estado: null, persona: null, motivoHoje: null,
		comAcaoHoje: false, soNaCarga: true, busca: '', faixa: null,
	});
	const [propensaoOk, setPropensaoOk] = useState(false);
	const [motivosOpts, setMotivosOpts] = useState<string[]>([]);

	const credorId = credor?.id ?? null;
	const reenqRef = useRef<ReenquadramentoHandle>(null);
	const [reloadTrigger, setReloadTrigger] = useState(0);
	const [searchParams, setSearchParams] = useSearchParams();

	// Carrega resumo (enquadramento) + clusters quando muda credor.
	useEffect(() => {
		if (!supabase || !empresa || !credorId) { setEnq([]); setClusters([]); return; }
		let active = true;
		(async () => {
			setError('');
			try {
				const [e, c] = await Promise.all([
					fetchEnquadramento(empresa.id, credorId),
					fetchClusters(empresa.id),
				]);
				if (!active) return;
				setEnq(e);
				setClusters(c);
			} catch { if (active) setError(friendlyError()); }
		})();
		return () => { active = false; };
	}, [empresa?.id, credorId, reloadTrigger]);

	// Carrega os motivos de hoje da carteira (view motivos_hoje) para o filtro.
	useEffect(() => {
		if (!empresa || !credorId) { setMotivosOpts([]); return; }
		let active = true;
		fetchMotivosHoje(empresa.id, credorId).then(list => { if (active) setMotivosOpts(list); });
		return () => { active = false; };
	}, [empresa?.id, credorId]);

	// Pré-filtra pelo motivo/faixa/comAcaoHoje quando chega via URL.
	useEffect(() => {
		const m = searchParams.get('motivo');
		const faixa = searchParams.get('faixa');
		const comAcao = searchParams.get('comAcaoHoje') === '1';
		if (!m && !faixa && !comAcao) return;
		setFiltros(f => ({ ...f, motivoHoje: m ?? f.motivoHoje, faixa: faixa ?? f.faixa, comAcaoHoje: comAcao || f.comAcaoHoje }));
		setSearchParams({}, { replace: true });
	// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [searchParams]);

	// Sincroniza soNaCarga com filtros.
	useEffect(() => {
		setFiltros(f => ({ ...f, soNaCarga }));
	}, [soNaCarga]);

	// Carrega lista de clientes quando filtros/página/credor mudam.
	useEffect(() => {
		if (!supabase || !empresa || !credorId) { setRows([]); setTotal(0); return; }
		let active = true;
		(async () => {
			setLoading(true);
			try {
				const { rows: r, total: t } = await fetchClientes(empresa.id, credorId, filtros, pagina, POR_PAGINA);
				if (!active) return;
				setRows(r);
				setTotal(t);
				setPropensaoOk(isPropensaoDisponivel());
			} catch { if (active) setError(friendlyError()); }
			finally { if (active) setLoading(false); }
		})();
		return () => { active = false; };
	}, [empresa?.id, credorId, filtros, pagina]);

	// Reseta página quando filtros mudam.
	useEffect(() => { setPagina(0); }, [filtros.segmento, filtros.estrategia, filtros.estado, filtros.persona, filtros.motivoHoje, filtros.comAcaoHoje, filtros.soNaCarga, filtros.busca, filtros.faixa]);

	const resumo = useMemo(() => {
		const base = soNaCarga ? enq.filter(r => r.na_carga) : enq;
		const naCarga = enq.filter(r => r.na_carga).reduce((a, r) => a + r.clientes, 0);
		const comAcao = enq.filter(r => r.na_carga).reduce((a, r) => a + r.com_acao_hoje, 0);
		const foraCarga = enq.filter(r => !r.na_carga).reduce((a, r) => a + r.clientes, 0);
		const saldo = enq.filter(r => r.na_carga).reduce((a, r) => a + r.saldo, 0);
		return { naCarga, comAcao, foraCarga, saldo };
	}, [enq, soNaCarga]);

	// Matriz segmento × momento (apenas na_carga se soNaCarga).
	const matriz = useMemo(() => {
		const base = soNaCarga ? enq.filter(r => r.na_carga) : enq;
		const porSegmento = new Map<string, { estrategia: string | null; celulas: Record<string, { clientes: number; saldo: number }> }>();
		for (const r of base) {
			const seg = r.cluster ?? '';
			if (!porSegmento.has(seg)) porSegmento.set(seg, { estrategia: r.estrategia, celulas: {} });
			const entry = porSegmento.get(seg)!;
			if (!entry.estrategia && r.estrategia) entry.estrategia = r.estrategia;
			const est = r.estado ?? '';
			const cel = entry.celulas[est] ?? { clientes: 0, saldo: 0 };
			cel.clientes += r.clientes;
			cel.saldo += r.saldo;
			entry.celulas[est] = cel;
		}
		const maxClientes = Math.max(1, ...[...porSegmento.values()].flatMap(e => Object.values(e.celulas).map(c => c.clientes)));
		const segmentos = [...porSegmento.keys()].sort((a, b) => segmentoNome(a || null, clusters).localeCompare(segmentoNome(b || null, clusters), 'pt-BR'));
		return { segmentos, porSegmento, maxClientes };
	}, [enq, soNaCarga, clusters]);

	// Opções de filtros vindas do resumo.
	const opcoes = useMemo(() => {
		const base = soNaCarga ? enq.filter(r => r.na_carga) : enq;
		const segs = new Set<string>(); const estrs = new Set<string>(); const pers = new Set<string>();
		// personas vêm da lista de clientes carregada; coletamos das linhas atuais + resumo não tem persona.
		for (const r of base) { if (r.cluster) segs.add(r.cluster); if (r.estrategia) estrs.add(r.estrategia); }
		for (const r of rows) { if (r.persona && r.persona.trim()) pers.add(r.persona); }
		return {
			segmentos: [...segs].sort(),
			estrategias: [...estrs].sort(),
			personas: [...pers].sort(),
		};
	}, [enq, rows, soNaCarga]);

	const atualizadoEm = useMemo(() => {
		const datas = rows.map(r => r.atualizado_em).filter(Boolean) as string[];
		if (datas.length === 0) return null;
		return datas.reduce((a, b) => (a && a > b ? a : b));
	}, [rows]);

	const semEstrategia = useMemo(() => enq.length > 0 && enq.every(r => !r.estrategia), [enq]);

	function toggleFiltro<K extends keyof ClienteFiltros>(key: K, valor: string | null) {
		setFiltros(f => ({ ...f, [key]: f[key] === valor ? null : valor }));
	}

	function limparFiltros() {
		setFiltros({ segmento: null, estrategia: null, estado: null, persona: null, motivoHoje: null, comAcaoHoje: false, soNaCarga, busca: '', faixa: null });
	}

	async function baixarCSV() {
		if (!empresa || !credorId) return;
		try {
			const todos = await fetchTodosClientes(empresa.id, credorId, filtros);
			const header = ['ID do cliente', 'Segmento', 'Esteira', 'Momento', 'Persona', 'Persona (sua)', 'Enviado ao bureau', 'Retorno do bureau', 'Canal da vez', 'Ação de hoje', 'Hoje', 'Passo', 'Saldo', 'Atraso', 'Na carga'];
			const linhas = todos.map(r => [
				r.id_cliente,
				segmentoNome(r.cluster_atual, clusters),
				r.estrategia ?? '',
				momentoComCiclo(r.estado, r.ciclo),
				r.persona ?? '',
				r.persona_usuario ?? '',
				r.enriq_enviado ?? '',
				r.enriq_retorno ?? '',
				r.canal ? (canalNome[r.canal] ?? r.canal) : '—',
				r.acao_hoje ?? '',
				r.motivo_hoje ?? '',
				r.passo_hoje ?? '',
				String(Number(r.saldo) || 0),
				r.dias_atraso != null ? String(r.dias_atraso) : '',
				r.na_carga ? 'sim' : 'fora',
			].map(c => `"${String(c).replace(/"/g, '""')}"`).join(','));
			const csv = [header.join(','), ...linhas].join('\n');
			const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8;' });
			const link = document.createElement('a');
			link.href = URL.createObjectURL(blob);
			link.download = `clientes-${credor?.codigo ?? credorId}.csv`;
			document.body.appendChild(link);
			link.click(); link.remove();
			window.setTimeout(() => URL.revokeObjectURL(link.href), 60000);
		} catch (e) { setError(friendlyError(e)); }
	}

	const totalPaginas = Math.max(1, Math.ceil(total / POR_PAGINA));
	const temFiltro = filtros.segmento || filtros.estrategia || filtros.estado || filtros.persona || filtros.motivoHoje || filtros.comAcaoHoje || filtros.faixa || filtros.busca.trim();

	return <>
		<PageHeading eyebrow="CARTEIRA / CLIENTES" title="Clientes" description="Veja onde cada cliente da carteira se enquadrou na esteira." actions={empresa && credores.length > 0 ? (
			<div className="flex flex-wrap items-center gap-3">
				<ReenquadramentoButton ref={reenqRef} onConcluido={() => setReloadTrigger(t => t + 1)} />
			</div>
		) : null}/>

		{!empresa ? <Notice variant="warning">Escolha a empresa no topo para ver esta página.</Notice>
		: credores.length === 0 ? <Empty>Esta empresa ainda não tem carteiras cadastradas.</Empty>
		: !credorId ? <Notice variant="warning">Escolha uma carteira no topo para ver os clientes.</Notice>
		: <>
			{error && <div className="mb-5"><Notice>{error}</Notice></div>}

			{semEstrategia && <div className="mb-5"><Notice variant="warning">Rode a atualização do banco e aguarde a próxima rotina para ver a esteira de cada cliente.</Notice></div>}

			{/* 1. Resumo */}
			<section className="mb-8">
				<div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
					<CardResumo label="Na carga" valor={numberBR(resumo.naCarga)} sub="clientes ativos"/>
					<CardResumo label="Com ação hoje" valor={numberBR(resumo.comAcao)} sub="acionados hoje"/>
					<CardResumo label="Fora da carga" valor={numberBR(resumo.foraCarga)} sub="retirados / quitados"/>
					<CardResumo label="Saldo em cobrança" valor={moneyBR(resumo.saldo)} sub="só na carga"/>
				</div>

				<div className="mt-6 rounded-xl border border-[#dfe8ea] bg-white p-5 sm:p-6">
					<div className="mb-4 flex flex-wrap items-center justify-between gap-3">
						<h2 className="text-base font-semibold">Como a carteira se dividiu</h2>
						<button onClick={() => setSoNaCarga(v => !v)} className={`flex h-9 items-center gap-2 rounded-lg border px-4 text-xs font-semibold transition-colors ${soNaCarga ? 'border-[#0F4C5C] bg-[#0F4C5C] text-white' : 'border-[#c9dadd] bg-white text-[#304b55] hover:bg-[#edf4f5]'}`}>
							<span className={`h-2 w-2 rounded-full ${soNaCarga ? 'bg-white' : 'bg-slate-300'}`}/>
							Só na carga
						</button>
					</div>
					{enq.length === 0 ? <Empty>Sem dados de enquadramento para esta carteira ainda.</Empty> : (
						<div className="overflow-x-auto">
							<table className="w-full min-w-[760px] border-collapse text-sm">
								<thead>
									<tr>
										<th className="sticky left-0 z-10 bg-white pb-3 pr-4 text-left text-xs font-medium text-slate-400">Segmento</th>
										{momentoOrdem.map(m => <th key={m} className="pb-3 px-1 text-center text-xs font-medium text-slate-400">{momentoNome[m]}</th>)}
									</tr>
								</thead>
								<tbody>
									{matriz.segmentos.map(seg => {
										const entry = matriz.porSegmento.get(seg)!;
										return <tr key={seg} className="border-t border-[#eef3f4]">
											<td className="sticky left-0 z-10 bg-white py-3 pr-4">
												<div className="font-semibold text-[#163943]">{segmentoNome(seg || null, clusters)}</div>
												<div className="text-[11px] text-slate-400">{entry.estrategia ?? 'Padrão da empresa'}</div>
											</td>
											{momentoOrdem.map(m => {
												const cel = entry.celulas[m];
												if (!cel || cel.clientes === 0) return <td key={m} className="px-1 py-2 text-center text-slate-300">—</td>;
												const intensidade = Math.min(1, cel.clientes / matriz.maxClientes);
												return <td key={m} className="px-1 py-2">
													<button onClick={() => toggleFiltro('estado', m)} className="block w-full rounded-lg px-2 py-2 text-center transition-transform hover:scale-[1.03]" style={{ backgroundColor: `rgba(15, 76, 92, ${0.08 + intensidade * 0.85})` }}>
														<div className="text-sm font-bold" style={{ color: intensidade > 0.55 ? '#fff' : '#163943' }}>{numberBR(cel.clientes)}</div>
														<div className="text-[10px]" style={{ color: intensidade > 0.55 ? 'rgba(255,255,255,.8)' : '#6b7e85' }}>{moneyBR(cel.saldo)}</div>
													</button>
												</td>;
											})}
										</tr>;
									})}
								</tbody>
							</table>
						</div>
					)}
				</div>
			</section>

			{empresa && credorId && <ComparacaoAntesDepois empresaId={empresa.id} credorId={credorId} clusters={clusters} trigger={reloadTrigger} />}

		{/* 2. Lista de clientes */}
			<section>
				<div className="mb-4 flex flex-wrap items-center justify-between gap-3">
					<div className="text-sm text-slate-500">
						{atualizadoEm ? <>Atualizado na rotina das <strong className="text-[#0F4C5C]">{dateTimeBR(atualizadoEm).split(', ')[1] ?? dateTimeBR(atualizadoEm)}</strong></> : 'Sem dados de rotina ainda.'}
					</div>
					<button onClick={baixarCSV} className="flex h-9 items-center gap-2 rounded-lg border border-[#c9dadd] bg-white px-4 text-xs font-semibold text-[#0F4C5C] hover:bg-[#edf4f5]">
						<Download size={14}/> Baixar CSV
					</button>
				</div>

				{/* Chips de filtro */}
				<div className="mb-4 flex flex-wrap items-center gap-2">
					<ChipGroup label="Segmento" opcoes={opcoes.segmentos.map(s => ({ valor: s, label: segmentoNome(s, clusters) }))} ativo={filtros.segmento} onToggle={v => toggleFiltro('segmento', v)} />
					<ChipGroup label="Esteira" opcoes={opcoes.estrategias.map(s => ({ valor: s, label: s }))} ativo={filtros.estrategia} onToggle={v => toggleFiltro('estrategia', v)} />
					<ChipGroup label="Momento" opcoes={momentoOrdem.filter(m => enq.some(r => r.estado === m)).map(m => ({ valor: m, label: momentoNome[m] }))} ativo={filtros.estado} onToggle={v => toggleFiltro('estado', v)} />
					<ChipGroup label="Persona" opcoes={opcoes.personas.map(s => ({ valor: s, label: s }))} ativo={filtros.persona} onToggle={v => toggleFiltro('persona', v)} />
				{propensaoOk && (
					<ChipGroup label="Propensão" opcoes={[{ valor: 'A', label: 'A' }, { valor: 'B', label: 'B' }, { valor: 'C', label: 'C' }, { valor: 'D', label: 'D' }, { valor: 'E', label: 'E' }, { valor: 'sem', label: 'Sem faixa' }]} ativo={filtros.faixa} onToggle={v => toggleFiltro('faixa', v)} />
				)}
					{motivosOpts.length > 0 && (
						<select value={filtros.motivoHoje ?? ''} onChange={e => setFiltros(f => ({ ...f, motivoHoje: e.target.value || null }))} className={`h-8 rounded-full border px-3 text-xs font-medium outline-none ${filtros.motivoHoje ? 'border-[#0F4C5C] bg-[#0F4C5C] text-white' : 'border-[#c9dadd] bg-white text-[#304b55] hover:bg-[#edf4f5]'}`}>
							<option value="">Hoje</option>
							{motivosOpts.map(m => <option key={m} value={m}>{m}</option>)}
						</select>
					)}
					<button onClick={() => setFiltros(f => ({ ...f, comAcaoHoje: !f.comAcaoHoje }))} className={`flex h-8 items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition-colors ${filtros.comAcaoHoje ? 'border-[#0F4C5C] bg-[#0F4C5C] text-white' : 'border-[#c9dadd] bg-white text-[#304b55] hover:bg-[#edf4f5]'}`}>Com ação hoje</button>
					<button onClick={() => setSoNaCarga(v => !v)} className={`flex h-8 items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition-colors ${soNaCarga ? 'border-[#0F4C5C] bg-[#0F4C5C] text-white' : 'border-[#c9dadd] bg-white text-[#304b55] hover:bg-[#edf4f5]'}`}>Só na carga</button>
					{temFiltro && <button onClick={limparFiltros} className="flex h-8 items-center gap-1 rounded-full px-3 text-xs font-medium text-[#C62828] hover:bg-red-50">Limpar filtros</button>}
					<div className="relative ml-auto">
						<Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"/>
						<input value={filtros.busca} onChange={e => setFiltros(f => ({ ...f, busca: e.target.value }))} placeholder="Buscar por ID..." className="h-9 w-56 rounded-lg border border-[#d8e3e5] bg-white pl-9 pr-3 text-sm outline-none focus:border-[#0F4C5C]"/>
					</div>
				</div>

				{loading ? <Loading/> : rows.length === 0 ? <Empty>{temFiltro ? 'Nenhum cliente com esses filtros.' : 'Nenhum cliente nesta carteira ainda.'}</Empty> : (
					<div className="overflow-x-auto rounded-xl border border-[#dfe8ea] bg-white">
						<table className="w-full min-w-[1600px] text-left text-sm">
							<thead>
								<tr className="border-b border-[#e4ebed] text-xs text-slate-400">
									<th className="px-4 py-3 font-medium">ID do cliente</th>
									<th className="px-4 py-3 font-medium">Segmento</th>
									<th className="px-4 py-3 font-medium">Esteira</th>
									<th className="px-4 py-3 font-medium">Momento</th>
									<th className="px-4 py-3 font-medium">Persona</th>
									<th className="px-4 py-3 font-medium">Persona (sua)</th>
									<th className="px-4 py-3 font-medium">Propensão <Info slug="propensao-a-pagamento" /></th>
									<th className="px-4 py-3 font-medium">Enviado ao bureau</th>
									<th className="px-4 py-3 font-medium">Retorno do bureau</th>
									<th className="px-4 py-3 font-medium">Canal da vez</th>
									<th className="px-4 py-3 font-medium">Ação de hoje</th>
									<th className="px-4 py-3 font-medium">Hoje</th>
									<th className="px-4 py-3 font-medium">Passo</th>
									<th className="px-4 py-3 text-right font-medium">Saldo</th>
									<th className="px-4 py-3 text-right font-medium">Atraso</th>
									<th className="px-4 py-3 font-medium">Na carga</th>
								</tr>
							</thead>
							<tbody className="divide-y divide-[#eef3f4]">
								{rows.map((r, i) => (
									<tr key={r.id_cliente ?? i} onClick={() => navigate(`/cliente?id=${encodeURIComponent(r.id_cliente)}`)} className="cursor-pointer hover:bg-[#f6fafb]">
										<td className="px-4 py-3 font-mono text-xs font-semibold text-[#0F4C5C]">{r.id_cliente}</td>
										<td className="px-4 py-3">{segmentoNome(r.cluster_atual, clusters)}</td>
										<td className="px-4 py-3 text-slate-500">{r.estrategia ?? '—'}</td>
										<td className="px-4 py-3">{momentoComCiclo(r.estado, r.ciclo)}</td>
										<td className="px-4 py-3 text-slate-500">{r.persona?.trim() ? r.persona : '—'}</td>
										<td className="px-4 py-3 text-slate-500">{r.persona_usuario?.trim() ? r.persona_usuario : '—'}</td>
										<td className="px-4 py-3"><FaixaBadge faixa={r.faixa_propensao} propensao={r.propensao} /></td>
										<td className="px-4 py-3 text-slate-500">{r.enriq_enviado ? dateBR(r.enriq_enviado) : '—'}</td>
										<td className="px-4 py-3 text-slate-500">{r.enriq_retorno ? dateBR(r.enriq_retorno) : '—'}</td>
										<td className="px-4 py-3">{r.canal ? (canalNome[r.canal] ?? r.canal) : '—'}</td>
										<td className="px-4 py-3">{r.acao_hoje?.trim() ? <span>{r.acao_hoje}{r.acao_hoje.toLowerCase().includes('reserva') ? <span className="ml-1 text-xs text-slate-400">(reserva)</span> : null}</span> : <span className="text-slate-300">—</span>}</td>
										<td className="px-4 py-3">{r.motivo_hoje?.trim() ? <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${r.motivo_hoje.toLowerCase().startsWith('com ação') ? 'bg-green-50 text-[#2E7D32]' : 'bg-amber-50 text-[#9a631b]'}`}>{r.motivo_hoje}</span> : <span className="text-slate-300">—</span>}</td>
									<td className="px-4 py-3 text-slate-500">{r.passo_hoje?.trim() ?? '—'}</td>
										<td className="px-4 py-3 text-right font-semibold">{moneyBR(r.saldo)}</td>
										<td className="px-4 py-3 text-right text-slate-500">{r.dias_atraso != null ? numberBR(r.dias_atraso) : '—'}</td>
										<td className="px-4 py-3">{r.na_carga ? <span className="text-[#2E7D32]">✓</span> : <span className="text-xs text-slate-400">fora</span>}</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
				)}

				{total > POR_PAGINA && (
					<div className="mt-4 flex items-center justify-between text-sm">
						<span className="text-slate-500">{numberBR(total)} clientes · página {pagina + 1} de {totalPaginas}</span>
						<div className="flex gap-2">
							<button disabled={pagina === 0} onClick={() => setPagina(p => p - 1)} className="flex h-9 items-center rounded-lg border border-[#c9dadd] bg-white px-4 text-xs font-semibold text-[#304b55] disabled:opacity-40 hover:bg-[#edf4f5]">Anterior</button>
							<button disabled={pagina >= totalPaginas - 1} onClick={() => setPagina(p => p + 1)} className="flex h-9 items-center rounded-lg border border-[#c9dadd] bg-white px-4 text-xs font-semibold text-[#304b55] disabled:opacity-40 hover:bg-[#edf4f5]">Próxima</button>
						</div>
					</div>
				)}
			</section>
		</>}
	</>;
}

function CardResumo({ label, valor, sub }: { label: string; valor: string; sub: string }) {
	return <div className="rounded-xl border border-[#dfe8ea] bg-white p-5">
		<p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">{label}</p>
		<p className="mt-2 text-2xl font-semibold text-[#0F4C5C]">{valor}</p>
		<p className="mt-1 text-xs text-slate-500">{sub}</p>
	</div>;
}

function ChipGroup({ label, opcoes, ativo, onToggle }: { label: string; opcoes: { valor: string; label: string }[]; ativo: string | null; onToggle: (v: string) => void }) {
	const [open, setOpen] = useState(false);
	if (opcoes.length === 0) return null;
	return <div className="relative">
		<button onClick={() => setOpen(v => !v)} className={`flex h-8 items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition-colors ${ativo ? 'border-[#0F4C5C] bg-[#0F4C5C] text-white' : 'border-[#c9dadd] bg-white text-[#304b55] hover:bg-[#edf4f5]'}`}>
			{ativo ? opcoes.find(o => o.valor === ativo)?.label ?? label : label}
			{ativo ? <X size={12}/> : null}
		</button>
		{open && <>
			<button className="fixed inset-0 z-20 cursor-default" onClick={() => setOpen(false)} aria-hidden/>
			<div className="absolute z-30 mt-1 max-h-64 w-56 overflow-auto rounded-lg border border-[#d8e3e5] bg-white p-1 shadow-lg">
				{opcoes.map(o => <button key={o.valor} onClick={() => { onToggle(o.valor); setOpen(false); }} className={`block w-full rounded px-3 py-2 text-left text-xs hover:bg-[#edf4f5] ${ativo === o.valor ? 'font-semibold text-[#0F4C5C]' : 'text-[#304b55]'}`}>{o.label}</button>)}
			</div>
		</>}
	</div>;
}
