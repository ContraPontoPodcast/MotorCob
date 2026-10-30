import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase, friendlyError, moneyBR, dateBR, type Row } from '@/lib/supabase';
import { useMotorAuth } from '@/components/auth-provider';
import { num, precoCliente, type ScoreFormacao } from '@/lib/mensageria-produtos';
import { ScoreFormacaoBox } from '@/components/comuns/score-formacao-box';

const fmtDate = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
const money4 = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 4, maximumFractionDigits: 4 });
const pct1 = (v: number, t: number) => t ? `${((v / t) * 100).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%` : '—';

const CARD_SHADOW = '0 0 0 1px #E5E5EA, 0 2px 12px rgba(0,0,0,.04)';

type EconomiaRow = {
	campanha_id: string; nome: string; dia: string; analisados: number; represados: number;
	enviados: number; preco_sms: number; total_sem: number; total_com: number; economia: number; custo_unitario: number;
};
type ControleRow = { faixa: string; taxa_entrega: number; controle: number };

function meses6() {
	const hoje = new Date();
	const d = new Date(hoje); d.setMonth(d.getMonth() - 6);
	return { de: fmtDate(d), ate: fmtDate(hoje) };
}

export function ScoreEconomia() {
	const { empresa } = useMotorAuth();
	const [scoreAtivo, setScoreAtivo] = useState<boolean | null>(null);
	const ini = useMemo(meses6, []);
	const [de, setDe] = useState(ini.de);
	const [ate, setAte] = useState(ini.ate);
	const [campanhaSel, setCampanhaSel] = useState('all');
	const [rows, setRows] = useState<EconomiaRow[]>([]);
	const [controle, setControle] = useState<ControleRow[]>([]);
	const [loading, setLoading] = useState(true);
	const [erro, setErro] = useState('');
	const [formacao, setFormacao] = useState<ScoreFormacao | null>(null);

	// Verifica se o Score está contratado.
	useEffect(() => {
		if (!supabase || !empresa) { setScoreAtivo(false); return; }
		let active = true;
		(async () => {
			const { data } = await supabase.from('empresa_score').select('ativo').eq('empresa_id', empresa.id).maybeSingle();
			if (active) setScoreAtivo(!!(data as Row | null)?.ativo);
		})();
		return () => { active = false; };
	}, [empresa?.id]);

	const load = useCallback(async () => {
		if (!supabase || !empresa || scoreAtivo === null) return;
		setLoading(true); setErro('');
		if (scoreAtivo) {
			const [ec, ct, sf] = await Promise.all([
				supabase.rpc('economia_score', { empresa: empresa.id, de, ate }),
				supabase.rpc('controle_score', { empresa: empresa.id, de, ate }),
				supabase.rpc('score_formacao'),
			]);
			if (ec.error) { setErro(friendlyError(ec.error)); setLoading(false); return; }
			setRows((ec.data ?? []) as EconomiaRow[]);
			setControle((ct.data ?? []) as ControleRow[]);
			setFormacao((sf.data as ScoreFormacao | null) ?? null);
		} else {
			// Vitrine não usa estas listas.
			setRows([]); setControle([]);
		}
		setLoading(false);
	}, [empresa?.id, scoreAtivo, de, ate]);

	useEffect(() => { void load(); }, [load]);

	if (!empresa) {
		return <div className="rounded-2xl bg-white p-10 text-center text-[#6E6E73]" style={{ boxShadow: CARD_SHADOW }}>Escolha a empresa no topo.</div>;
	}

	return (
		<div className="space-y-5">
			<div>
				<h1 className="text-[24px] font-bold tracking-tight text-[#1D1D1F]">Quanto o Score fez você economizar</h1>
				<p className="mt-1 text-[14px] text-[#6E6E73]">Números reais das suas campanhas de SMS. Nada aqui é estimativa.</p>
			</div>

			{erro && <div className="rounded-xl bg-[#FFE8E6] px-4 py-3 text-[14px] text-[#FF3B30]">{erro}</div>}

			{scoreAtivo === null ? (
				<p className="py-8 text-center text-[14px] text-[#8E8E93]">Carregando...</p>
			) : scoreAtivo ? (
				<ScoreEconomiaFull rows={rows} controle={controle} loading={loading} de={de} ate={ate} setDe={setDe} setAte={setAte} campanhaSel={campanhaSel} setCampanhaSel={setCampanhaSel} formacao={formacao} />
			) : (
				<ScoreVitrine de={de} ate={ate} setDe={setDe} setAte={setAte} loading={loading} />
			)}
		</div>
	);
}

