import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { Empty, Loading, Notice } from '@/components/app-shell';
import { useJornadaCarteira, JornadaHeading, SemCarteiraCard } from '@/components/jornada/jornada-shell';
import { dateBR, friendlyError, moneyBR, numberBR } from '@/lib/supabase';
import { canalMeta, periodoAnterior } from '@/lib/acoes';
import { CANAL_NOME, MOMENTOS, MOMENTO_NOME } from '@/lib/jornada';
import {
	PERIODOS, calcularSugestao, fetchFrases, fetchMapa, fetchMovimento, fetchResultado, fetchTaxaPorDia, pct1, periodoDe,
	porCanal, taxaDe, totais, type FraseResultado, type MapaMomento, type ResultadoCanal,
} from '@/lib/jornada-resultado';

const cartao = { boxShadow: '0 0 0 1px var(--base-borda), 0 2px 12px rgba(0,0,0,.04)' };
const DISPENSA_DIAS = 30;
const chaveDispensa = (carteiraId: string) => `mc.jornada.sugestao.${carteiraId}`;

function dispensada(carteiraId: string): boolean {
	try {
		const v = Number(localStorage.getItem(chaveDispensa(carteiraId)) ?? 0);
		return v > 0 && Date.now() - v < DISPENSA_DIAS * 86400000;
	} catch { return false; }
}

function Titulo({ children, linha, extra }: { children: string; linha?: string; extra?: ReactNode }) {
	return (
		<div className="mb-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
			<h2 className="text-[12.5px] font-bold uppercase tracking-wide text-[#8E8E93]">{children}</h2>
			{linha && <p className="text-[12.5px] text-[#6E6E73]">{linha}</p>}
			{extra && <div className="ml-auto">{extra}</div>}
		</div>
	);
}

function Canal({ c }: { c: string }) {
	return (
		<span className="inline-flex items-center gap-1.5">
			<i className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: canalMeta[c]?.cor ?? '#8E8E93' }} />
			{CANAL_NOME[c] ?? canalMeta[c]?.nome ?? c}
		</span>
	);
}

function Variacao({ v, sufixo, bomQuandoSobe }: { v: number | null; sufixo: string; bomQuandoSobe: boolean }) {
	if (v == null || !Number.isFinite(v)) return null;
	const txt = `${v > 0 ? '+' : ''}${v.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}${sufixo}`;
	const bom = v === 0 ? null : (v > 0) === bomQuandoSobe;
	return <b style={{ color: bom == null ? 'inherit' : bom ? 'var(--estado-pronto-texto)' : 'var(--estado-erro-texto)' }}>{txt}</b>;
}

/** Série da taxa de resultado por dia (todos os momentos). Dia sem resultado fechado não entra. */
function Serie({ pontos }: { pontos: { data: string; taxa: number | null }[] }) {
	const validos = pontos.map((p, i) => ({ ...p, i })).filter(p => p.taxa != null) as { data: string; taxa: number; i: number }[];
	if (validos.length < 2) return <p className="py-8 text-center text-[13px] text-[#8E8E93]">Ainda sem resultados fechados por dia neste período.</p>;
	const W = 600, H = 150;
	const min = Math.floor(Math.min(...validos.map(p => p.taxa)) - 2);
	const max = Math.ceil(Math.max(...validos.map(p => p.taxa)) + 2);
	const x = (i: number) => 34 + (i * (W - 44)) / Math.max(1, pontos.length - 1);
	const y = (v: number) => 130 - ((v - min) * 115) / Math.max(1, max - min);
	const d = validos.map((p, k) => `${k ? 'L' : 'M'}${x(p.i).toFixed(1)} ${y(p.taxa).toFixed(1)}`).join(' ');
	const ult = validos[validos.length - 1];
	return (
		<svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="block h-[150px] w-full" role="img"
			aria-label={`Taxa de resultado de ${pct1(Math.min(...validos.map(p => p.taxa)))} a ${pct1(Math.max(...validos.map(p => p.taxa)))} no período; no último dia, ${pct1(ult.taxa)}.`}>
			<line x1="34" y1="130" x2={W - 10} y2="130" stroke="var(--base-borda)" strokeWidth="1" />
			<line x1="34" y1={y(max - 2)} x2={W - 10} y2={y(max - 2)} stroke="var(--base-borda)" strokeWidth="1" strokeDasharray="3 4" />
			<text x="0" y={y(max - 2) + 3} fontSize="10" fill="var(--base-texto-3)">{`${max - 2}%`}</text>
			<text x="0" y="133" fontSize="10" fill="var(--base-texto-3)">{`${min}%`}</text>
			<path d={`${d} L${x(ult.i)} 130 L${x(validos[0].i)} 130 Z`} fill="var(--area)" opacity="0.12" />
			<path d={d} fill="none" stroke="var(--area)" strokeWidth="2" vectorEffect="non-scaling-stroke" />
		</svg>
	);
}

