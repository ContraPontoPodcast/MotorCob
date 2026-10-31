// Empresa › Faturamento › Extrato financeiro do agente virtual (protótipo aprovado, tela 9; Decisão do dono 1).
// Duas partes que não se misturam:
//  1. Itens do agente que o MotorCX fatura (previa_fatura, itens do catálogo do produto agente_voz).
//  2. "Telefonia (pago à operadora)": consumo do mês por rota (consumo_voz_mes + voz_rotas), fora da fatura do
//     MotorCX, com exportação CSV por dia e rota (telefonia_csv). Rota sem cadastro sai sem custo e com alerta.
// Quem vê é quem tem ver_faturamento (a tela de Faturamento já confere).
import { useEffect, useMemo, useState } from 'react';
import { CalendarDays, FileDown } from 'lucide-react';
import { toast } from 'sonner';
import { supabase, friendlyError, moneyBR, today, type Row } from '@/lib/supabase';
import { mesExtenso } from '@/lib/empresa-helpers';
import { ITENS_FATURA_VOZ, TIPOS_ROTA, baixarTexto, cadenciaTxt, competencias, inteiro, paraCsv, reais } from '@/lib/voz';
import { Aviso, Cartao, TabelaRolavel, Vazio, btnSec, tdCls, thCls } from '@/components/comuns/voz-ui';

const nomeMes = (comp: string) => { const m = mesExtenso(comp.slice(0, 7)); return m ? m.charAt(0).toUpperCase() + m.slice(1) : comp; };

