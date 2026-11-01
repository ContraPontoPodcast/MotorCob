// Empresa › Faturamento › Extrato financeiro do agente virtual (protótipo aprovado, tela 9; Decisão do dono 1).
// Duas partes que não se misturam:
//  1. Itens do agente que o MotorCX fatura (previa_fatura, itens do catálogo do produto agente_voz).
//  2. "Telefonia (pago à operadora)": consumo do mês por rota (consumo_voz_mes + voz_rotas), fora da fatura do
//     MotorCX, com exportação CSV por dia e rota (telefonia_csv). Rota sem cadastro sai sem custo e com alerta.
// Quem vê é quem tem ver_faturamento (a tela de Faturamento já confere).
// Redesign v2: 2 KPIs que separam as duas contas; itens com 4 colunas e total; telefonia com 5 colunas e a cadência,
// o preço do minuto e os segundos tarifados na gaveta da rota; "Exportar telefonia" é a ação principal.
import { useEffect, useMemo, useState } from 'react';
import { CalendarDays, FileDown } from 'lucide-react';
import { toast } from 'sonner';
import { supabase, friendlyError, moneyBR, today, type Row } from '@/lib/supabase';
import { mesExtenso } from '@/lib/empresa-helpers';
import { ITENS_FATURA_VOZ, TIPOS_ROTA, baixarTexto, cadenciaTxt, competencias, inteiro, paraCsv, reais } from '@/lib/voz';
import { Aviso, Cartao, Vazio, btnPrim } from '@/components/comuns/voz-ui';
import { Gaveta, Kpis, ListaValores, Pilula, Tabela } from '@/components/ds';

const nomeMes = (comp: string) => { const m = mesExtenso(comp.slice(0, 7)); return m ? m.charAt(0).toUpperCase() + m.slice(1) : comp; };

