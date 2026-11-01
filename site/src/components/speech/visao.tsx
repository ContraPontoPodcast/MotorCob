// Speech Analytics › Visão geral. Só agregados: painel_speech soma no servidor e devolve nulo para grupo < 30
// (a tela inteira ou a célula). Filtros: período e carteira (seletor do topo) à vista; origem e persona em "Mais filtros".
// Redesign v2: 4 KPIs, "O que mudou neste período", tendência com uma métrica por vez, "Por que não pagam" e
// "O que converte" lado a lado; IA × humano, mapa, funil, conversão por tema e sentimento em "Mais análises".
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { ArrowUpRight, Download, Landmark, RefreshCw } from 'lucide-react';
import { supabase, friendlyError, type Row } from '@/lib/supabase';
import { FRASES, FUNIL, MOTIVOS, OBJECOES, dc, nf, pc, rotaSA, rotuloOferta, sinal } from '@/lib/speech';
import { Botao, BotaoLink, Cartao, Detalhes, Estado, Gaveta, Kpi, Kpis, LinkTexto, Segmentos, campoCls, campoStyle } from '@/components/ds';
import { BarraFiltros, Bloqueio, type Filtros } from './comum';
import type { DefinirAcoes } from './speech-analytics';
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

export function Visao({ f, setDias, setOrigem, persona, setPersona, setAcoes }: { f: Filtros; setDias: (d: number) => void; setOrigem: (o: string) => void; persona: string; setPersona: (p: string) => void; setAcoes: DefinirAcoes }) {
	const [p, setP] = useState<Painel | null>(null);
	const [personas, setPersonas] = useState<string[]>([]);
	const [recs, setRecs] = useState(0);
	const [erro, setErro] = useState('');
	const [loading, setLoading] = useState(true);
	const [met, setMet] = useState<Metrica>('nota');
	const [gaveta, setGaveta] = useState<'tabela' | 'temas' | null>(null);
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

	const baixarCsv = () => {
		if (!p) return;
		const linhas = [['semana', 'origem', 'ligacoes', 'nota', 'conformidade_pct', 'conversao_pct', 'sentimento_melhorou_pct'].join(';'),
			...(p.semanas ?? []).map(s => [s.s, s.origem, s.n ?? '', s.nota ?? '', s.conformidade ?? '', s.conversao ?? '', s.sentimento ?? ''].join(';'))];
		const url = URL.createObjectURL(new Blob([linhas.join('\n')], { type: 'text/csv;charset=utf-8' }));
		const a = document.createElement('a'); a.href = url; a.download = `speech-analytics-semanas-${f.ate}.csv`; a.click();
		window.setTimeout(() => URL.revokeObjectURL(url), 30000);
	};
	const temDados = !!p && p.n != null;
	useEffect(() => {
		setAcoes(<>
			{temDados && <Botao tipo="secundario" onClick={baixarCsv}><Download size={14} aria-hidden="true" />Exportar</Botao>}
			<BotaoLink tipo="primario" to={rotaSA('recomendacoes')}><RefreshCw size={14} aria-hidden="true" />{recs > 0 ? `Ver ${recs} ${recs === 1 ? 'recomendação' : 'recomendações'}` : 'Ver recomendações'}</BotaoLink>
		</>);
		return () => setAcoes(null);
	}, [recs, temDados, p]);

	const filtroPersona = (
		<select aria-label="Persona" value={persona} onChange={e => setPersona(e.target.value)} className={campoCls} style={campoStyle}>
			<option value="">Todas as personas</option>
			{personas.map(x => <option key={x} value={x}>{x}</option>)}
		</select>
	);
	const filtros = <BarraFiltros dias={f.dias} setDias={setDias} origem={f.origem} setOrigem={setOrigem} credorNome={f.credorNome} extra={filtroPersona} />;
	if (erro) return <>{filtros}<Estado tipo="erro" titulo="Não deu para carregar agora.">{erro}</Estado></>;
	if (loading || !p) return <>{filtros}<Estado tipo="carregando" /></>;
	if (p.n == null) {
		return (<>{filtros}
			<Bloqueio tipo="vazio" titulo={p.pequeno ? 'Este recorte tem menos de 30 ligações.' : 'Ainda não há ligações analisadas neste recorte.'}
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
	const notaS = serie(f.origem || 'ia', 'nota');
	const ia = p.origens?.ia, hu = p.origens?.discador;
	const temasTop = (p.motivos ?? []).filter(m => m.conversao != null).slice(0, 4);
	const temaCresce = (p.temas ?? []).find(t => t.crescimento != null && t.nome);
	const objTop = (p.objecoes ?? []).find(o => o.parte != null);
	const motivos = (p.motivos ?? []).filter(m => m.parte != null).slice(0, 6);
	const notaVals = notaS.filter((v): v is number => v != null);
	const abaixoMeta = p.conformidade != null && p.conformidade < 95;
	const abertos = p.alertas?.abertos ?? 0;

	// mapa motivo × carteira
	const carteiras = [...new Map((p.mapa ?? []).map(m => [m.credor_id, m.credor])).entries()];
	const motivosMapa = [...new Set((p.mapa ?? []).map(m => m.motivo))];
	const celula = (mot: string, cid: number) => (p.mapa ?? []).find(m => m.motivo === mot && m.credor_id === cid);
	const vmax = Math.max(1, ...(p.mapa ?? []).map(m => (heatModo === 'parte' ? m.parte : m.conversao) ?? 0));
	const funilBase = p.funil?.identidade ?? null;

	const descobertas: { icone: React.ReactNode; titulo: React.ReactNode; texto: string; link: React.ReactNode }[] = [];
	if (temaCresce) descobertas.push({ icone: <ArrowUpRight size={16} />, titulo: <>"{temaCresce.nome}" {temaCresce.crescimento! >= 0 ? 'cresceu' : 'caiu'} {dc(Math.abs(temaCresce.crescimento!), 0)}% em 4 semanas</>, texto: `${nf(temaCresce.n)} conversas`, link: <LinkTexto onClick={() => setGaveta('temas')}>Ver tema</LinkTexto> });
	if (objTop) descobertas.push({ icone: <Landmark size={16} />, titulo: <>{pc(objTop.parte, 0)} das objeções: {(OBJECOES[objTop.valor] ?? objTop.valor).toLowerCase()}</>, texto: 'Entra no relatório ao credor', link: <LinkTexto to={`${rotaSA('recomendacoes')}?para=credor`}>Relatório</LinkTexto> });
	descobertas.push({ icone: <RefreshCw size={16} />, titulo: <>{recs} {recs === 1 ? 'recomendação' : 'recomendações'} para a estratégia</>, texto: 'Nada muda sem vocês aprovarem', link: <LinkTexto to={rotaSA('recomendacoes')}>Ver</LinkTexto> });

	return (
		<>
			{filtros}
			<div className="space-y-4">
				<Kpis itens={[
					{ rotulo: `Ligações analisadas · ${f.dias} dias`, valor: nf(p.n), detalhe: p.por_origem ? `${nf(p.por_origem.ia ?? null)} da IA · ${p.por_origem.discador == null ? 'menos de 30' : nf(p.por_origem.discador)} do discador` : undefined },
					{ rotulo: 'Nota média de qualidade', valor: <>{dc(p.nota)} <small className="text-[13px] font-medium text-[var(--base-texto-3)]">de 100</small></>, detalhe: notaVals.length > 1 ? `${sinal(notaVals.at(-1)! - notaVals[0])} em 12 semanas` : undefined },
					{ rotulo: 'Em conformidade', valor: pc(p.conformidade), detalhe: 'meta de 95%', tom: abaixoMeta ? 'atencao' : undefined },
					{ rotulo: 'Alertas sem revisão', valor: nf(abertos), detalhe: <>de {nf(p.alertas?.total ?? 0)} no período · <Link className="font-semibold text-[var(--destaque)] hover:underline" to={rotaSA('alertas')}>ver</Link></>, tom: abertos > 0 ? 'alerta' : undefined },
				]} />

				<Cartao semPadding titulo="O que mudou neste período">
					<ul className="divide-y px-4 pb-1 sm:px-5" style={{ borderColor: 'var(--base-borda)' }}>
						{descobertas.map((d, i) => (
							<li key={i} className="flex items-center gap-3 py-2.5 text-[13px]" style={{ borderColor: 'var(--base-borda)' }}>
								<span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-[var(--estado-info-fundo)] text-[var(--estado-info)]" aria-hidden="true">{d.icone}</span>
								<span className="min-w-0 flex-1"><b className="block font-semibold text-[var(--base-texto)]">{d.titulo}</b><small className="text-[12px] text-[var(--base-texto-2)]">{d.texto}</small></span>
								<span className="shrink-0">{d.link}</span>
							</li>
						))}
					</ul>
				</Cartao>

				<Cartao titulo="Tendência por semana" linha={M.titulo} direita={<>
					<select aria-label="Métrica" value={met} onChange={e => setMet(e.target.value as Metrica)} className={campoCls} style={campoStyle}>{METRICAS.map(m => <option key={m.v} value={m.v}>{m.n}</option>)}</select>
					<LinkTexto onClick={() => setGaveta('tabela')}>Ver como tabela</LinkTexto>
				</>}>
					{series.length > 1 && <Legenda itens={series.map(s => ({ nome: s.nome, cor: s.cor, linha: true }))} />}
					{semanas.length === 0 ? <p className="mt-2 text-[13px] text-[var(--base-texto-2)]">Ainda sem semana completa.</p> : <LinhaSemanas x={semanas.map(semanaRotulo)} series={series} {...escala} fmt={M.fmt} meta={M.meta} rotulo={M.titulo} />}
				</Cartao>

				<div className="grid gap-4 lg:grid-cols-2">
					<Cartao titulo="Por que não pagam" linha="Motivo declarado, em % das conversas">
						{motivos.length === 0 ? <p className="text-[13px] text-[var(--base-texto-2)]">Sem motivo com 30 conversas ou mais.</p>
							: motivos.map(m => <BarraH key={m.valor} nome={MOTIVOS[m.valor] ?? m.valor} valor={m.parte} max={Math.max(1, ...motivos.map(x => x.parte ?? 0))} />)}
					</Cartao>
					<Cartao titulo="O que converte" linha="Quanto aparecem nas ligações com acordo e sem acordo">
						<Legenda itens={[{ nome: 'Com acordo', cor: COR_IA }, { nome: 'Sem acordo', cor: COR_NEUTRA }]} />
						{(p.converte ?? []).length === 0 ? <p className="mt-2 text-[13px] text-[var(--base-texto-2)]">Sem frase ou oferta com 30 ligações ou mais.</p> : (p.converte ?? []).map(c => (
							<Halter key={c.tipo + c.valor} nome={c.tipo === 'frase' ? FRASES[c.valor] ?? c.valor : rotuloOferta(c.valor)} sub={c.tipo === 'frase' ? 'Frase' : 'Oferta'} a={c.com_acordo} b={c.sem_acordo} corA={COR_IA} corB={COR_NEUTRA}
								texto={c.com_acordo != null && c.sem_acordo ? <><b className="text-[var(--base-texto)]">{dc(c.com_acordo / c.sem_acordo)}×</b> · {dc(c.com_acordo, 0)}% × {dc(c.sem_acordo, 0)}%</> : undefined} />
						))}
						<p className="mt-2 text-[12px] text-[var(--base-texto-3)]">Associação, não causa: cada frase vira recomendação com teste, não regra.</p>
					</Cartao>
				</div>

				<Detalhes solto resumo="Mais análises" qtd="IA × humano, motivo × carteira, funil, conversão por tema e sentimento">
					<div className="grid gap-4 pt-1 lg:grid-cols-2">
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
						<Cartao titulo="Motivo × carteira" direita={<Segmentos rotulo="Ver como" itens={[{ v: 'm', n: 'Mapa' }, { v: 't', n: 'Tabela' }]} valor={tabHeat ? 't' : 'm'} onTrocar={v => setTabHeat(v === 't')} />}>
							<div className="mb-3"><Segmentos rotulo="Valor" itens={[{ v: 'parte', n: '% das conversas' }, { v: 'conversao', n: 'Conversão' }]} valor={heatModo} onTrocar={setHeatModo} /></div>
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
							<p className="mt-2 text-[12px] text-[var(--base-texto-3)]">Hachurado: menos de 30 ligações.</p>
						</Cartao>
						<Cartao titulo="Funil objeção → oferta → acordo" linha="Base: conversas com identidade confirmada">
							{FUNIL.map((e, i) => { const v = p.funil?.[e.id] ?? null; const ant = i ? p.funil?.[FUNIL[i - 1].id] ?? null : null; return (
								<BarraH key={e.id} nome={e.nome} valor={v} max={funilBase ?? 1} cor={`color-mix(in oklab, ${COR_IA} ${100 - i * 12}%, var(--base-cartao))`} fmt={x => nf(x)} detalhe={i && v != null && ant ? `${dc((100 * v) / ant, 0)}%` : undefined} />); })}
							<h3 className="mb-1 mt-4 text-[13px] font-semibold text-[var(--base-texto)]">Por objeção <small className="font-normal text-[var(--base-texto-3)]">· conversão até acordo</small></h3>
							{(p.objecoes ?? []).map(o => <BarraH key={o.valor} nome={`${OBJECOES[o.valor] ?? o.valor}${o.parte != null ? ` · ${dc(o.parte, 0)}%` : ''}`} valor={o.conversao} max={Math.max(1, ...(p.objecoes ?? []).map(x => x.conversao ?? 0))} cor={COR_NEUTRA} detalhe="viram acordo" />)}
						</Cartao>
						<div className="grid content-start gap-4">
							<Kpi rotulo="Conversão por tema" valor={<>{pc(p.conversao)} <small className="text-[13px] font-medium text-[var(--base-texto-3)]">geral</small></>}
								extra={<div className="mt-1">{temasTop.map(t => <BarraH key={t.valor} nome={MOTIVOS[t.valor] ?? t.valor} valor={t.conversao} max={Math.max(1, ...temasTop.map(x => x.conversao ?? 0))} />)}</div>} />
							<Kpi rotulo="Sentimento médio, do início ao fim" valor={p.sentimento ? `${sinal(p.sentimento.ini, 2)} → ${sinal(p.sentimento.fim, 2)}` : 'menos de 30'} detalhe={p.sentimento ? `escala de −1 a +1 · ${pc(p.sentimento.melhorou_pct, 0)} melhoraram` : undefined} />
							{p.identidade_pct != null && <Kpi rotulo="Identidade confirmada" valor={pc(p.identidade_pct, 0)} detalhe="das ligações analisadas" />}
						</div>
					</div>
				</Detalhes>
			</div>

			<Gaveta aberta={gaveta === 'tabela'} onFechar={() => setGaveta(null)} titulo="Tendência por semana" subtitulo={M.titulo}
				rodape={<Botao tipo="secundario" onClick={baixarCsv}><Download size={14} aria-hidden="true" />Baixar CSV</Botao>}>
				<TabelaSemanas x={semanas.map(semanaRotulo)} series={series} fmt={M.fmt} />
			</Gaveta>
			<Gaveta aberta={gaveta === 'temas'} onFechar={() => setGaveta(null)} titulo="Temas emergentes" subtitulo="Crescimento nas últimas 4 semanas × 4 anteriores">
				{(p.temas ?? []).length === 0 ? <Estado tipo="vazio" compacto titulo="Nenhum tema novo no período." /> : (p.temas ?? []).slice(0, 8).map(t => (
					<div key={t.id} className="grid grid-cols-[minmax(0,1fr)_80px_auto] items-center gap-3 border-b pb-2 text-[13px] last:border-0" style={{ borderColor: 'var(--base-borda)' }}>
						<span className="min-w-0"><b className="block truncate font-semibold text-[var(--base-texto)]">{t.nome ?? 'Tema sem nome (na Curadoria)'}</b><small className="text-[var(--base-texto-3)]">{t.n == null ? 'menos de 30 conversas' : `${nf(t.n)} conversas`}</small></span>
						<Faisca valores={(t.serie ?? []).map(x => x.c)} />
						<span className="whitespace-nowrap text-right font-semibold tnum" style={{ color: (t.crescimento ?? 0) >= 0 ? 'var(--estado-erro-texto)' : 'var(--estado-pronto-texto)' }}>{t.crescimento == null ? '—' : `${sinal(t.crescimento, 0)}%`}</span>
					</div>
				))}
				<p className="text-[12px] text-[var(--base-texto-3)]">Temas saem do agrupamento dos trechos mascarados. Tema novo só ganha nome na Curadoria.</p>
			</Gaveta>
		</>
	);
}
