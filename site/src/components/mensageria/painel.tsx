import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router';
import { supabase, friendlyError, type Row } from '@/lib/supabase';
import { useMotorAuth } from '@/components/auth-provider';
import { PRODUTO_MAP, PERIODO_OPCOES, periodoDatas, num, pct, isCanalValido } from '@/lib/mensageria-produtos';
import { INFO_DEFS } from '@/lib/mensageria-info';
import { InfoButton } from '@/components/mensageria/info-button';
import { exportarCsv } from '@/lib/mensageria';

type StatusRow = Record<string, any>;
type LinkRow = { data: string; enviados: number; entregues: number; clicaram: number; responderam: number; cpc_negocio: number; cliques: number; links: number };

function g(r: StatusRow, k: string): number { return Number(r?.[k] ?? 0); }

function Card({ label, valor, sub, cor, info }: { label: string; valor: string; sub?: string; cor?: string; info?: string }) {
	return (
		<div className="rounded-2xl bg-white p-5" style={{ boxShadow: '0 0 0 1px #E5E5EA, 0 2px 12px rgba(0,0,0,.04)' }}>
			<div className="flex items-center gap-1.5">
				<p className="text-[12px] font-semibold uppercase tracking-wide text-[#8E8E93]">{label}</p>
				{info && <InfoButton def={INFO_DEFS[info]} />}
			</div>
			<p className="mt-2 text-[26px] font-bold tnum text-[#1D1D1F]" style={cor ? { color: cor } : undefined}>{valor}</p>
			{sub && <p className="mt-0.5 text-[12px] tnum text-[#8E8E93]">{sub}</p>}
		</div>
	);
}

function FunilBar({ label, valor, total, cor, info }: { label: string; valor: number; total: number; cor: string; info?: string }) {
	const w = total > 0 ? Math.max(2, Math.round((valor / total) * 100)) : 0;
	return (
		<div className="flex items-center gap-3">
			<div className="flex w-32 shrink-0 items-center gap-1.5">
				<span className="text-[13px] text-[#6E6E73]">{label}</span>
				{info && <InfoButton def={INFO_DEFS[info]} />}
			</div>
			<div className="h-7 flex-1 overflow-hidden rounded-lg bg-[#F5F5F7]">
				<div className="flex h-full items-center justify-end rounded-lg px-2 text-[12px] font-bold text-white tnum" style={{ width: `${w}%`, backgroundColor: cor, minWidth: '2rem' }}>{num(valor)}</div>
			</div>
			<span className="w-12 shrink-0 text-right text-[12px] tnum text-[#6E6E73]">{pct(valor, total)}</span>
		</div>
	);
}

function LineChart({ dias, series, cor }: { dias: string[]; series: { disparados: number[]; entregues: number[]; nao_entregues: number[] }; cor: string }) {
	const max = Math.max(1, ...series.disparados, ...series.entregues, ...series.nao_entregues);
	const W = 600, H = 160, pad = 28;
	const x = (i: number) => pad + (i / Math.max(1, dias.length - 1)) * (W - pad * 2);
	const y = (v: number) => H - pad - (v / max) * (H - pad * 2);
	const path = (arr: number[]) => arr.map((v, i) => `${i === 0 ? 'M' : 'L'}${x(i)},${y(v)}`).join(' ');
	return (
		<svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ maxHeight: 200 }}>
			<line x1={pad} y1={H - pad} x2={W - pad} y2={H - pad} stroke="#E5E5EA" />
			<line x1={pad} y1={pad} x2={pad} y2={H - pad} stroke="#E5E5EA" />
			<path d={path(series.nao_entregues)} fill="none" stroke="#FF3B30" strokeWidth={2} />
			<path d={path(series.entregues)} fill="none" stroke="#34C759" strokeWidth={2} />
			<path d={path(series.disparados)} fill="none" stroke={cor} strokeWidth={2} />
			{dias.map((d, i) => i % Math.ceil(dias.length / 6 || 1) === 0 ? <text key={i} x={x(i)} y={H - 8} textAnchor="middle" fontSize={9} fill="#8E8E93">{d.slice(5)}</text> : null)}
		</svg>
	);
}