export function AgenteVozFaturamento({ empresaId, empresaSlug }: { empresaId: string; empresaSlug: string }) {
	const opcoes = useMemo(() => competencias(today(), 6), []);
	const [comp, setComp] = useState(opcoes[0]);
	const [itens, setItens] = useState<Row[] | null>(null);
	const [consumo, setConsumo] = useState<Row[]>([]);
	const [rotas, setRotas] = useState<Row[]>([]);
	const [temVoz, setTemVoz] = useState<boolean | null>(null);
	const [exportando, setExportando] = useState(false);
	const [rotaSel, setRotaSel] = useState<string | null>(null);

	useEffect(() => {
		if (!supabase || !empresaId) { setItens([]); setTemVoz(false); return; }
		let ativo = true;
		const eid = Number(empresaId);
		setItens(null);
		(async () => {
			const [pf, cm, ro, cfg] = await Promise.all([
				supabase!.rpc('previa_fatura', { empresa: eid, competencia: comp }),
				supabase!.from('consumo_voz_mes').select('tech_prefix,rota_id,chamadas,chamadas_atendidas,segundos_atendidos,segundos_tarifados,minutos_tarifados,custo_estimado,sem_custo').eq('empresa_id', eid).eq('competencia', comp).order('tech_prefix'),
				supabase!.from('voz_rotas').select('id,tech_prefix,tipo,cadencia_inicial_s,cadencia_incremento_s,preco_minuto,vigente_desde,vigente_ate').eq('empresa_id', eid),
				supabase!.from('voz_config').select('empresa_id,pico_multiplo').eq('empresa_id', eid).maybeSingle(),
			]);
			if (!ativo) return;
			const lista = ((pf.data ?? []) as Row[]).filter(r => (ITENS_FATURA_VOZ as readonly string[]).some(c => String(r.item ?? '') === c || String(r.item ?? '') === `${c}_minimo`));
			setItens(lista);
			setConsumo((cm.data ?? []) as Row[]);
			setRotas((ro.data ?? []) as Row[]);
			setTemVoz(!!cfg.data || lista.length > 0 || ((cm.data ?? []) as Row[]).length > 0);
		})().catch(() => { if (ativo) { setItens([]); setTemVoz(false); } });
		return () => { ativo = false; };
	}, [empresaId, comp]);

	// Rota de cada linha do mês: a do consumo (rota_id) ou, sem ela, a vigente do tech prefix no fim do mês (só para mostrar tipo e cadência).
	const linhas = useMemo(() => consumo.map(c => {
		const r = c.rota_id != null ? rotas.find(x => String(x.id) === String(c.rota_id)) ?? null : null;
		const semCusto = Number(c.sem_custo ?? 0);
		return {
			tech_prefix: String(c.tech_prefix ?? ''), chamadas: Number(c.chamadas ?? 0), segundos_tarifados: Number(c.segundos_tarifados ?? 0),
			rota: r, semCusto, custo: c.custo_estimado == null ? null : Number(c.custo_estimado),
		};
	}), [consumo, rotas]);

	if (temVoz === false) return null;           // empresa sem agente virtual: o Faturamento segue como antes
	if (itens == null) return <p className="py-6 text-center text-[13px] text-[var(--base-texto-3)]">Carregando o agente virtual...</p>;

	const totFat = itens.reduce((t, i) => t + Number(i.valor ?? 0), 0);
	const temPico = itens.some(i => i.item === 'voz_minuto_ia_pico' && Number(i.quantidade ?? 0) > 0);
	const totTel = linhas.reduce((t, l) => t + (l.custo ?? 0), 0);
	const totCh = linhas.reduce((t, l) => t + Number(l.chamadas ?? 0), 0);
	const totSeg = linhas.reduce((t, l) => t + Number(l.segundos_tarifados ?? 0), 0);
	const semCad = linhas.filter(l => l.semCusto > 0);
	const chSemCusto = semCad.reduce((t, l) => t + l.semCusto, 0);
	const mes = nomeMes(comp);
	const atual = comp === opcoes[0];

	async function exportar() {
		if (!supabase) return;
		setExportando(true);
		const { data, error } = await supabase.rpc('telefonia_csv', { empresa: Number(empresaId), competencia: comp });
		setExportando(false);
		if (error) { toast.error(friendlyError(error)); return; }
		const rows = (data ?? []) as Row[];
		if (rows.length === 0) { toast.info('Sem consumo de telefonia neste mês.'); return; }
		const csv = paraCsv(
			['dia', 'tech_prefix', 'tipo', 'tronco', 'cadencia', 'preco_minuto', 'chamadas', 'chamadas_atendidas', 'segundos_atendidos', 'segundos_tarifados', 'custo_estimado', 'sem_custo'],
			rows.map(r => [r.dia, r.tech_prefix || '', r.tipo ? TIPOS_ROTA[String(r.tipo)] ?? r.tipo : '', r.tronco ?? '', r.cadencia ?? '',
				r.preco_minuto == null ? null : Number(r.preco_minuto), Number(r.chamadas ?? 0), Number(r.chamadas_atendidas ?? 0),
				Number(r.segundos_atendidos ?? 0), Number(r.segundos_tarifados ?? 0), r.custo_estimado == null ? null : Number(r.custo_estimado), Number(r.sem_custo ?? 0)]),
		);
		baixarTexto(`telefonia-${empresaSlug || empresaId}-${comp.slice(0, 7)}.csv`, csv);
		toast.success('Arquivo pronto: uma linha por dia e rota. Rota sem cadastro sai com o custo vazio.');
	}

	type Linha = (typeof linhas)[number];
	const sel = linhas.find(l => l.tech_prefix === rotaSel) ?? null;
	const custoCel = (l: Linha) => l.custo != null ? moneyBR(l.custo) : <span className="font-normal text-[var(--base-texto-3)]">sem custo</span>;

	return (
		<div className="space-y-5" id="agente-virtual">
			<div className="flex flex-wrap items-end justify-between gap-3">
				<div className="min-w-0 flex-[1_1_300px]">
					<h2 className="text-[19px] font-semibold text-[var(--base-texto)]">Agente virtual · extrato financeiro</h2>
					<p className="mt-0.5 text-[13px] text-[var(--base-texto-2)]">O que o MotorCX fatura e, à parte, a telefonia que a empresa paga direto à operadora.</p>
				</div>
				<div className="flex flex-wrap items-center gap-2">
					<label className="flex items-center gap-2 rounded-lg border border-[var(--base-field-border)] bg-[var(--base-cartao)] px-3 py-1.5 text-[13px] text-[var(--base-texto)]">
						<CalendarDays size={14} className="text-[var(--base-texto-2)]" aria-hidden="true" />
						<select aria-label="Competência" value={comp} onChange={e => setComp(e.target.value)} className="!border-0 bg-transparent pr-1 text-[13px] text-[var(--base-texto)] outline-none">
							{opcoes.map((c, i) => <option key={c} value={c}>{nomeMes(c)}{i === 0 ? ' (até agora)' : ''}</option>)}
						</select>
					</label>
					<button onClick={() => void exportar()} disabled={exportando || linhas.length === 0} className={btnPrim}><FileDown size={15} /> {exportando ? 'Gerando...' : 'Exportar telefonia por rota e dia'}</button>
				</div>
			</div>

			<Kpis itens={[
				{ rotulo: `Fatura MotorCX · ${mes.toLowerCase()}${atual ? ' até agora' : ''}`, valor: moneyBR(totFat), detalhe: 'só os itens do agente virtual' },
				{ rotulo: 'Telefonia estimada · paga à operadora', valor: moneyBR(totTel), detalhe: `fora da fatura do MotorCX${chSemCusto ? ` · ${inteiro(chSemCusto)} chamadas sem custo` : ''}`, tom: chSemCusto ? 'atencao' : undefined },
			]} />

			<Cartao semPad titulo="Itens faturados pelo MotorCX" desc="Plataforma, minuto de IA, transcrição e gestão do tronco. Os outros produtos entram na mesma fatura, em Itens do mês.">
				<Tabela rotulo="Itens faturados" linhas={itens} chave={i => String(i.item) + String(i.descricao ?? '')}
					vazio={<div className="px-1"><Vazio titulo="Nenhum item do agente virtual neste mês">Quando o agente ligar de verdade, o minuto de IA, a transcrição e a gestão do tronco aparecem aqui.</Vazio></div>}
					colunas={[
						{ id: 'item', titulo: 'Item', celula: i => String(i.descricao ?? i.item) },
						{ id: 'qtd', titulo: 'Qtd.', num: true, celula: i => Number(i.quantidade ?? 0).toLocaleString('pt-BR', { maximumFractionDigits: 2 }) },
						{ id: 'preco', titulo: 'Preço', num: true, celula: i => { const preco = Number(i.preco ?? 0); return <span className="text-[var(--base-texto-2)]">{preco > 0 && preco < 1 ? reais(preco, 3) : moneyBR(preco)}</span>; } },
						{ id: 'valor', titulo: 'Valor', num: true, celula: i => <b>{moneyBR(i.valor)}</b> },
					]}
					rodape={itens.length ? <><span>{temPico ? 'Pico ligado: o minuto de IA acima do limite sai como item próprio, ao dobro.' : 'Sem minuto no pico neste mês.'}</span><b className="tnum text-[var(--base-texto)]">Total {moneyBR(totFat)}</b></> : undefined} />
			</Cartao>

			<Cartao semPad titulo="Telefonia (paga à operadora)" desc="Não entra na fatura do MotorCX. Consumo do mês por rota, com a cadência e o preço do contrato da empresa, para conferir com a fatura da operadora.">
				{semCad.length > 0 && (
					<div className="px-5 pb-3 sm:px-6"><Aviso titulo={`${semCad.length === 1 ? 'Rota' : 'Rotas'} ${semCad.map(l => l.tech_prefix || 'sem prefixo').join(', ')} sem cadastro: ${inteiro(chSemCusto)} chamadas sem custo calculado.`}>
						O total não inclui essas chamadas. Peça à equipe MotorCX para cadastrar a rota com o preço do contrato.
					</Aviso></div>
				)}
				<Tabela rotulo="Telefonia por rota" linhas={linhas} chave={l => l.tech_prefix} onAbrir={l => setRotaSel(l.tech_prefix)} selecionada={rotaSel}
					vazio={<div className="px-1"><Vazio titulo="Sem consumo de telefonia neste mês">As ligações de verdade aparecem aqui no dia seguinte, por rota. No modo Simulado nada é tarifado.</Vazio></div>}
					colunas={[
						{ id: 'pre', titulo: 'Prefixo', celula: l => <span className="font-mono">{l.tech_prefix || '—'}</span> },
						{ id: 'tipo', titulo: 'Tipo', celula: l => l.rota ? TIPOS_ROTA[String(l.rota.tipo)] ?? String(l.rota.tipo) : <Pilula tom="atencao">sem cadastro</Pilula> },
						{ id: 'ch', titulo: 'Chamadas', num: true, celula: l => inteiro(l.chamadas) },
						{ id: 'min', titulo: 'Minutos', num: true, celula: l => inteiro(Number(l.segundos_tarifados ?? 0) / 60) },
						{ id: 'custo', titulo: 'Custo estimado', num: true, celula: l => <b>{custoCel(l)}</b> },
					]}
					celular={l => ({ titulo: <span className="font-mono">{l.tech_prefix || '—'}</span>, valor: custoCel(l), resumo: `${l.rota ? TIPOS_ROTA[String(l.rota.tipo)] ?? '' : 'sem cadastro'} · ${inteiro(l.chamadas)} chamadas` })}
					rodape={linhas.length ? <><span>Sem carência: todo segundo atendido é tarifado; não atendida não tem custo. Preço da vigência do dia.</span><b className="tnum text-[var(--base-texto)]">{inteiro(totCh)} chamadas · {inteiro(totSeg / 60)} min · {moneyBR(totTel)}</b></> : undefined} />
			</Cartao>

			<Gaveta aberta={!!sel} onFechar={() => setRotaSel(null)} titulo={sel ? `Rota ${sel.tech_prefix || 'sem prefixo'}` : ''} subtitulo={sel?.rota ? TIPOS_ROTA[String(sel.rota.tipo)] : 'Rota sem cadastro'}>
				{sel && <>
					<ListaValores itens={[
						['Cadência', sel.rota ? cadenciaTxt(sel.rota.cadencia_inicial_s, sel.rota.cadencia_incremento_s) : '—'],
						['Preço do minuto', sel.rota ? reais(sel.rota.preco_minuto, 3) : '—'],
						['Chamadas', inteiro(sel.chamadas)],
						['Segundos tarifados', inteiro(sel.segundos_tarifados)],
						['Custo estimado', sel.custo != null ? moneyBR(sel.custo) : 'sem custo'],
						['Chamadas sem custo', inteiro(sel.semCusto)],
					]} />
					<p className="text-[12px] text-[var(--base-texto-3)]">Diferença com a fatura da operadora costuma vir de rota sem cadastro ou preço desatualizado. Exporte o CSV por dia e rota para conferir.</p>
				</>}
			</Gaveta>
		</div>
	);
}
