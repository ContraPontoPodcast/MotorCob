// Speech Analytics › Visão geral. Só agregados: painel_speech soma no servidor e devolve nulo para grupo < 30
// (a tela inteira ou a célula). Filtros: período, carteira (seletor do topo), origem e persona.
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { ArrowUpRight, Download, Landmark, RefreshCw } from 'lucide-react';
import { Loading, Notice } from '@/components/app-shell';
import { supabase, friendlyError, type Row } from '@/lib/supabase';
import { FRASES, FUNIL, MOTIVOS, OBJECOES, dc, nf, pc, sinal } from '@/lib/speech';
import { Botao, Cartao, Kpi, campoCls, campoStyle } from '@/components/voz/ui';
import { BarraFiltros, Bloqueio, Segmentos, type Filtros } from './comum';
import { BarraH, COR_HUMANO, COR_IA, COR_NEUTRA, Faisca, Halter, Legenda, LinhaSemanas, TabelaSemanas, semanaRotulo } from './graficos';

type Painel = {
	n: number | null; pequeno?: boolean; por_origem?: Record<string, number | null>; identidade_pct?: number | null;
	nota?: number | null; conformidade?: number | null; conversao?: number | null;
	sentimento?: { ini: number; fim: number; melhorou_pct: number | null } | null;
	origens?: Record<string, { n: number | null; nota: number | null; conformidade: number | null; conversao: number | null; sentimento_melhorou: number | null; itens?: Record<string, number | null> | null }>;
	semanas?: { s: string; origem: string; n: number | null; nota: number | null; conformidade: number | null; conversao: number | null; sentimento: number | null }[];
	mapa?: { credor_id: number; credor: string; motivo: string; n: number | null; parte: number | null; conversao: number | null }[];
	funil?: Record<string, number | null>;
	motivos?: { valor: string; n: number | null; parte: number | null; conversao: number | null }[];
	objecoes?: { valor: string; n: number | null; parte: number | null; conversao: number | null }[];
	converte?: { tipo: string; valor: string; com_acordo: number | null; sem_acordo: number | null }[];
	temas?: { id: number; nome: string | null; n: number | null; crescimento: number | null; serie: { s: string; c: number }[] | null }[];
	alertas?: { total: number; abertos: number; vulnerabilidade: number; procon_juridico: number };
};
type Metrica = 'nota' | 'conformidade' | 'conversao' | 'sentimento' | 'n';
const METRICAS: { v: Metrica; n: string; titulo: string; min: number; max: number; ticks: number[]; fmt: (v: number) => string; meta?: number }[] = [
	{ v: 'nota', n: 'Nota', titulo: 'Nota de qualidade (0 a 100)', min: 50, max: 100, ticks: [50, 60, 70, 80, 90, 100], fmt: v => dc(v, 0) },
	{ v: 'conformidade', n: 'Conformidade', titulo: '% em conformidade · a linha tracejada é a meta de 95%', min: 50, max: 100, ticks: [50, 60, 70, 80, 90, 100], fmt: v => `${dc(v, 0)}%`, meta: 95 },
	{ v: 'conversao', n: 'Conversão', titulo: 'Conversão em acordo', min: 0, max: 40, ticks: [0, 10, 20, 30, 40], fmt: v => `${dc(v, 0)}%` },
	{ v: 'sentimento', n: 'Sentimento', titulo: '% com sentimento melhor no fim', min: 0, max: 100, ticks: [0, 25, 50, 75, 100], fmt: v => `${dc(v, 0)}%` },
	{ v: 'n', n: 'Volume', titulo: 'Ligações analisadas por semana', min: 0, max: 0, ticks: [], fmt: v => nf(v) },
];
const CMP_ITENS: [string, string][] = [['ck_cpc', 'Confirmou identidade antes do valor'], ['ck_oferta', 'Ofereceu condição'], ['ck_canais', 'Informou os canais de pagamento']];

function teto(v: number) { const p = 10 ** Math.floor(Math.log10(Math.max(1, v))); const m = v / p; return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10) * p; }