export function PainelCanal() {
	const { canal } = useParams();
	const { empresa } = useMotorAuth();
	const [periodo, setPeriodo] = useState('7d');
	const [de, setDe] = useState('');
	const [ate, setAte] = useState('');
	const [origem, setOrigem] = useState('all');
	const [campanhas, setCampanhas] = useState<Row[]>([]);
	const [rows, setRows] = useState<StatusRow[]>([]);
	const [links, setLinks] = useState<LinkRow[]>([]);
	const [operadora, setOperadora] = useState<Row[] | null>(null);
	const [loading, setLoading] = useState(true);
	const [erro, setErro] = useState('');

	const { de: deIso, ate: ateIso } = periodoDatas(periodo, de, ate);

	const load = useCallback(async () => {
		if (!supabase || !empresa || !isCanalValido(canal)) return;
		setLoading(true); setErro('');
		let q = supabase.from('mensageria_funil_status').select('*').eq('empresa_id', empresa.id).eq('canal', canal).gte('data', deIso).lte('data', ateIso);
		if (origem !== 'all') q = q.eq('origem', origem);
		const [{ data: f, error: ef }, { data: l, error: el }, { data: camps }] = await Promise.all([
			q,
			supabase.from('mensageria_funil_links').select('*').eq('empresa_id', empresa.id).eq('canal', canal).gte('data', deIso).lte('data', ateIso),
			supabase.from('mensageria_campanhas').select('id,nome').eq('empresa_id', empresa.id).eq('canal', canal).order('criado_em', { ascending: false }),
		]);
		if (ef) { setErro(friendlyError(ef)); setLoading(false); return; }
		if (el) { setErro(friendlyError(el)); }
		setRows((f ?? []) as StatusRow[]);
		setLinks((l ?? []) as LinkRow[]);
		setCampanhas(camps ?? []);
		setLoading(false);
	}, [empresa?.id, canal, deIso, ateIso, origem]);

	useEffect(() => { void load(); }, [load]);

	// Entrega por operadora (só SMS).
	useEffect(() => {
		if (!supabase || !empresa || canal !== 'sms') { setOperadora(null); return; }
		let active = true;
		(async () => {
			const { data, error } = await supabase.rpc('rodar_relatorio', {
				base: 'mensagens',
				colunas: null,
				filtros: { empresa: empresa.id, de: deIso, ate: ateIso, campos: [{ campo: 'canal', op: 'igual', valor: canal }] },
				agrupar: ['operadora', 'situacao'],
				metricas: [{ funcao: 'contar', nome: 'n' }],
				ordem: null,
				limite: 1000,
			});
			if (!active) return;
			if (error) { setOperadora(null); return; }
			setOperadora((data ?? []) as Row[]);
		})();
		return () => { active = false; };
	}, [empresa?.id, canal, deIso, ateIso]);

	const t = useMemo(() => {
		const s: Record<string, number> = {};
		rows.forEach(r => { for (const k of Object.keys(r)) { if (typeof r[k] === 'number' || /^\d+$/.test(String(r[k] ?? ''))) s[k] = (s[k] ?? 0) + Number(r[k] ?? 0); } });
		return s;
	}, [rows]);

	const linkTotais = useMemo(() => {
		const s = { enviados: 0, entregues: 0, clicaram: 0, responderam: 0, cpc_negocio: 0, cliques: 0, links: 0 };
		links.forEach(r => { s.enviados += +r.enviados; s.entregues += +r.entregues; s.clicaram += +r.clicaram; s.responderam += +r.responderam; s.cpc_negocio += +r.cpc_negocio; s.cliques += +r.cliques; s.links += +r.links; });
		return s;
	}, [links]);

	const porDia = useMemo(() => {
		const map: Record<string, { disparados: number; entregues: number; nao_entregues: number }> = {};
		rows.forEach(r => {
			const d = r.data; if (!d) return;
			if (!map[d]) map[d] = { disparados: 0, entregues: 0, nao_entregues: 0 };
			map[d].disparados += g(r, 'disparados'); map[d].entregues += g(r, 'entregues'); map[d].nao_entregues += g(r, 'nao_entregues');
		});
		const dias = Object.keys(map).sort();
		return { dias, series: { disparados: dias.map(d => map[d].disparados), entregues: dias.map(d => map[d].entregues), nao_entregues: dias.map(d => map[d].nao_entregues) } };
	}, [rows]);

	const porOrigem = useMemo(() => {
		const map: Record<string, StatusRow> = {};
		rows.forEach(r => {
			const o = r.origem || '—';
			if (!map[o]) map[o] = { ...r };
			else for (const k of ['carregados', 'disparados', 'enviados', 'entregues', 'nao_entregues', 'fallback', 'respostas', 'clicaram']) map[o][k] = g(map[o], k) + g(r, k);
		});
		return Object.entries(map).map(([origem, r]) => ({ origem, carregados: g(r, 'carregados'), disparados: g(r, 'disparados'), enviados: g(r, 'enviados'), entregues: g(r, 'entregues'), nao_entregues: g(r, 'nao_entregues'), fallback: g(r, 'fallback'), respostas: g(r, 'respostas'), clicaram: g(r, 'clicaram') }));
	}, [rows]);

	// Agrupa o relatório de operadora (SMS).
	const porOperadora = useMemo(() => {
		if (!operadora) return [];
		const ops: Record<string, Record<string, number>> = {};
		const ordem = ['Vivo', 'Claro', 'TIM', 'Oi', 'Outras'];
		operadora.forEach(r => {
			const op = String(r.operadora ?? '').toLowerCase();
			const nome = op === 'vivo' ? 'Vivo' : op === 'claro' ? 'Claro' : op === 'tim' ? 'TIM' : op === 'oi' ? 'Oi' : 'Outras';
			const sit = String(r.situacao ?? '');
			if (!ops[nome]) ops[nome] = {};
			ops[nome][sit] = (ops[nome][sit] ?? 0) + Number(r.n ?? 0);
		});
		return ordem.filter(n => ops[n]).map(n => {
			const c = ops[n];
			const disparados = Object.entries(c).filter(([s]) => s !== 'pendente' && s !== 'bloqueada').reduce((a, [, v]) => a + v, 0);
			const entregues = (c['entregue'] ?? 0) + (c['descadastro'] ?? 0);
			const falhou = c['falhou'] ?? 0;
			const semRetorno = c['enviada'] ?? 0;
			return { nome: n, disparados, entregues, falhou, semRetorno };
		});
	}, [operadora]);

	if (!isCanalValido(canal)) return null;
	const cor = PRODUTO_MAP[canal].cor;
	const isRcs = canal === 'rcs';
	const isSms = canal === 'sms';
	const isEmail = canal === 'email';
	const disparadosKey = isEmail ? 'disparados_email' : isRcs ? 'disparados_rcs' : 'disparados_sms';

	if (loading) return <p className="py-8 text-center text-[14px] text-[#8E8E93]">Carregando...</p>;

	return (
		<div className="space-y-5">
			{erro && <div className="rounded-xl bg-[#FFE8E6] px-4 py-3 text-[14px] text-[#FF3B30]">{erro}</div>}

			{/* Filtros */}
			<div className="flex flex-wrap items-center gap-3">
				<select value={periodo} onChange={e => setPeriodo(e.target.value)} className="h-9 rounded-lg border border-[#D2D2D7] bg-white px-3 text-[14px] outline-none focus-visible:ring-2 focus-visible:ring-[#0071E5]/40">
					{PERIODO_OPCOES.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
				</select>
				{periodo === 'personalizado' && (<>
					<input type="date" value={de} onChange={e => setDe(e.target.value)} className="h-9 rounded-lg border border-[#D2D2D7] bg-white px-3 text-[14px] outline-none" />
					<input type="date" value={ate} onChange={e => setAte(e.target.value)} className="h-9 rounded-lg border border-[#D2D2D7] bg-white px-3 text-[14px] outline-none" />
				</>)}
				<select value={origem} onChange={e => setOrigem(e.target.value)} className="h-9 rounded-lg border border-[#D2D2D7] bg-white px-3 text-[14px] outline-none focus-visible:ring-2 focus-visible:ring-[#0071E5]/40">
					<option value="all">Todas as origens</option>
					<option value="lista_dia">Lista do dia</option>
					{campanhas.map(c => <option key={c.id} value={c.id}>{c.nome}</option>)}
				</select>
			</div>

			{isEmail ? (
				/* ============ E-MAIL ============ */
				<>
					<div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-6">
						<Card label="Carregados" valor={num(t.carregados)} info="carregados" />
						<Card label="Higienizados" valor={num(t.higienizados)} sub={pct(t.higienizados, t.carregados) + ' dos carregados'} info="higienizados" />
						<Card label="Disparados" valor={num(t.disparados)} info="disparados_email" />
						<Card label="Entregues" valor={num(t.entregues)} sub={pct(t.entregues, t.disparados) + ' dos disparados'} cor="#248A3D" info="entregues_email" />
						<Card label="Bounce permanente" valor={num(t.bounce_permanente)} sub={pct(t.bounce_permanente, t.disparados)} cor="#FF3B30" info="bounce_permanente" />
						<Card label="Bounce temporário" valor={num(t.bounce_temporario)} sub={pct(t.bounce_temporario, t.disparados) + ' dos disparados'} info="bounce_temporario" />
					</div>

					{/* Engajamento */}
					<section className="rounded-2xl bg-white p-6" style={{ boxShadow: '0 0 0 1px #E5E5EA, 0 2px 12px rgba(0,0,0,.04)' }}>
						<h2 className="mb-4 text-[16px] font-semibold text-[#1D1D1F]">Engajamento</h2>
						<div className="space-y-2.5">
							<FunilBar label="Entregues" valor={t.entregues} total={t.entregues} cor={cor} />
							<FunilBar label="Aberturas únicas" valor={t.aberturas} total={t.entregues} cor={cor} info="aberturas" />
							<FunilBar label="Cliques únicos" valor={t.cliques} total={t.entregues} cor={cor} info="cliques" />
							<FunilBar label="Respostas" valor={t.respostas} total={t.entregues} cor={cor} info="respostas" />
						</div>
						<div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-1 text-[13px] text-[#6E6E73]">
							<span className="flex items-center gap-1.5">Clique por abertura (CTOR): <strong className="text-[#1D1D1F] tnum">{pct(t.cliques, t.aberturas)}</strong><InfoButton def={INFO_DEFS.ctor} /></span>
							<span>Aberturas são estimadas (o Apple Mail abre sozinho).</span>
						</div>
					</section>

					{/* Saúde do remetente */}
					<section className="rounded-2xl bg-white p-5" style={{ boxShadow: '0 0 0 1px #E5E5EA, 0 2px 12px rgba(0,0,0,.04)' }}>
						<h2 className="mb-4 text-[16px] font-semibold text-[#1D1D1F]">Saúde do remetente</h2>
						<div className="overflow-x-auto">
							<table className="w-full border-collapse text-[14px]">
								<thead><tr className="border-b border-[#E5E5EA] text-left text-[12px] font-semibold uppercase tracking-wide text-[#8E8E93]">
									<th className="py-2 pr-4">Indicador</th><th className="py-2 pr-4 text-right">Valor</th><th className="py-2 pr-4">Referência</th><th className="py-2">Situação</th>
								</tr></thead>
								<tbody>
									{[
										{ nome: 'Taxa de entrega', valor: pct(t.entregues, t.disparados), ref: 'acima de 95%', ok: (t.entregues / Math.max(1, t.disparados)) >= 0.95 },
										{ nome: 'Bounce permanente', valor: pct(t.bounce_permanente, t.disparados), ref: 'abaixo de 2%', ok: (t.bounce_permanente / Math.max(1, t.disparados)) < 0.02 },
										{ nome: 'Marcados como spam', valor: pct(t.spam, t.entregues), ref: 'abaixo de 0,1% (limite 0,3%)', ok: (t.spam / Math.max(1, t.entregues)) < 0.001 },
										{ nome: 'Descadastros', valor: pct(t.descadastros, t.entregues), ref: 'abaixo de 0,5%', ok: (t.descadastros / Math.max(1, t.entregues)) < 0.005 },
									].map(r => (
										<tr key={r.nome} className="border-b border-[#F0F0F2]">
											<td className="py-2.5 pr-4 text-[#1D1D1F]">{r.nome}</td>
											<td className="py-2.5 pr-4 text-right tnum text-[#1D1D1F]">{r.valor}</td>
											<td className="py-2.5 pr-4 text-[#6E6E73]">{r.ref}</td>
											<td className="py-2.5"><span className="rounded-full px-2 py-0.5 text-[12px] font-semibold" style={{ color: r.ok ? '#248A3D' : '#D70015', backgroundColor: r.ok ? '#E8F8EC' : '#FFE8E6' }}>{r.ok ? 'Dentro' : 'Atenção'}</span></td>
										</tr>
									))}
								</tbody>
							</table>
						</div>
					</section>
				</>
			) : (
				/* ============ SMS / RCS ============ */
				<>
					<div className={`grid gap-4 ${isRcs ? 'grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 xl:grid-cols-8' : 'grid-cols-2 sm:grid-cols-4 lg:grid-cols-7'}`}>
						<Card label="Carregados" valor={num(t.carregados)} info="carregados" />
						<Card label="Higienizados" valor={num(t.higienizados)} sub={pct(t.higienizados, t.carregados) + ' dos carregados'} info="higienizados" />
						<Card label="Disparados" valor={num(t.disparados)} info={disparadosKey} />
						<Card label="Enviados" valor={num(t.enviados)} sub={pct(t.enviados, t.disparados) + ' dos disparados'} info="enviados" />
						<Card label="Entregues" valor={num(t.entregues)} sub={pct(t.entregues, t.disparados) + ' dos disparados'} cor="#248A3D" info="entregues_sms" />
						<Card label="Não entregues" valor={num(t.nao_entregues)} sub={pct(t.nao_entregues, t.disparados) + ' dos disparados'} cor="#FF3B30" info="nao_entregues" />
						<Card label="Respostas" valor={num(t.respostas)} sub={pct(t.respostas, t.entregues) + ' dos entregues'} cor="#0A60D0" info="respostas" />
						{isRcs && <Card label="Fallback (SMS)" valor={num(t.fallback)} sub={pct(t.fallback, t.disparados) + ' dos disparados'} info="fallback" />}
					</div>

					{/* Funil de envio */}
					<section className="rounded-2xl bg-white p-6" style={{ boxShadow: '0 0 0 1px #E5E5EA, 0 2px 12px rgba(0,0,0,.04)' }}>
						<h2 className="mb-4 text-[16px] font-semibold text-[#1D1D1F]">Funil de envio</h2>
						<div className="space-y-2.5">
							<FunilBar label="Carregados" valor={t.carregados} total={t.carregados} cor={cor} />
							<FunilBar label="Higienizados" valor={t.higienizados} total={t.carregados} cor={cor} info="higienizados" />
							<FunilBar label="Disparados" valor={t.disparados} total={t.carregados} cor={cor} info={disparadosKey} />
							<FunilBar label="Enviados" valor={t.enviados} total={t.carregados} cor={cor} info="enviados" />
							<FunilBar label="Entregues" valor={t.entregues} total={t.carregados} cor={cor} info="entregues_sms" />
							<FunilBar label="Não entregues" valor={t.nao_entregues} total={t.carregados} cor="#FF3B30" info="nao_entregues" />
						</div>
						<div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-1 text-[13px] text-[#6E6E73]">
							<span className="flex items-center gap-1.5">Sem retorno final da operadora: <strong className="text-[#1D1D1F] tnum">{num(t.sem_retorno)}</strong> ({pct(t.sem_retorno, t.disparados)} dos disparados)<InfoButton def={INFO_DEFS.sem_retorno} /></span>
						</div>
						<p className="mt-1 text-[13px] text-[#6E6E73]">Ficaram na higienização: inválidos {num(t.invalidos)} · bloqueados (lista de bloqueio, descadastro, sem texto) {num(t.bloqueados)}</p>
					</section>

					{/* Gráfico por dia */}
					{porDia.dias.length > 0 && (
						<section className="rounded-2xl bg-white p-6" style={{ boxShadow: '0 0 0 1px #E5E5EA, 0 2px 12px rgba(0,0,0,.04)' }}>
							<h2 className="mb-4 text-[16px] font-semibold text-[#1D1D1F]">Por dia</h2>
							<LineChart dias={porDia.dias} series={porDia.series} cor={cor} />
							<div className="mt-3 flex gap-4 text-[13px]">
								<span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded" style={{ backgroundColor: cor }} /> Disparados</span>
								<span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded bg-[#34C759]" /> Entregues</span>
								<span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded bg-[#FF3B30]" /> Não entregues</span>
							</div>
						</section>
					)}

					{/* Entrega por operadora (SMS) */}
					{isSms && porOperadora.length > 0 && (
						<section className="rounded-2xl bg-white p-5" style={{ boxShadow: '0 0 0 1px #E5E5EA, 0 2px 12px rgba(0,0,0,.04)' }}>
							<h2 className="mb-4 text-[16px] font-semibold text-[#1D1D1F]">Entrega por operadora</h2>
							<div className="overflow-x-auto">
								<table className="w-full border-collapse text-[14px]">
									<thead><tr className="border-b border-[#E5E5EA] text-left text-[12px] font-semibold uppercase tracking-wide text-[#8E8E93]">
										<th className="py-2 pr-4">Operadora</th><th className="py-2 pr-4 text-right">Disparados</th><th className="py-2 pr-4 text-right">Entregues %</th><th className="py-2 pr-4 text-right">Não entregues %</th><th className="py-2 text-right">Sem retorno %</th>
									</tr></thead>
									<tbody>
										{porOperadora.map(o => (
											<tr key={o.nome} className="border-b border-[#F0F0F2]">
												<td className="py-2.5 pr-4 text-[#1D1D1F]">{o.nome}</td>
												<td className="py-2.5 pr-4 text-right tnum text-[#1D1D1F]">{num(o.disparados)}</td>
												<td className="py-2.5 pr-4 text-right tnum text-[#248A3D]">{pct(o.entregues, o.disparados)}</td>
												<td className="py-2.5 pr-4 text-right tnum text-[#FF3B30]">{pct(o.falhou, o.disparados)}</td>
												<td className="py-2.5 text-right tnum text-[#6E6E73]">{pct(o.semRetorno, o.disparados)}</td>
											</tr>
										))}
									</tbody>
								</table>
							</div>
						</section>
					)}
				</>
			)}

			{/* Funil de engajamento (links) */}
			{linkTotais.links > 0 && (
				<section className="rounded-2xl bg-white p-6" style={{ boxShadow: '0 0 0 1px #E5E5EA, 0 2px 12px rgba(0,0,0,.04)' }}>
					<h2 className="mb-4 text-[16px] font-semibold text-[#1D1D1F]">Funil de engajamento</h2>
					<div className="space-y-2.5">
						<FunilBar label="Enviados" valor={linkTotais.enviados} total={linkTotais.enviados} cor={cor} />
						<FunilBar label="Entregues" valor={linkTotais.entregues} total={linkTotais.enviados} cor={cor} />
						<FunilBar label="Clicaram" valor={linkTotais.clicaram} total={linkTotais.enviados} cor={cor} />
						<FunilBar label="Responderam" valor={linkTotais.responderam} total={linkTotais.enviados} cor={cor} />
						<FunilBar label="CPC Negócio" valor={linkTotais.cpc_negocio} total={linkTotais.enviados} cor="#1F8A4C" />
					</div>
					<p className="mt-4 text-[13px] text-[#6E6E73]">Cliques no total {num(linkTotais.cliques)} · Links gerados {num(linkTotais.links)}</p>
				</section>
			)}
			{linkTotais.links === 0 && (
				<div className="rounded-2xl bg-[#F5F5F7] px-5 py-4 text-[14px] text-[#6E6E73]">Ligue “Rastrear links” no template ou na campanha para medir os cliques.</div>
			)}

			{/* Tabela por origem */}
			<section className="rounded-2xl bg-white p-5" style={{ boxShadow: '0 0 0 1px #E5E5EA, 0 2px 12px rgba(0,0,0,.04)' }}>
				<div className="mb-4 flex items-center justify-between">
					<h2 className="text-[16px] font-semibold text-[#1D1D1F]">Por origem</h2>
					<button onClick={() => exportarCsv('painel-origem.csv', ['Origem', 'Carregados', 'Disparados', 'Entregues', '% entrega', 'Não entregues', 'CTR', 'Respostas', 'CPC Negócio', 'Conversão'], porOrigem.map(r => [r.origem, r.carregados, r.disparados, r.entregues, pct(r.entregues, r.disparados), r.nao_entregues, pct(r.clicaram, r.entregues), r.respostas, '—', '—']))} className="flex h-9 items-center gap-2 rounded-full border border-[#D2D2D7] px-4 text-[14px] font-medium text-[#1D1D1F] hover:bg-[#F5F5F7]">Exportar CSV</button>
				</div>
				{porOrigem.length === 0 ? <p className="py-6 text-center text-[14px] text-[#8E8E93]">Sem dados no período.</p> : (
					<div className="overflow-x-auto">
						<table className="w-full border-collapse text-[14px]">
							<thead><tr className="border-b border-[#E5E5EA] text-left text-[12px] font-semibold uppercase tracking-wide text-[#8E8E93]">
								<th className="py-2 pr-4">Origem</th><th className="py-2 pr-4 text-right">Carregados</th><th className="py-2 pr-4 text-right">Disparados</th><th className="py-2 pr-4 text-right">Entregues</th><th className="py-2 pr-4 text-right">% entrega</th><th className="py-2 pr-4 text-right">Não entregues</th><th className="py-2 pr-4 text-right">CTR</th>{isRcs && <th className="py-2 pr-4 text-right">Fallback</th>}<th className="py-2 text-right">Respostas</th>
							</tr></thead>
							<tbody>
								{porOrigem.map((r, i) => <tr key={i} className="border-b border-[#F0F0F2]">
									<td className="py-2.5 pr-4 text-[#1D1D1F]">{r.origem}</td>
									<td className="py-2.5 pr-4 text-right tnum">{num(r.carregados)}</td>
									<td className="py-2.5 pr-4 text-right tnum">{num(r.disparados)}</td>
									<td className="py-2.5 pr-4 text-right tnum">{num(r.entregues)}</td>
									<td className="py-2.5 pr-4 text-right tnum">{pct(r.entregues, r.disparados)}</td>
									<td className="py-2.5 pr-4 text-right tnum">{num(r.nao_entregues)}</td>
									<td className="py-2.5 pr-4 text-right tnum">{pct(r.clicaram, r.entregues)}</td>
									{isRcs && <td className="py-2.5 pr-4 text-right tnum">{num(r.fallback)}</td>}
									<td className="py-2.5 text-right tnum">{num(r.respostas)}</td>
								</tr>)}
							</tbody>
						</table>
					</div>
				)}
			</section>
		</div>
	);
}