export function AgenteVozFaturamento({ empresaId, empresaSlug }: { empresaId: string; empresaSlug: string }) {
	const opcoes = useMemo(() => competencias(today(), 6), []);
	const [comp, setComp] = useState(opcoes[0]);
	const [itens, setItens] = useState<Row[] | null>(null);
	const [consumo, setConsumo] = useState<Row[]>([]);
	const [rotas, setRotas] = useState<Row[]>([]);
	const [temVoz, setTemVoz] = useState<boolean | null>(null);
	const [exportando, setExportando] = useState(false);

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
	if (itens == null) return <p className="py-6 text-center text-[13px] text-[#8E8E93]">Carregando o agente virtual...</p>;

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

	return (
		<div className="space-y-6" id="agente-virtual">
			<div className="flex flex-wrap items-end justify-between gap-3">
				<div>
					<h2 className="text-[19px] font-semibold text-[#1D1D1F]">Agente virtual · extrato financeiro</h2>
					<p className="mt-0.5 text-[13px] text-[#6E6E73]">O que o MotorCX fatura e, à parte, a telefonia que a empresa paga direto à operadora.</p>
				</div>
				<label className="flex items-center gap-2 rounded-full border border-[#D2D2D7] bg-white px-3 py-1.5 text-[13px] text-[#1D1D1F]">
					<CalendarDays size={14} className="text-[#6E6E73]" />
					<select aria-label="Competência" value={comp} onChange={e => setComp(e.target.value)} className="!border-0 bg-transparent pr-1 text-[13px] outline-none">
						{opcoes.map((c, i) => <option key={c} value={c}>{nomeMes(c)}{i === 0 ? ' (até agora)' : ''}</option>)}
					</select>
				</label>
			</div>

			<div className="grid gap-3 sm:grid-cols-2">
				<div className="rounded-2xl bg-white p-5" style={{ boxShadow: '0 0 0 1px #E5E5EA, 0 2px 12px rgba(0,0,0,.04)' }}>
					<p className="text-[13px] text-[#6E6E73]">{mes}{atual ? ' até agora' : ''} · fatura MotorCX</p>
					<p className="mt-1 text-[26px] font-bold tracking-tight text-[#1D1D1F] tnum">{moneyBR(totFat)}</p>
					<p className="mt-0.5 text-[12px] text-[#8E8E93]">só os itens do agente virtual</p>
				</div>
				<div className="rounded-2xl border border-dashed border-[#D2D2D7] bg-[#F5F5F7] p-5">
					<p className="text-[13px] text-[#6E6E73]">Telefonia estimada · paga à operadora</p>
					<p className="mt-1 text-[26px] font-bold tracking-tight text-[#1D1D1F] tnum">{moneyBR(totTel)}</p>
					<p className="mt-0.5 text-[12px] text-[#8E8E93]">fora da fatura do MotorCX{chSemCusto ? ` · ${inteiro(chSemCusto)} chamadas sem custo` : ''}</p>
				</div>
			</div>

			<Cartao titulo={`Itens faturados pelo MotorCX · ${mes.toLowerCase()}`}
				desc="Só o que o MotorCX cobra do agente virtual: plataforma, minuto de IA, transcrição e gestão do tronco. Os outros produtos da empresa entram na mesma fatura, em Itens do mês.">
				{itens.length === 0 ? (
					<Vazio titulo="Nenhum item do agente virtual neste mês">Quando o agente ligar de verdade, o minuto de IA, a transcrição e a gestão do tronco aparecem aqui.</Vazio>
				) : (
					<TabelaRolavel minW={480}>
						<thead><tr>
							<th className={thCls}>Item</th><th className={`${thCls} text-right`}>Qtd.</th><th className={`${thCls} text-right`}>Preço</th><th className={`${thCls} text-right`}>Valor</th>
						</tr></thead>
						<tbody>
							{itens.map((i, k) => {
								const preco = Number(i.preco ?? 0);
								return (
									<tr key={k}>
										<td className={tdCls}>{String(i.descricao ?? i.item)}</td>
										<td className={`${tdCls} text-right tnum`}>{Number(i.quantidade ?? 0).toLocaleString('pt-BR', { maximumFractionDigits: 2 })}</td>
										<td className={`${tdCls} text-right tnum text-[#6E6E73]`}>{preco > 0 && preco < 1 ? reais(preco, 3) : moneyBR(preco)}</td>
										<td className={`${tdCls} text-right font-semibold tnum`}>{moneyBR(i.valor)}</td>
									</tr>
								);
							})}
						</tbody>
						<tfoot><tr>
							<td className="py-2.5 pr-3 font-semibold text-[#1D1D1F]">Total dos itens</td><td /><td />
							<td className="py-2.5 pr-3 text-right font-semibold text-[#1D1D1F] tnum">{moneyBR(totFat)}</td>
						</tr></tfoot>
					</TabelaRolavel>
				)}
				<p className="mt-3 text-[12px] leading-relaxed text-[#8E8E93]">{temPico ? 'O pico está ligado: o minuto de IA acima do limite da empresa sai como item próprio, ao dobro do preço.' : 'Sem minuto no pico neste mês: nenhum minuto ao dobro.'} Minuto de telefonia não é item desta fatura.</p>
			</Cartao>

			<section className="rounded-2xl border border-dashed border-[#D2D2D7] bg-[#F5F5F7] p-5 sm:p-6">
				<div className="mb-4 flex flex-wrap items-start justify-between gap-3">
					<div className="min-w-0 flex-1 basis-full sm:basis-0">
						<h2 className="flex flex-wrap items-center gap-2 text-[17px] font-semibold text-[#1D1D1F]">Telefonia (pago à operadora) <span className="rounded-full bg-white px-2.5 py-0.5 text-[12px] font-semibold text-[#6E6E73]">não entra na fatura do MotorCX</span></h2>
						<p className="mt-1 max-w-[760px] text-[13px] leading-relaxed text-[#6E6E73]">Consumo do mês por rota, calculado com a cadência e o preço que a empresa contratou com a operadora. Serve para ver o custo e conferir com a fatura da operadora.</p>
					</div>
					<button onClick={() => void exportar()} disabled={exportando || linhas.length === 0} className={`${btnSec} bg-white`}><FileDown size={15} /> {exportando ? 'Gerando...' : 'Exportar CSV por rota e dia'}</button>
				</div>
				{semCad.length > 0 && (
					<Aviso className="mb-3" titulo={`${semCad.length === 1 ? 'Rota' : 'Rotas'} ${semCad.map(l => l.tech_prefix || 'sem prefixo').join(', ')} sem cadastro: ${inteiro(chSemCusto)} chamadas sem custo calculado.`}>
						O total abaixo não inclui essas chamadas. Peça à equipe MotorCX para cadastrar a rota com o preço do contrato da operadora.
					</Aviso>
				)}
				{linhas.length === 0 ? (
					<Vazio titulo="Sem consumo de telefonia neste mês">As ligações de verdade aparecem aqui no dia seguinte, por rota. No modo Simulado nada é tarifado.</Vazio>
				) : (
					<>
						<div className="hidden rounded-xl bg-white px-3 pb-1 pt-1 sm:block">
							<TabelaRolavel minW={760}>
								<thead><tr>
									<th className={thCls}>Tech prefix</th><th className={thCls}>Tipo</th><th className={`${thCls} text-right`}>Cadência</th><th className={`${thCls} text-right`}>Preço do minuto</th>
									<th className={`${thCls} text-right`}>Chamadas</th><th className={`${thCls} text-right`}>Seg. tarifados</th><th className={`${thCls} text-right`}>Minutos</th><th className={`${thCls} text-right`}>Custo estimado</th>
								</tr></thead>
								<tbody>
									{linhas.map(l => (
										<tr key={String(l.tech_prefix)}>
											<td className={`${tdCls} font-mono`}>{String(l.tech_prefix || '—')}</td>
											<td className={tdCls}>{l.rota ? TIPOS_ROTA[String(l.rota.tipo)] ?? String(l.rota.tipo) : <span className="rounded-full px-2 py-0.5 text-[12px] font-semibold" style={{ backgroundColor: 'var(--estado-atencao-fundo)', color: 'var(--estado-atencao-texto)' }}>sem cadastro</span>}</td>
											<td className={`${tdCls} text-right tnum`}>{l.rota ? cadenciaTxt(l.rota.cadencia_inicial_s, l.rota.cadencia_incremento_s) : '—'}</td>
											<td className={`${tdCls} text-right tnum`}>{l.rota ? reais(l.rota.preco_minuto, 3) : '—'}</td>
											<td className={`${tdCls} text-right tnum`}>{inteiro(l.chamadas)}</td>
											<td className={`${tdCls} text-right tnum`}>{inteiro(l.segundos_tarifados)}</td>
											<td className={`${tdCls} text-right tnum`}>{inteiro(Number(l.segundos_tarifados ?? 0) / 60)}</td>
											<td className={`${tdCls} text-right font-semibold tnum`}>{l.custo != null ? moneyBR(l.custo) : <span className="font-normal text-[#8E8E93]">sem custo</span>}{l.custo != null && l.semCusto > 0 ? <div className="text-[11.5px] font-normal text-[#8E8E93]">{inteiro(l.semCusto)} sem custo</div> : null}</td>
										</tr>
									))}
								</tbody>
								<tfoot><tr>
									<td className="py-2.5 pr-3 font-semibold text-[#1D1D1F]">Total</td><td /><td /><td />
									<td className="py-2.5 pr-3 text-right font-semibold text-[#1D1D1F] tnum">{inteiro(totCh)}</td>
									<td className="py-2.5 pr-3 text-right font-semibold text-[#1D1D1F] tnum">{inteiro(totSeg)}</td>
									<td className="py-2.5 pr-3 text-right font-semibold text-[#1D1D1F] tnum">{inteiro(totSeg / 60)}</td>
									<td className="py-2.5 pr-3 text-right font-semibold text-[#1D1D1F] tnum">{moneyBR(totTel)}</td>
								</tr></tfoot>
							</TabelaRolavel>
						</div>
						<div className="space-y-2 sm:hidden">
							{linhas.map(l => (
								<div key={String(l.tech_prefix)} className="rounded-xl bg-white p-3">
									<div className="flex items-start justify-between gap-2">
										<b className="font-mono text-[14px] text-[#1D1D1F]">{String(l.tech_prefix || '—')}</b>
										<span className="text-[14px] font-semibold text-[#1D1D1F] tnum">{l.custo != null ? moneyBR(l.custo) : <span className="rounded-full px-2 py-0.5 text-[12px]" style={{ backgroundColor: 'var(--estado-atencao-fundo)', color: 'var(--estado-atencao-texto)' }}>sem custo</span>}</span>
									</div>
									<div className="mt-0.5 text-[12.5px] text-[#6E6E73]">{l.rota ? `${TIPOS_ROTA[String(l.rota.tipo)] ?? ''} · ${cadenciaTxt(l.rota.cadencia_inicial_s, l.rota.cadencia_incremento_s)} · ${reais(l.rota.preco_minuto, 3)}/min` : 'rota sem cadastro'}</div>
									<div className="text-[12.5px] text-[#6E6E73] tnum">{inteiro(l.chamadas)} chamadas · {inteiro(l.segundos_tarifados)} s tarifados</div>
								</div>
							))}
							<div className="flex justify-between px-1 pt-1 text-[13px] font-semibold text-[#1D1D1F]"><span>Total</span><span className="tnum">{moneyBR(totTel)}</span></div>
						</div>
					</>
				)}
				<p className="mt-3 text-[12px] leading-relaxed text-[#8E8E93]">Sem carência: todo segundo atendido é tarifado (2 s em 30/6 = 30 s). Chamada não atendida não tem custo. O preço usado é o da vigência do dia da chamada. Diferença com a fatura da operadora costuma vir de rota sem cadastro, preço desatualizado ou ligações feitas fora do MotorCX.</p>
			</section>
		</div>
	);
}