export function Visao({ f, setDias, setOrigem, persona, setPersona }: { f: Filtros; setDias: (d: number) => void; setOrigem: (o: string) => void; persona: string; setPersona: (p: string) => void }) {
	const [p, setP] = useState<Painel | null>(null);
	const [personas, setPersonas] = useState<string[]>([]);
	const [recs, setRecs] = useState(0);
	const [erro, setErro] = useState('');
	const [loading, setLoading] = useState(true);
	const [met, setMet] = useState<Metrica>('nota');
	const [tabTrend, setTabTrend] = useState(false);
	const [heatModo, setHeatModo] = useState<'parte' | 'conversao'>('parte');
	const [tabHeat, setTabHeat] = useState(false);

	useEffect(() => {
		if (!supabase) return;
		const sb = supabase;
		let ativo = true;
		setLoading(true); setErro('');
		(async () => {
			const [r, ps, rc] = await Promise.all([
				sb.rpc('painel_speech', { empresa: f.empresaId, credor: f.credorId, de: f.de, ate: f.ate, origem: f.origem || null, persona: persona || null }),
				sb.from('voz_insights_dia').select('persona').eq('empresa_id', f.empresaId).gte('data', f.de).lte('data', f.ate).eq('campo', 'conversas').limit(2000),
				sb.from('recomendacoes').select('id', { count: 'exact', head: true }).eq('empresa_id', f.empresaId).eq('situacao', 'nova'),
			]);
			if (!ativo) return;
			if (r.error) { setErro(friendlyError(r.error)); setLoading(false); return; }
			setP((r.data ?? { n: null }) as Painel);
			setPersonas([...new Set(((ps.data ?? []) as Row[]).map(x => String(x.persona ?? '')).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt-BR')).slice(0, 20));
			setRecs(rc.count ?? 0);
			setLoading(false);
		})();
		return () => { ativo = false; };
	}, [f.empresaId, f.credorId, f.de, f.ate, f.origem, persona]);

	const semanas = useMemo(() => [...new Set((p?.semanas ?? []).map(s => s.s))].sort(), [p]);
	const serie = (origem: string, k: Metrica) => semanas.map(s => { const x = (p?.semanas ?? []).find(y => y.s === s && y.origem === origem); return x ? (x[k] as number | null) : null; });

	const filtroPersona = (
		<select aria-label="Persona" value={persona} onChange={e => setPersona(e.target.value)} className={`${campoCls} max-w-full`} style={campoStyle}>
			<option value="">Todas as personas</option>
			{personas.map(x => <option key={x} value={x}>{x}</option>)}
		</select>
	);
	const filtros = <BarraFiltros dias={f.dias} setDias={setDias} origem={f.origem} setOrigem={setOrigem} credorNome={f.credorNome} extra={filtroPersona} />;
	if (erro) return <>{filtros}<Notice>{erro}</Notice></>;
	if (loading || !p) return <>{filtros}<Loading /></>;
	if (p.n == null) {
		return (<>{filtros}
			<Bloqueio titulo={p.pequeno ? 'Este recorte tem menos de 30 ligações.' : 'Ainda não há ligações analisadas neste recorte.'}
				acao={(persona || f.origem || f.dias < 90) ? <Botao onClick={() => { setPersona(''); setOrigem(''); setDias(90); }}>Limpar filtros</Botao> : undefined}>
				{p.pequeno ? 'O grupo é pequeno demais: os números poderiam apontar para pessoas. Amplie o período ou tire um filtro.' : 'Os números aparecem quando as ligações transcritas passam pela análise (checklist, códigos e sentimento).'}
			</Bloqueio></>);
	}

	const M = METRICAS.find(x => x.v === met)!;
	const series = [
		...(f.origem !== 'discador' ? [{ nome: 'Agente de IA', cor: COR_IA, valores: serie('ia', met) }] : []),
		...(f.origem !== 'ia' ? [{ nome: 'Humano (discador)', cor: COR_HUMANO, valores: serie('discador', met) }] : []),
	];
	const maxVol = teto(Math.max(1, ...series.flatMap(s => s.valores.filter((v): v is number => v != null))) * 1.05);
	const escala = met === 'n' ? { min: 0, max: maxVol, ticks: [0, maxVol / 4, maxVol / 2, (3 * maxVol) / 4, maxVol] } : M;
	const volTotal = semanas.map(s => (p.semanas ?? []).filter(y => y.s === s).reduce((t, y) => t + (y.n ?? 0), 0));
	const notaS = serie(f.origem || 'ia', 'nota');
	const confS = serie(f.origem || 'ia', 'conformidade');
	const ia = p.origens?.ia, hu = p.origens?.discador;
	const temasTop = (p.motivos ?? []).filter(m => m.conversao != null).slice(0, 4);
	const temaCresce = (p.temas ?? []).find(t => t.crescimento != null && t.nome);
	const objTop = (p.objecoes ?? []).find(o => o.parte != null);

	// mapa motivo × carteira
	const carteiras = [...new Map((p.mapa ?? []).map(m => [m.credor_id, m.credor])).entries()];
	const motivosMapa = [...new Set((p.mapa ?? []).map(m => m.motivo))];
	const celula = (mot: string, cid: number) => (p.mapa ?? []).find(m => m.motivo === mot && m.credor_id === cid);
	const vmax = Math.max(1, ...(p.mapa ?? []).map(m => (heatModo === 'parte' ? m.parte : m.conversao) ?? 0));
	const funilBase = p.funil?.identidade ?? null;
	const baixarCsv = () => {
		const linhas = [['semana', 'origem', 'ligacoes', 'nota', 'conformidade_pct', 'conversao_pct', 'sentimento_melhorou_pct'].join(';'),
			...(p.semanas ?? []).map(s => [s.s, s.origem, s.n ?? '', s.nota ?? '', s.conformidade ?? '', s.conversao ?? '', s.sentimento ?? ''].join(';'))];
		const url = URL.createObjectURL(new Blob([linhas.join('\n')], { type: 'text/csv;charset=utf-8' }));
		const a = document.createElement('a'); a.href = url; a.download = `speech-analytics-semanas-${f.ate}.csv`; a.click();
		window.setTimeout(() => URL.revokeObjectURL(url), 30000);
	};

	return (
		<>
			{filtros}
			<div className="space-y-4">
				<div className="grid gap-3 md:grid-cols-3">
					{temaCresce && <Link to="#temas" className="flex gap-3 rounded-2xl px-4 py-3 text-[13px]" style={{ backgroundColor: 'var(--estado-info-fundo)' }}><ArrowUpRight size={18} className="mt-0.5 shrink-0 text-[var(--estado-info)]" /><span><b className="block text-[var(--base-texto)]">"{temaCresce.nome}" {temaCresce.crescimento! >= 0 ? 'cresceu' : 'caiu'} {dc(Math.abs(temaCresce.crescimento!), 0)}% em 4 semanas</b><span className="text-[var(--base-texto-2)]">{nf(temaCresce.n)} conversas. Ver temas emergentes.</span></span></Link>}
					{objTop && <Link to="/speech-analytics/retroalimentacao?para=credor" className="flex gap-3 rounded-2xl px-4 py-3 text-[13px]" style={{ backgroundColor: 'var(--estado-info-fundo)' }}><Landmark size={18} className="mt-0.5 shrink-0 text-[var(--estado-info)]" /><span><b className="block text-[var(--base-texto)]">{pc(objTop.parte, 0)} das objeções: {(OBJECOES[objTop.valor] ?? objTop.valor).toLowerCase()}</b><span className="text-[var(--base-texto-2)]">Entra no relatório ao credor.</span></span></Link>}
					<Link to="/speech-analytics/retroalimentacao" className="flex gap-3 rounded-2xl px-4 py-3 text-[13px]" style={{ backgroundColor: 'var(--estado-info-fundo)' }}><RefreshCw size={18} className="mt-0.5 shrink-0 text-[var(--estado-info)]" /><span><b className="block text-[var(--base-texto)]">{recs} {recs === 1 ? 'recomendação' : 'recomendações'} para a estratégia</b><span className="text-[var(--base-texto-2)]">Nada muda sem vocês aprovarem.</span></span></Link>
				</div>

				<div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
					<Kpi rotulo={`Ligações analisadas · últimos ${f.dias} dias`} valor={nf(p.n)} detalhe={<>{p.por_origem ? `${nf(p.por_origem.ia ?? null)} da IA · ${p.por_origem.discador == null ? 'menos de 30' : nf(p.por_origem.discador)} do discador` : ''}{p.identidade_pct != null ? ` · ${pc(p.identidade_pct, 0)} com identidade confirmada` : ''}</>}><Faisca valores={volTotal} /></Kpi>
					<Kpi rotulo="Nota média de qualidade" valor={<>{dc(p.nota)} <small className="text-[13px] font-medium text-[var(--base-texto-3)]">de 100</small></>} detalhe={notaS.filter(v => v != null).length > 1 ? `${sinal((notaS.filter(v => v != null).at(-1) as number) - (notaS.find(v => v != null) as number))} em 12 semanas` : undefined}><Faisca valores={notaS} /></Kpi>
					<Kpi rotulo="Em conformidade" valor={pc(p.conformidade)} detalhe="sem item bloqueante reprovado · meta 95%"><Faisca valores={confS} /></Kpi>
					<Kpi rotulo="Alertas" valor={nf(p.alertas?.total ?? 0)} detalhe={<><b className="text-[var(--estado-erro-texto)]">{nf(p.alertas?.abertos ?? 0)}</b> sem revisão · vulnerabilidade {nf(p.alertas?.vulnerabilidade ?? 0)} (só sinaliza) · Procon e jurídico {nf(p.alertas?.procon_juridico ?? 0)}</>} />
					<Kpi rotulo="Conversão por tema" valor={<>{pc(p.conversao)} <small className="text-[13px] font-medium text-[var(--base-texto-3)]">geral</small></>}>
						<div className="mt-1">{temasTop.map(t => <BarraH key={t.valor} nome={MOTIVOS[t.valor] ?? t.valor} valor={t.conversao} max={Math.max(1, ...temasTop.map(x => x.conversao ?? 0))} />)}</div>
					</Kpi>
					<Kpi rotulo="Sentimento médio, do início ao fim" valor={p.sentimento ? `${sinal(p.sentimento.ini, 2)} → ${sinal(p.sentimento.fim, 2)}` : 'menos de 30'} detalhe={p.sentimento ? `escala de −1 a +1 · ${pc(p.sentimento.melhorou_pct, 0)} melhoraram` : undefined} />
				</div>

				<div className="grid gap-4 lg:grid-cols-2">
					<Cartao titulo="Tendência por semana" linha="12 semanas completas, IA e humano" direita={<><Segmentos rotulo="Ver como" itens={[{ v: 'g', n: 'Gráfico' }, { v: 't', n: 'Tabela' }]} valor={tabTrend ? 't' : 'g'} onTrocar={v => setTabTrend(v === 't')} /><button type="button" onClick={baixarCsv} className="inline-flex items-center gap-1 text-[12.5px] font-semibold text-[var(--base-texto-2)] hover:text-[var(--base-texto)]"><Download size={14} />CSV</button></>}>
						<div className="mb-2"><Segmentos rotulo="Métrica" itens={METRICAS.map(m => ({ v: m.v, n: m.n }))} valor={met} onTrocar={setMet} /></div>
						{series.length > 1 && <Legenda itens={series.map(s => ({ nome: s.nome, cor: s.cor, linha: true }))} />}
						<p className="my-1 text-[12px] text-[var(--base-texto-3)]">{M.titulo}</p>
						{semanas.length === 0 ? <p className="text-[13px] text-[var(--base-texto-2)]">Ainda sem semana completa.</p> : tabTrend ? <TabelaSemanas x={semanas.map(semanaRotulo)} series={series} fmt={M.fmt} /> : <LinhaSemanas x={semanas.map(semanaRotulo)} series={series} {...escala} fmt={M.fmt} meta={M.meta} rotulo={M.titulo} />}
					</Cartao>
					<Cartao titulo="IA × humano" linha="Mesmo checklist, mesma escala de 0 a 100">
						<Legenda itens={[{ nome: 'Agente de IA', cor: COR_IA }, { nome: 'Humano (discador)', cor: COR_HUMANO }]} />
						<div className="mt-2">
							<Halter nome="Nota de qualidade" sub="0 a 100" a={ia?.nota ?? null} b={hu?.nota ?? null} />
							{CMP_ITENS.map(([k, n]) => <Halter key={k} nome={n} sub="% das ligações" a={ia?.itens?.[k] ?? null} b={hu?.itens?.[k] ?? null} />)}
							<Halter nome="Sentimento melhorou no fim" sub="% das ligações" a={ia?.sentimento_melhorou ?? null} b={hu?.sentimento_melhorou ?? null} />
							<Halter nome="Conversão em acordo" sub="% das conversas" a={ia?.conversao ?? null} b={hu?.conversao ?? null} />
						</div>
						<p className="mt-2 text-[12px] text-[var(--base-texto-3)]">O humano recebe a ligação já transferida (a pessoa quis negociar ou pediu atendente): a conversão maior não quer dizer que ele vende melhor.</p>
					</Cartao>
				</div>

				<div className="grid gap-4 lg:grid-cols-2">
					<Cartao titulo="Motivo × carteira" direita={<Segmentos rotulo="Ver como" itens={[{ v: 'm', n: 'Mapa' }, { v: 't', n: 'Tabela' }]} valor={tabHeat ? 't' : 'm'} onTrocar={v => setTabHeat(v === 't')} />}>
						<div className="mb-3"><Segmentos rotulo="Valor" itens={[{ v: 'parte', n: '% das conversas' }, { v: 'conversao', n: 'Conversão em acordo' }]} valor={heatModo} onTrocar={setHeatModo} /></div>
						{carteiras.length === 0 ? <p className="text-[13px] text-[var(--base-texto-2)]">Sem motivos registrados no período.</p> : (
							<div className="overflow-x-auto">
								<table className="w-full border-separate text-[12.5px]" style={{ borderSpacing: 3 }}>
									<thead><tr><th className="text-left font-semibold text-[var(--base-texto-3)]" />{carteiras.map(([id, nome]) => <th key={id} className={`px-1 text-center font-semibold ${f.credorId === id ? 'text-[var(--base-texto)]' : 'text-[var(--base-texto-3)]'}`}>{nome}</th>)}</tr></thead>
									<tbody>{motivosMapa.map(mot => (
										<tr key={mot}><td className="whitespace-nowrap pr-2 text-[var(--base-texto)]">{MOTIVOS[mot] ?? mot}</td>
											{carteiras.map(([id, nome]) => {
												const c = celula(mot, id); const v = c ? (heatModo === 'parte' ? c.parte : c.conversao) : null;
												if (tabHeat) return <td key={id} className="text-right tnum">{v == null ? '<30' : `${dc(v)}%`}</td>;
												if (v == null) return <td key={id} title={`${MOTIVOS[mot] ?? mot} · ${nome}: menos de 30 ligações, não exibido`} className="rounded-md text-center text-[11px] text-[var(--base-texto-3)]" style={{ background: 'repeating-linear-gradient(45deg, var(--base-fill), var(--base-fill) 4px, var(--base-cartao) 4px, var(--base-cartao) 8px)' }}>&lt;30</td>;
												const tom = Math.round(10 + 80 * (v / vmax));
												return <td key={id} title={`${MOTIVOS[mot] ?? mot} · ${nome}: ${dc(v)}% · ${nf(c?.n)} ligações`} className="rounded-md px-1 py-1.5 text-center font-semibold tnum" style={{ background: `color-mix(in oklab, ${COR_IA} ${tom}%, var(--base-cartao))`, color: tom > 55 ? 'var(--base-cartao)' : 'var(--base-texto)' }}>{dc(v, 0)}%</td>;
											})}</tr>
									))}</tbody>
								</table>
							</div>
						)}
						<p className="mt-2 text-[12px] text-[var(--base-texto-3)]">Hachurado: menos de 30 ligações. "Contesta" e "não reconhece" altos numa carteira são sinal de cadastro a revisar com o credor.</p>
					</Cartao>
					<Cartao titulo="Funil objeção → oferta → acordo" linha="Base: conversas com identidade confirmada">
						{FUNIL.map((e, i) => { const v = p.funil?.[e.id] ?? null; const ant = i ? p.funil?.[FUNIL[i - 1].id] ?? null : null; return (
							<BarraH key={e.id} nome={e.nome} valor={v} max={funilBase ?? 1} cor={`color-mix(in oklab, ${COR_IA} ${100 - i * 12}%, var(--base-cartao))`} fmt={x => nf(x)} detalhe={i && v != null && ant ? `${dc((100 * v) / ant, 0)}%` : undefined} />); })}
						<h3 className="mb-1 mt-4 text-[13px] font-semibold text-[var(--base-texto)]">Por objeção <small className="font-normal text-[var(--base-texto-3)]">· parte das objeções e conversão até acordo</small></h3>
						{(p.objecoes ?? []).map(o => <BarraH key={o.valor} nome={`${OBJECOES[o.valor] ?? o.valor}${o.parte != null ? ` · ${dc(o.parte, 0)}%` : ''}`} valor={o.conversao} max={Math.max(1, ...(p.objecoes ?? []).map(x => x.conversao ?? 0))} cor={COR_NEUTRA} detalhe="viram acordo" />)}
					</Cartao>
				</div>

				<div className="grid gap-4 lg:grid-cols-2">
					<Cartao titulo="O que converte" linha="Frases e ofertas: quanto aparecem nas ligações com acordo e sem acordo">
						<Legenda itens={[{ nome: 'Com acordo', cor: COR_IA }, { nome: 'Sem acordo', cor: COR_NEUTRA }]} />
						{(p.converte ?? []).length === 0 ? <p className="mt-2 text-[13px] text-[var(--base-texto-2)]">Sem frase ou oferta com 30 ligações ou mais.</p> : (p.converte ?? []).map(c => (
							<Halter key={c.tipo + c.valor} nome={c.tipo === 'frase' ? FRASES[c.valor] ?? c.valor : c.valor.toUpperCase()} sub={c.tipo === 'frase' ? 'Frase' : 'Oferta'} a={c.com_acordo} b={c.sem_acordo} corA={COR_IA} corB={COR_NEUTRA}
								texto={c.com_acordo != null && c.sem_acordo ? <><b className="text-[var(--base-texto)]">{dc(c.com_acordo / c.sem_acordo)}×</b> · {dc(c.com_acordo, 0)}% × {dc(c.sem_acordo, 0)}%</> : undefined} />
						))}
						<p className="mt-2 text-[12px] text-[var(--base-texto-3)]">Associação, não causa: quem já queria pagar também ouve mais o resumo do acordo. Por isso cada frase vira recomendação com teste, não regra.</p>
					</Cartao>
					<Cartao id="temas" titulo="Temas emergentes" linha="Crescimento nas últimas 4 semanas × 4 anteriores">
						{(p.temas ?? []).length === 0 ? <p className="text-[13px] text-[var(--base-texto-2)]">Nenhum tema novo no período.</p> : (p.temas ?? []).slice(0, 8).map(t => (
							<div key={t.id} className="grid grid-cols-[minmax(0,1fr)_80px_auto] items-center gap-3 border-b py-2 text-[13px] last:border-0" style={{ borderColor: 'var(--base-borda)' }}>
								<span className="min-w-0"><b className="block truncate font-semibold text-[var(--base-texto)]">{t.nome ?? 'Tema sem nome (na Curadoria)'}</b><small className="text-[var(--base-texto-3)]">{t.n == null ? 'menos de 30 conversas' : `${nf(t.n)} conversas`}</small></span>
								<Faisca valores={(t.serie ?? []).map(x => x.c)} />
								<span className="whitespace-nowrap text-right font-semibold tnum" style={{ color: (t.crescimento ?? 0) >= 0 ? 'var(--estado-erro-texto)' : 'var(--estado-pronto-texto)' }}>{t.crescimento == null ? '—' : `${sinal(t.crescimento, 0)}%`}</span>
							</div>
						))}
						<p className="mt-2 text-[12px] text-[var(--base-texto-3)]">Temas saem do agrupamento dos trechos mascarados. Tema novo só ganha nome na Curadoria.</p>
					</Cartao>
				</div>
			</div>
		</>
	);
}