// ===================== VARIANTE COMPLETA (Score contratado) =====================

function ScoreEconomiaFull({ rows, controle, loading, de, ate, setDe, setAte, campanhaSel, setCampanhaSel, formacao }: {
	rows: EconomiaRow[]; controle: ControleRow[]; loading: boolean; de: string; ate: string;
	setDe: (v: string) => void; setAte: (v: string) => void; campanhaSel: string; setCampanhaSel: (v: string) => void; formacao: ScoreFormacao | null;
}) {
	const campanhas = useMemo(() => {
		const map = new Map<string, string>();
		rows.forEach(r => { if (!map.has(r.campanha_id)) map.set(r.campanha_id, r.nome); });
		return Array.from(map, ([id, nome]) => ({ id, nome }));
	}, [rows]);

	const filtradas = useMemo(() => campanhaSel === 'all' ? rows : rows.filter(r => r.campanha_id === campanhaSel), [rows, campanhaSel]);

	const tot = useMemo(() => {
		const s = { analisados: 0, represados: 0, enviados: 0, total_sem: 0, total_com: 0, economia: 0 };
		filtradas.forEach(r => { s.analisados += +r.analisados; s.represados += +r.represados; s.enviados += +r.enviados; s.total_sem += +r.total_sem; s.total_com += +r.total_com; s.economia += +r.economia; });
		return s;
	}, [filtradas]);

	const precoSms = filtradas.length ? filtradas[0].preco_sms : 0;
	const custoUnit = tot.analisados ? tot.total_com / tot.analisados : 0;
	const scoreCost = Math.max(0, tot.total_com - tot.enviados * precoSms);
	const xRatio = scoreCost > 0 ? (tot.represados * precoSms) / scoreCost : 0;
	const economiaPct = tot.total_sem > 0 ? ((tot.total_sem - tot.total_com) / tot.total_sem) * 100 : 0;

	const porMes = useMemo(() => {
		const map = new Map<string, number>();
		filtradas.forEach(r => { const m = String(r.dia ?? '').slice(0, 7); if (!m) return; map.set(m, (map.get(m) ?? 0) + +r.economia); });
		return Array.from(map, ([mes, val]) => ({ mes, val })).sort((a, b) => a.mes.localeCompare(b.mes));
	}, [filtradas]);
	const maxMes = Math.max(1, ...porMes.map(m => Math.abs(m.val)));

	if (loading) return <p className="py-8 text-center text-[14px] text-[#8E8E93]">Carregando...</p>;

	return (
		<>
			{formacao && !formacao.completa && (
				<ScoreFormacaoBox formacao={formacao} semHistorico={0} total={tot.analisados} economia />
			)}
			{/* Filtros */}
			<div className="flex flex-wrap items-center gap-3">
				<input type="date" value={de} onChange={e => setDe(e.target.value)} className="h-9 rounded-lg border border-[#D2D2D7] bg-white px-3 text-[14px] outline-none" />
				<span className="text-[14px] text-[#8E8E93]">até</span>
				<input type="date" value={ate} onChange={e => setAte(e.target.value)} className="h-9 rounded-lg border border-[#D2D2D7] bg-white px-3 text-[14px] outline-none" />
				<select value={campanhaSel} onChange={e => setCampanhaSel(e.target.value)} className="h-9 rounded-lg border border-[#D2D2D7] bg-white px-3 text-[14px] outline-none focus-visible:ring-2 focus-visible:ring-[#0071E5]/40">
					<option value="all">Todas as campanhas do período</option>
					{campanhas.map(c => <option key={c.id} value={c.id}>{c.nome}</option>)}
				</select>
			</div>

			{filtradas.length === 0 ? (
				<div className="rounded-2xl bg-white p-10 text-center text-[14px] text-[#6E6E73]" style={{ boxShadow: CARD_SHADOW }}>Nenhuma campanha com Score no período.</div>
			) : (
				<>
					{/* Cartão único, duas colunas */}
					<div className="grid gap-4 lg:grid-cols-2">
						<div className="rounded-2xl bg-white p-6" style={{ boxShadow: CARD_SHADOW }}>
							<p className="text-[12px] font-semibold uppercase tracking-wide text-[#8E8E93]">Economia líquida</p>
							<p className="mt-2 text-[30px] font-bold tnum" style={{ color: tot.economia >= 0 ? '#248A3D' : '#FF3B30' }}>{moneyBR(tot.economia)}</p>
							<p className="mt-2 text-[13px] leading-relaxed text-[#6E6E73]">
								Cada R$ 1,00 pago no Score evitou <strong className="tnum text-[#1D1D1F]">{moneyBR(xRatio)}</strong> em SMS para números de baixa entrega.
							</p>
						</div>
						<div className="rounded-2xl bg-white p-6" style={{ boxShadow: CARD_SHADOW }}>
							<p className="text-[12px] font-semibold uppercase tracking-wide text-[#8E8E93]">Custo unitário efetivo</p>
							<p className="mt-2 text-[30px] font-bold tnum text-[#1D1D1F]">{precoCliente(custoUnit)}</p>
							<p className="mt-2 text-[13px] text-[#6E6E73]">contra {moneyBR(precoSms)} do SMS padrão · economia de {pct1(economiaPct, 100)}.</p>
						</div>
					</div>

					{/* Linha da conta */}
					<div className="rounded-xl bg-[#F5F5F7] px-5 py-4 text-[13px] leading-relaxed text-[#6E6E73]">
						{num(tot.analisados)} carregados · {num(tot.represados)} não enviados · {num(tot.enviados)} enviados · total pago {moneyBR(tot.total_com)} ÷ {num(tot.analisados)} = {precoCliente(custoUnit)} por número · sem o Score seriam {moneyBR(tot.total_sem)}.
					</div>

					{/* Gráfico de barras da economia líquida por mês */}
					{porMes.length > 0 && (
						<section className="rounded-2xl bg-white p-6" style={{ boxShadow: CARD_SHADOW }}>
							<h2 className="mb-4 text-[16px] font-semibold text-[#1D1D1F]">Economia líquida por mês</h2>
							<div className="flex items-end gap-3" style={{ height: 160 }}>
								{porMes.map(m => (
									<div key={m.mes} className="flex flex-1 flex-col items-center justify-end gap-1.5">
										<span className="text-[11px] tnum text-[#6E6E73]">{moneyBR(m.val)}</span>
										<div className="w-full rounded-t" style={{ height: `${(Math.abs(m.val) / maxMes) * 100}%`, minHeight: 4, backgroundColor: m.val >= 0 ? '#34C759' : '#FF3B30' }} />
										<span className="text-[11px] text-[#8E8E93]">{m.mes.slice(5)}</span>
									</div>
								))}
							</div>
						</section>
					)}

					{/* Prova do Score (grupo de controle) */}
					{controle.length > 0 && (
						<section className="rounded-2xl bg-white p-6" style={{ boxShadow: CARD_SHADOW }}>
							<h2 className="mb-1 text-[16px] font-semibold text-[#1D1D1F]">Prova do Score</h2>
							<p className="mb-4 text-[13px] text-[#6E6E73]">Taxa de entrega real do grupo de controle (números que o Score segurou e foram enviados para medir).</p>
							<div className="space-y-2.5">
								{controle.map(c => (
									<div key={c.faixa} className="flex items-center gap-3">
										<span className="w-28 shrink-0 text-[13px] text-[#6E6E73]">{c.faixa}</span>
										<div className="h-6 flex-1 overflow-hidden rounded bg-[#F5F5F7]">
											<div className="flex h-full items-center justify-end rounded px-2 text-[12px] font-bold text-white tnum" style={{ width: `${Math.min(100, c.taxa_entrega || 0)}%`, minWidth: '2.5rem', backgroundColor: '#0A60D0' }}>{(c.taxa_entrega || 0).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%</div>
										</div>
									</div>
								))}
							</div>
						</section>
					)}

					{/* Tabela por campanha */}
					<section className="rounded-2xl bg-white p-5" style={{ boxShadow: CARD_SHADOW }}>
						<h2 className="mb-4 text-[16px] font-semibold text-[#1D1D1F]">Por campanha</h2>
						<div className="overflow-x-auto">
							<table className="w-full border-collapse text-[14px]">
								<thead><tr className="border-b border-[#E5E5EA] text-left text-[12px] font-semibold uppercase tracking-wide text-[#8E8E93]">
									<th className="py-2 pr-4">Campanha</th><th className="py-2 pr-4">Data</th><th className="py-2 pr-4 text-right">Lista</th><th className="py-2 pr-4 text-right">Não enviados</th><th className="py-2 pr-4 text-right">Sem o Score</th><th className="py-2 pr-4 text-right">Com o Score</th><th className="py-2 text-right">Economia líquida</th>
								</tr></thead>
								<tbody>
									{rows.map((r, i) => (
										<tr key={i} onClick={() => setCampanhaSel(campanhaSel === r.campanha_id ? 'all' : r.campanha_id)} className={`cursor-pointer border-b border-[#F0F0F2] hover:bg-[#F5F5F7] ${campanhaSel === r.campanha_id ? 'bg-[#F5F5F7]' : ''}`}>
											<td className="py-2.5 pr-4 text-[#1D1D1F]">{r.nome}</td>
											<td className="py-2.5 pr-4 tnum text-[#6E6E73]">{dateBR(r.dia)}</td>
											<td className="py-2.5 pr-4 text-right tnum">{num(r.analisados)}</td>
											<td className="py-2.5 pr-4 text-right tnum">{num(r.represados)}</td>
											<td className="py-2.5 pr-4 text-right tnum text-[#6E6E73]">{moneyBR(r.total_sem)}</td>
											<td className="py-2.5 pr-4 text-right tnum">{moneyBR(r.total_com)}</td>
											<td className="py-2.5 text-right tnum font-medium" style={{ color: r.economia >= 0 ? '#248A3D' : '#FF3B30' }}>{moneyBR(r.economia)}</td>
										</tr>
									))}
								</tbody>
							</table>
						</div>
						{campanhaSel !== 'all' && <p className="mt-3 text-[13px] text-[#0A60D0]">Filtrando uma campanha. <button onClick={() => setCampanhaSel('all')} className="underline">Ver todas</button></p>}
					</section>
				</>
			)}
		</>
	);
}

// ===================== VITRINE (sem Score contratado) =====================

function ScoreVitrine({ de, ate, setDe, setAte }: { de: string; ate: string; setDe: (v: string) => void; setAte: (v: string) => void; loading: boolean }) {
	const { empresa } = useMotorAuth();
	const [v, setV] = useState<Row | null>(null);
	const [vLoading, setVLoading] = useState(true);
	const [semSms, setSemSms] = useState(false);
	const [pedido, setPedido] = useState<'idle' | 'enviando' | 'enviado' | 'erro'>('idle');

	useEffect(() => {
		if (!supabase || !empresa) return;
		let active = true;
		setVLoading(true);
		(async () => {
			const { data, error } = await supabase.rpc('vitrine_score', { empresa: empresa.id, de, ate });
			if (!active) return;
			if (error) { setV(null); setSemSms(true); setVLoading(false); return; }
			const row = (data ?? null) as Row | null;
			setV(row);
			setSemSms(!row || !(+row.enviados > 0));
			setVLoading(false);
		})();
		return () => { active = false; };
	}, [empresa?.id, de, ate]);

	async function pedirProposta() {
		if (!supabase || !empresa) return;
		setPedido('enviando');
		const { error } = await supabase.from('chamados').insert({ empresa_id: empresa.id, motivo: 'mensageria', assunto: 'Proposta do Score de Entrega', prioridade: 'normal' });
		if (error) { setPedido('erro'); return; }
		setPedido('enviado');
	}

	if (vLoading) return <p className="py-8 text-center text-[14px] text-[#8E8E93]">Carregando...</p>;

	return (
		<>
			<div className="flex flex-wrap items-center gap-3">
				<input type="date" value={de} onChange={e => setDe(e.target.value)} className="h-9 rounded-lg border border-[#D2D2D7] bg-white px-3 text-[14px] outline-none" />
				<span className="text-[14px] text-[#8E8E93]">até</span>
				<input type="date" value={ate} onChange={e => setAte(e.target.value)} className="h-9 rounded-lg border border-[#D2D2D7] bg-white px-3 text-[14px] outline-none" />
			</div>

			{semSms ? (
				<div className="rounded-2xl bg-white p-10 text-center text-[14px] text-[#6E6E73]" style={{ boxShadow: CARD_SHADOW }}>Nenhum SMS enviado neste período.</div>
			) : v ? (
				<div className="rounded-2xl bg-white p-6" style={{ boxShadow: CARD_SHADOW }}>
					<p className="text-[12px] font-semibold uppercase tracking-wide text-[#8E8E93]">SMS que não chegaram · {dateBR(de)} a {dateBR(ate)}</p>
					<div className="mt-3 grid gap-6 sm:grid-cols-2">
						<div>
							<p className="text-[30px] font-bold tnum text-[#FF3B30]">{num(v.nao_entregues)}</p>
							<p className="mt-1 text-[13px] text-[#6E6E73]">{pct1(+v.nao_entregues, +v.enviados)} dos {num(v.enviados)} SMS enviados no período.</p>
						</div>
						<div>
							<p className="text-[30px] font-bold tnum text-[#1D1D1F]">{moneyBR(v.valor_nao_entregues)}</p>
							<p className="mt-1 text-[13px] text-[#6E6E73]">Pago por esses SMS · {num(v.nao_entregues)} × {money4(+v.preco_medio)}, o preço do SMS no seu contrato.</p>
						</div>
					</div>
					<p className="mt-5 border-t border-[#E5E5EA] pt-3 text-[12px] text-[#8E8E93]">Números reais das suas campanhas, pelo retorno das operadoras (DLR). Nada aqui é estimativa.</p>
				</div>
			) : null}

			<div className="grid gap-4 lg:grid-cols-2">
				<div className="rounded-2xl bg-white p-6" style={{ boxShadow: CARD_SHADOW }}>
					<h2 className="text-[16px] font-semibold text-[#1D1D1F]">Como o Score de Entrega reduz esse valor</h2>
					<ol className="mt-3 space-y-2.5">
						{['Antes do envio, o Score classifica cada número por probabilidade de entrega.', 'Os de baixa entrega são segurados: não saem e você não paga o SMS deles.', 'Só saem os números com chance real de chegar — o custo cai por SMS que chega.'].map((t, i) => (
							<li key={i} className="flex gap-2.5 text-[14px] leading-snug text-[#1D1D1F]"><span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-[#1D1D1F] text-[11px] font-bold text-white">{i + 1}</span>{t}</li>
						))}
					</ol>
				</div>
				<div className="rounded-2xl bg-white p-6" style={{ boxShadow: CARD_SHADOW }}>
					<h2 className="text-[16px] font-semibold text-[#1D1D1F]">O que aparece aqui com o Score</h2>
					<ul className="mt-3 space-y-2.5">
						{['Economia líquida do período (SMS evitados − custo do Score).', 'Custo unitário efetivo por número enviado.', 'Prova do Score: taxa de entrega real do grupo de controle.'].map((t, i) => (
							<li key={i} className="flex gap-2.5 text-[14px] leading-snug text-[#1D1D1F]"><span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-[#34C759]" />{t}</li>
						))}
					</ul>
					{pedido === 'enviado' ? (
						<p className="mt-4 rounded-xl bg-[#E8F8EC] px-4 py-3 text-[14px] text-[#248A3D]">Pedido enviado ao time comercial. Ele entra em contato pelo e-mail da empresa.</p>
					) : pedido === 'erro' ? (
						<p className="mt-4 rounded-xl bg-[#FFE8E6] px-4 py-3 text-[14px] text-[#FF3B30]">Não foi possível enviar agora. Tente de novo em instantes.</p>
					) : (
						<button onClick={pedirProposta} disabled={pedido === 'enviando'} className="mt-4 h-10 rounded-full bg-[#1D1D1F] px-6 text-[14px] font-semibold text-white disabled:opacity-50 hover:opacity-85">{pedido === 'enviando' ? 'Enviando...' : 'Pedir proposta do Score'}</button>
					)}
				</div>
			</div>
		</>
	);
}