export function JornadaPainel() {
	const { empresa, carteiras, carteira, loading: cLoading } = useJornadaCarteira();
	const [periodo, setPeriodo] = useState<string>('30');
	const [momentoTab, setMomentoTab] = useState('');
	const [mapa, setMapa] = useState<MapaMomento[]>([]);
	const [mapaAnt, setMapaAnt] = useState<MapaMomento[]>([]);
	const [res, setRes] = useState<ResultadoCanal[]>([]);
	const [serie, setSerie] = useState<{ data: string; taxa: number | null }[]>([]);
	const [mov, setMov] = useState<Record<string, number>>({});
	const [frases, setFrases] = useState<FraseResultado[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState('');
	const [semSugestao, setSemSugestao] = useState(false);

	const dias = PERIODOS.find(p => p.id === periodo)?.dias ?? 30;
	const p = useMemo(() => periodoDe(dias), [dias]);

	useEffect(() => {
		if (!empresa || !carteira) { setLoading(false); return; }
		let active = true;
		setLoading(true); setError('');
		const ant = periodoAnterior(p);
		Promise.all([
			fetchMapa(carteira.id, p), fetchMapa(carteira.id, ant), fetchResultado(carteira.id, p),
			fetchTaxaPorDia(empresa.id, carteira.id, p), fetchMovimento(empresa.id, carteira.id, p),
			fetchFrases(empresa.id, carteira.id, p).catch(() => [] as FraseResultado[]),
		]).then(([m, ma, r, s, mv, f]) => {
			if (!active) return;
			setMapa(m); setMapaAnt(ma); setRes(r); setSerie(s); setMov(mv); setFrases(f); setLoading(false);
		}).catch(() => { if (active) { setError(friendlyError()); setLoading(false); } });
		return () => { active = false; };
	}, [empresa?.id, carteira?.id, p]);

	useEffect(() => { setSemSugestao(carteira ? dispensada(carteira.id) : false); }, [carteira?.id]);

	const t = useMemo(() => totais(mapa, res), [mapa, res]);
	const tAnt = useMemo(() => totais(mapaAnt, []), [mapaAnt]);
	const taxa = taxaDe(t.sucesso, t.fechados);
	const taxaAnt = taxaDe(tAnt.sucesso, tAnt.fechados);
	const canais = useMemo(() => porCanal(momentoTab ? res.filter(r => r.momento === momentoTab) : res), [res, momentoTab]);
	const sugestao = useMemo(() => calcularSugestao(res), [res]);

	if (cLoading) return <div className="mc-platform"><Loading /></div>;
	if (carteiras.length === 0) return <><JornadaHeading title="Painel" /><SemCarteiraCard /></>;
	if (!carteira) return <div className="mc-platform"><Loading /></div>;

	const seletor = (
		<div role="group" aria-label="Período" className="inline-flex gap-0.5 rounded-[9px] bg-[#F2F2F7] p-0.5">
			{PERIODOS.map(o => (
				<button key={o.id} type="button" aria-pressed={periodo === o.id} onClick={() => setPeriodo(o.id)}
					className={`rounded-[7px] px-2.5 py-1 text-[12.5px] font-semibold ${periodo === o.id ? 'bg-white text-[#1D1D1F] shadow-[0_1px_2px_rgba(0,0,0,0.08)]' : 'text-[#6E6E73]'}`}>
					{o.nome}
				</button>
			))}
		</div>
	);

	const cpr = t.sucesso > 0 ? t.custo / t.sucesso : null;
	const maxT = Math.max(1, ...MOMENTOS.map(m => { const x = mapa.find(r => r.momento === m.id); return x ? x.sucesso + x.nao + x.cobranca : 0; }));
	const totCanais = canais.reduce((a, r) => ({ ac: a.ac + r.acionamentos, s: a.s + r.sucesso, f: a.f + r.sucesso + r.nao, c: a.c + r.custo }), { ac: 0, s: 0, f: 0, c: 0 });
	const vazio = !loading && t.fechados === 0 && t.acionamentos === 0 && t.noJornada === 0;

	const fluxos: { de: string; v: number; tom?: 'bom' | 'ruim' }[] = [
		{ de: 'Novos (carga) → Boas-vindas', v: mov['entrada>boas_vindas'] ?? 0 },
		{ de: 'Ativação → ativou', v: mapa.find(m => m.momento === 'ativacao')?.sucesso ?? 0, tom: 'bom' },
		{ de: 'Retenção e Reativação → voltou a usar', v: (mov['retencao>voltou_a_usar'] ?? 0) + (mov['reativacao>voltou_a_usar'] ?? 0), tom: 'bom' },
		{ de: 'Ativação → Retenção', v: mov['ativacao>retencao'] ?? 0 },
		{ de: 'Retenção → Reativação', v: mov['retencao>reativacao'] ?? 0 },
		{ de: 'Qualquer momento → cobrança', v: Object.entries(mov).filter(([k]) => k.endsWith('>cobranca')).reduce((s, [, v]) => s + v, 0), tom: 'ruim' },
	];

	function dispensar() {
		if (!carteira) return;
		try { localStorage.setItem(chaveDispensa(carteira.id), String(Date.now())); } catch { /* sem armazenamento: some só agora */ }
		setSemSugestao(true);
	}

	return (
		<>
			<JornadaHeading title="Painel" linha={`Resultado da jornada · ${carteira.nome} · até ${dateBR(p.ate)}`} actions={seletor} />
			{error && <div className="mb-5"><Notice>{error}</Notice></div>}
			{loading ? <Loading /> : vazio ? (
				<Empty>Ainda sem resultado nesta carteira. O Painel enche depois das primeiras rodadas da jornada.</Empty>
			) : (
				<div className="flex flex-col gap-[18px]">
					<div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
						<div className="rounded-2xl bg-white p-4" style={cartao}>
							<p className="text-[12px] text-[#6E6E73]">Clientes na jornada hoje</p>
							<p className="mt-1 text-[26px] font-bold tracking-tight text-[#1D1D1F] tnum">{numberBR(t.noJornada)}</p>
							<p className="mt-0.5 text-[12px] text-[#6E6E73]">em {MOMENTOS.length} momentos</p>
						</div>
						<div className="rounded-2xl bg-white p-4" style={cartao}>
							<p className="text-[12px] text-[#6E6E73]">Deu certo</p>
							<p className="mt-1 text-[26px] font-bold tracking-tight text-[#1D1D1F] tnum">{numberBR(t.sucesso)}</p>
							<p className="mt-0.5 text-[12px] text-[#6E6E73]">taxa de {pct1(taxa)}{taxa != null && taxaAnt != null && <> · <Variacao v={Math.round((taxa - taxaAnt) * 10) / 10} sufixo=" p.p." bomQuandoSobe /> sobre o período anterior</>}</p>
						</div>
						<div className="rounded-2xl bg-white p-4" style={cartao}>
							<p className="text-[12px] text-[#6E6E73]">Custo por resultado</p>
							<p className="mt-1 text-[26px] font-bold tracking-tight text-[#1D1D1F] tnum">{cpr == null ? '—' : moneyBR(cpr)}</p>
							<p className="mt-0.5 text-[12px] text-[#6E6E73]">{moneyBR(t.custo)} no período</p>
						</div>
						<div className="rounded-2xl bg-white p-4" style={cartao}>
							<p className="text-[12px] text-[#6E6E73]">Foram para a cobrança</p>
							<p className="mt-1 text-[26px] font-bold tracking-tight text-[#1D1D1F] tnum">{numberBR(t.cobranca)}</p>
							<p className="mt-0.5 text-[12px] text-[#6E6E73]">entraram em atraso · <Variacao v={t.cobranca - tAnt.cobranca} sufixo="" bomQuandoSobe={false} /> sobre o anterior</p>
						</div>
					</div>

					{sugestao && !semSugestao && (
						<div role="note" className="flex items-start gap-3 rounded-[14px] px-4 py-3.5 text-[13px] text-[#1D1D1F]" style={{ backgroundColor: 'var(--estado-info-fundo)' }}>
							<span className="grid h-[22px] w-[22px] shrink-0 place-items-center rounded-full text-[12px] font-extrabold" style={{ backgroundColor: 'var(--estado-info)', color: 'var(--base-cartao)' }}>i</span>
							<div>
								<b className="mb-0.5 block">Sugestão: no {MOMENTO_NOME[sugestao.momento]}, o {CANAL_NOME[sugestao.barato.canal] ?? sugestao.barato.canal} entrega {pct1((100 * sugestao.barato.sucesso) / (sugestao.barato.sucesso + sugestao.barato.nao))} de resultado a {moneyBR(sugestao.barato.custo / sugestao.barato.sucesso)} cada; o {CANAL_NOME[sugestao.caro.canal] ?? sugestao.caro.canal}, {pct1((100 * sugestao.caro.sucesso) / (sugestao.caro.sucesso + sugestao.caro.nao))} a {moneyBR(sugestao.caro.custo / sugestao.caro.sucesso)}.</b>
								Se fizer sentido para vocês, dá para testar o {CANAL_NOME[sugestao.barato.canal] ?? sugestao.barato.canal} em um dos passos deste momento e guardar o {CANAL_NOME[sugestao.caro.canal] ?? sugestao.caro.canal} para os outros. Quem decide é você; nada muda sozinho.
								<div className="mt-2.5 flex flex-wrap gap-2">
									<Link to={`/jornada/momentos?carteira=${encodeURIComponent(carteira.codigo)}`} className="inline-flex h-[30px] items-center rounded-full bg-[#1D1D1F] px-3 text-[12.5px] font-semibold text-white">Abrir Momentos e fases</Link>
									<button type="button" onClick={dispensar} className="inline-flex h-[30px] items-center rounded-full border border-[#D2D2D7] px-3 text-[12.5px] font-semibold text-[#1D1D1F]">Dispensar</button>
								</div>
							</div>
						</div>
					)}

					<div className="grid gap-4 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
						<section className="min-w-0 rounded-2xl bg-white p-4 sm:px-[18px]" style={cartao}>
							<Titulo linha={'O que conta como "deu certo" muda por momento: pagou até o vencimento, ativou, voltou a usar.'}>Resultado por momento</Titulo>
							{MOMENTOS.map(m => {
								const x = mapa.find(r => r.momento === m.id);
								const s = x?.sucesso ?? 0, n = x?.nao ?? 0, c = x?.cobranca ?? 0, tot = s + n + c;
								return (
									<div key={m.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2.5 gap-y-1 py-1.5 text-[13px] sm:grid-cols-[120px_minmax(0,1fr)_130px]">
										<span className="text-[#1D1D1F]">{m.nome}</span>
										<span className="col-span-2 row-start-2 flex h-2.5 overflow-hidden rounded-full bg-[#F2F2F7] sm:col-span-1 sm:row-start-auto" style={{ width: `${Math.max(30, (100 * tot) / maxT)}%` }}>
											{tot > 0 && <>
												<i className="block h-full" style={{ width: `${(100 * s) / tot}%`, backgroundColor: 'var(--area)' }} />
												<i className="block h-full" style={{ width: `${(100 * n) / tot}%`, backgroundColor: 'var(--base-texto-3)', opacity: 0.45 }} />
												<i className="block h-full" style={{ width: `${(100 * c) / tot}%`, backgroundColor: 'var(--estado-erro)', opacity: 0.7 }} />
											</>}
										</span>
										<b className="text-right text-[12.5px] text-[#1D1D1F] tnum">{pct1(taxaDe(s, s + n))} <small className="font-medium text-[#6E6E73]">de {numberBR(s + n)}</small></b>
									</div>
								);
							})}
							<div className="mt-2 flex flex-wrap gap-3.5 text-[11.5px] text-[#6E6E73]">
								<span className="inline-flex items-center gap-1.5"><i className="inline-block h-2.5 w-2.5 rounded-[3px]" style={{ backgroundColor: 'var(--area)' }} />Deu certo</span>
								<span className="inline-flex items-center gap-1.5"><i className="inline-block h-2.5 w-2.5 rounded-[3px]" style={{ backgroundColor: 'var(--base-texto-3)', opacity: 0.45 }} />Não deu certo</span>
								<span className="inline-flex items-center gap-1.5"><i className="inline-block h-2.5 w-2.5 rounded-[3px]" style={{ backgroundColor: 'var(--estado-erro)', opacity: 0.7 }} />Foi para a cobrança</span>
							</div>
						</section>
						<section className="min-w-0 rounded-2xl bg-white p-4 sm:px-[18px]" style={cartao}>
							<Titulo linha="Todos os momentos">Taxa de resultado por dia</Titulo>
							<Serie pontos={serie} />
						</section>
					</div>

					<section className="min-w-0 rounded-2xl bg-white" style={cartao}>
						<div className="px-4 pb-1.5 pt-4 sm:px-[18px]">
							<Titulo linha="Quantas ações a jornada mandou fazer, o que deu certo e quanto custou." extra={
								<select aria-label="Momento" value={momentoTab} onChange={e => setMomentoTab(e.target.value)} className="h-8 rounded-[9px] border border-[#D2D2D7] bg-white px-2 text-[12.5px] outline-none">
									<option value="">Todos os momentos</option>
									{MOMENTOS.map(m => <option key={m.id} value={m.id}>{m.nome}</option>)}
								</select>
							}>Ações por canal</Titulo>
						</div>
						{canais.length === 0 ? <p className="px-5 pb-6 text-[13px] text-[#8E8E93]">Sem ações neste período.</p> : (
							<div className="overflow-x-auto">
								<table className="w-full min-w-[620px] border-collapse text-[13px]">
									<thead>
										<tr className="border-b border-[#E5E5EA] text-left text-[11px] uppercase tracking-wide text-[#8E8E93]">
											<th className="px-3.5 py-2.5 font-semibold sm:px-[18px]">Canal</th>
											<th className="px-3.5 py-2.5 text-right font-semibold">Ações</th>
											<th className="px-3.5 py-2.5 text-right font-semibold">Deu certo</th>
											<th className="px-3.5 py-2.5 text-right font-semibold">Taxa</th>
											<th className="px-3.5 py-2.5 text-right font-semibold">Custo</th>
											<th className="px-3.5 py-2.5 text-right font-semibold sm:pr-[18px]">Custo por resultado</th>
										</tr>
									</thead>
									<tbody className="divide-y divide-[color:var(--base-separator)] text-[#6E6E73]">
										{canais.map(r => (
											<tr key={r.canal}>
												<td className="px-3.5 py-2.5 font-semibold text-[#1D1D1F] sm:px-[18px]"><Canal c={r.canal} /></td>
												<td className="px-3.5 py-2.5 text-right tnum">{numberBR(r.acionamentos)}</td>
												<td className="px-3.5 py-2.5 text-right tnum">{numberBR(r.sucesso)}</td>
												<td className="px-3.5 py-2.5 text-right tnum">{pct1(taxaDe(r.sucesso, r.sucesso + r.nao))}</td>
												<td className="px-3.5 py-2.5 text-right tnum">{moneyBR(r.custo)}</td>
												<td className="px-3.5 py-2.5 text-right tnum sm:pr-[18px]">{r.sucesso > 0 ? moneyBR(r.custo / r.sucesso) : '—'}</td>
											</tr>
										))}
									</tbody>
									<tfoot>
										<tr className="border-t border-[#E5E5EA] font-bold text-[#1D1D1F]">
											<td className="px-3.5 py-2.5 sm:px-[18px]">Total</td>
											<td className="px-3.5 py-2.5 text-right tnum">{numberBR(totCanais.ac)}</td>
											<td className="px-3.5 py-2.5 text-right tnum">{numberBR(totCanais.s)}</td>
											<td className="px-3.5 py-2.5 text-right tnum">{pct1(taxaDe(totCanais.s, totCanais.f))}</td>
											<td className="px-3.5 py-2.5 text-right tnum">{moneyBR(totCanais.c)}</td>
											<td className="px-3.5 py-2.5 text-right tnum sm:pr-[18px]">{totCanais.s > 0 ? moneyBR(totCanais.c / totCanais.s) : '—'}</td>
										</tr>
									</tfoot>
								</table>
							</div>
						)}
					</section>

					<div className="grid gap-4 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
						<section className="min-w-0 rounded-2xl bg-white" style={cartao}>
							<div className="px-4 pb-1.5 pt-4 sm:px-[18px]"><Titulo>Mensagens que mais dão resultado</Titulo></div>
							{frases.length === 0 ? <p className="px-5 pb-6 text-[13px] text-[#8E8E93]">Sem mensagens com resultado neste período.</p> : (
								<div className="overflow-x-auto">
									<table className="w-full min-w-[520px] border-collapse text-[13px]">
										<thead>
											<tr className="border-b border-[#E5E5EA] text-left text-[11px] uppercase tracking-wide text-[#8E8E93]">
												<th className="px-3.5 py-2.5 font-semibold sm:px-[18px]">Mensagem</th>
												<th className="px-3.5 py-2.5 font-semibold">Momento</th>
												<th className="px-3.5 py-2.5 font-semibold">Canal</th>
												<th className="px-3.5 py-2.5 text-right font-semibold sm:pr-[18px]">Taxa</th>
											</tr>
										</thead>
										<tbody className="divide-y divide-[color:var(--base-separator)] text-[#6E6E73]">
											{frases.map((f, i) => (
												<tr key={i}>
													<td className="min-w-[220px] px-3.5 py-2.5 font-medium text-[#1D1D1F] sm:px-[18px]">{f.texto}</td>
													<td className="whitespace-nowrap px-3.5 py-2.5">{MOMENTO_NOME[f.momento] ?? f.momento}</td>
													<td className="whitespace-nowrap px-3.5 py-2.5"><Canal c={f.canal} /></td>
													<td className="px-3.5 py-2.5 text-right tnum sm:pr-[18px]">{pct1(f.taxa)}</td>
												</tr>
											))}
										</tbody>
									</table>
								</div>
							)}
						</section>
						<section className="min-w-0 rounded-2xl bg-white p-4 sm:px-[18px]" style={cartao}>
							<Titulo linha="Clientes que mudaram de momento no período.">Movimento entre momentos</Titulo>
							<div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3 lg:grid-cols-2 xl:grid-cols-3">
								{fluxos.map(f => (
									<div key={f.de} className="rounded-xl border border-[#E5E5EA] px-3 py-2.5 text-[12.5px]">
										<div className="text-[#6E6E73]">{f.de}</div>
										<div className="text-[18px] font-bold tnum" style={{ color: f.tom === 'bom' ? 'var(--estado-pronto-texto)' : f.tom === 'ruim' ? 'var(--estado-erro-texto)' : 'var(--base-texto)' }}>{numberBR(f.v)}</div>
									</div>
								))}
							</div>
						</section>
					</div>
				</div>
			)}
		</>
	);
}
