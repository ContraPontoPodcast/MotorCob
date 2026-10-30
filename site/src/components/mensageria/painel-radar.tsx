import { useCallback, useEffect, useState } from 'react';
import { Radar as RadarIcon, Clock, MessageSquare, TrendingUp, Hourglass } from 'lucide-react';
import { supabase, friendlyError, type Row } from '@/lib/supabase';
import { useMotorAuth } from '@/components/auth-provider';
import { useAreaLabel } from '@/components/tema-provider';
import { RADAR_CLASSES, RADAR_ORDEM, num, pct, periodoDatas } from '@/lib/mensageria-produtos';

const CARD_SHADOW = '0 0 0 1px #E5E5EA, 0 2px 12px rgba(0,0,0,.04)';

type Resumo = {
	respostas: number;
	entregues: number;
	primeira_resposta_mediana_min: number | null;
	esperando_agora: number;
	mais_antiga_min: number | null;
};

type ClasseRow = { classe: string; respostas: number; corrigidas: number };

type DesempenhoRow = { pessoa: string; atendidas: number; primeira_resposta_mediana: number | null; resolvidas: number };

function dateExtensa() {
	try { return new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date()); } catch { return ''; }
}

export function PainelRadar() {
	const { perfil, empresa } = useMotorAuth();
	const areaLabel = useAreaLabel();
	const [periodo, setPeriodo] = useState('7d');
	const [de, setDe] = useState('');
	const [ate, setAte] = useState('');
	const [resumo, setResumo] = useState<Resumo | null>(null);
	const [classes, setClasses] = useState<ClasseRow[]>([]);
	const [desempenho, setDesempenho] = useState<DesempenhoRow[]>([]);
	const [metaMin, setMetaMin] = useState<number | null>(null);
	const [loading, setLoading] = useState(true);
	const [erro, setErro] = useState('');

	const podeVerDesempenho = perfil?.papel === 'admin' || perfil?.papel === 'gestao';
	const { de: deIso, ate: ateIso } = periodoDatas(periodo, de, ate);

	const load = useCallback(async () => {
		if (!supabase || !empresa) return;
		setLoading(true); setErro('');
		const [r, c, d, cfg] = await Promise.all([
			supabase.rpc('resumo_atendimento', { empresa: empresa.id, de: deIso, ate: ateIso }),
			supabase.rpc('painel_radar', { empresa: empresa.id, de: deIso, ate: ateIso }),
			podeVerDesempenho ? supabase.rpc('desempenho_atendimento', { empresa: empresa.id, de: deIso, ate: ateIso }) : Promise.resolve({ data: null, error: null }),
			supabase.from('mensageria_config').select('meta_resposta_min').eq('empresa_id', empresa.id).maybeSingle(),
		]);
		if (r.error) { setErro(friendlyError(r.error)); setLoading(false); return; }
		if (c.error) { setErro(friendlyError(c.error)); }
		setResumo((r.data as Resumo | null) ?? null);
		setClasses(((c.data ?? []) as Row[]).map(row => ({
			classe: String(row.classe ?? ''),
			respostas: Number(row.respostas ?? 0),
			corrigidas: Number(row.corrigidas ?? 0),
		})));
		setDesempenho(((d.data ?? []) as Row[]).map(row => ({
			pessoa: String(row.pessoa ?? row.nome ?? '—'),
			atendidas: Number(row.atendidas ?? 0),
			primeira_resposta_mediana: row.primeira_resposta_mediana == null ? null : Number(row.primeira_resposta_mediana),
			resolvidas: Number(row.resolvidas ?? 0),
		})));
		const mv = (cfg.data as Row | null)?.meta_resposta_min;
		setMetaMin(mv == null ? null : Number(mv));
		setLoading(false);
	}, [empresa?.id, deIso, ateIso, podeVerDesempenho]);

	useEffect(() => { void load(); }, [load]);

	const totalRespostas = classes.reduce((s, r) => s + r.respostas, 0) || resumo?.respostas || 0;
	const cpcNegocio = classes.find(c => c.classe === 'cpc_negocio')?.respostas ?? 0;
	const totalCorrigidas = classes.reduce((s, r) => s + r.corrigidas, 0);

	return (
		<div className="mx-auto max-w-[1480px] px-4 py-6 sm:px-[clamp(16px,3vw,40px)]">
			{/* Cabeçalho */}
			<div className="mb-5 flex flex-wrap items-start justify-between gap-3">
				<div className="min-w-0">
					<span className="mc-area-tag mb-1.5">{areaLabel}</span>
					<h1 className="mc-page-title text-[28px] font-bold leading-tight tracking-tight text-[#1D1D1F]">Painel do Radar</h1>
					<p className="mt-1 text-[14px] text-[#6E6E73]">{empresa?.nome ?? '—'} · {dateExtensa()}</p>
				</div>
				<div className="flex flex-wrap items-center gap-2">
					<select value={periodo} onChange={e => setPeriodo(e.target.value)} className="h-9 rounded-lg border border-[#D2D2D7] bg-white px-3 text-[14px] outline-none focus-visible:ring-2 focus-visible:ring-[#0071E5]/40">
						<option value="7d">Últimos 7 dias</option>
						<option value="mes_atual">Este mês</option>
						<option value="personalizado">Datas</option>
					</select>
					{periodo === 'personalizado' && (<>
						<input type="date" value={de} onChange={e => setDe(e.target.value)} className="h-9 rounded-lg border border-[#D2D2D7] bg-white px-3 text-[14px] outline-none" />
						<span className="text-[14px] text-[#8E8E93]">até</span>
						<input type="date" value={ate} onChange={e => setAte(e.target.value)} className="h-9 rounded-lg border border-[#D2D2D7] bg-white px-3 text-[14px] outline-none" />
					</>)}
				</div>
			</div>

			{erro && <div className="mb-4 rounded-xl bg-[#FFE8E6] px-4 py-3 text-[14px] text-[#FF3B30]">{erro}</div>}

			{loading ? (
				<p className="py-12 text-center text-[14px] text-[#8E8E93]">Carregando...</p>
			) : (
				<div className="space-y-5">
					{/* Quatro números */}
					<div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
						<NumeroCard
							icone={<MessageSquare size={16} />}
							titulo="Respostas recebidas"
							valor={num(resumo?.respostas ?? 0)}
							sub={resumo && resumo.entregues > 0 ? `de ${num(resumo.entregues)} mensagens entregues (${pct(resumo.respostas, resumo.entregues)})` : undefined}
						/>
						<NumeroCard
							icone={<TrendingUp size={16} />}
							titulo="CPC Negócio"
							valor={num(cpcNegocio)}
							sub={totalRespostas > 0 ? `${pct(cpcNegocio, totalRespostas)} das respostas` : undefined}
							cor="#1F8A4C"
						/>
						<NumeroCard
							icone={<Clock size={16} />}
							titulo="Primeira resposta (mediana)"
							valor={resumo?.primeira_resposta_mediana_min != null ? `${resumo.primeira_resposta_mediana_min} min` : '—'}
							sub={metaMin != null ? `meta da empresa: ${metaMin} min` : 'sem meta definida'}
						/>
						<NumeroCard
							icone={<Hourglass size={16} />}
							titulo="Esperando resposta agora"
							valor={num(resumo?.esperando_agora ?? 0)}
							sub={resumo?.mais_antiga_min != null ? `a mais antiga há ${resumo.mais_antiga_min} min` : undefined}
							cor="#FF9500"
						/>
					</div>

					{/* Respostas por classe */}
					<section className="rounded-2xl bg-white p-6" style={{ boxShadow: CARD_SHADOW }}>
						<h2 className="text-[16px] font-semibold text-[#1D1D1F]">Respostas por classe</h2>
						<p className="mt-0.5 text-[13px] text-[#6E6E73]">Corrigidas pela equipe mede onde o Radar mais erra.</p>
						{classes.length === 0 ? (
							<p className="py-6 text-center text-[14px] text-[#8E8E93]">Sem respostas no período.</p>
						) : (
							<div className="mt-4 overflow-x-auto">
								<table className="w-full border-collapse text-[14px]">
									<thead><tr className="border-b border-[#E5E5EA] text-left text-[12px] font-semibold uppercase tracking-wide text-[#8E8E93]">
										<th className="py-2 pr-4">Classe</th><th className="py-2 pr-4 text-right">Respostas</th><th className="py-2 pr-4 text-right">%</th><th className="py-2 pr-4 text-right">Corrigidas pela equipe</th>
									</tr></thead>
									<tbody>
										{[...classes].sort((a, b) => RADAR_ORDEM.indexOf(a.classe) - RADAR_ORDEM.indexOf(b.classe)).map(c => {
											const info = RADAR_CLASSES[c.classe] ?? { label: c.classe, cor: '#8E8E93' };
											const corrigidasPct = c.respostas > 0 ? (c.corrigidas / c.respostas) * 100 : 0;
											return (
												<tr key={c.classe} className="border-b border-[#F0F0F2]">
													<td className="py-2.5 pr-4 text-[#1D1D1F]"><span className="inline-flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: info.cor }} />{info.label}</span></td>
													<td className="py-2.5 pr-4 text-right tnum">{num(c.respostas)}</td>
													<td className="py-2.5 pr-4 text-right tnum text-[#6E6E73]">{pct(c.respostas, totalRespostas)}</td>
													<td className="py-2.5 pr-4 text-right tnum">
														<span className="inline-flex items-center gap-2">
															{corrigidasPct > 10 && <span className="rounded-full bg-[#FFF3E8] px-1.5 py-0.5 text-[11px] font-semibold text-[#9a631b]">revisar</span>}
															<span className="text-[#1D1D1F]">{num(c.corrigidas)}</span>
															<span className="text-[#8E8E93]">({pct(c.corrigidas, c.respostas)})</span>
														</span>
													</td>
												</tr>
											);
										})}
									</tbody>
								</table>
							</div>
						)}
						{totalCorrigidas > 0 && <p className="mt-3 text-[13px] text-[#6E6E73]">{num(totalCorrigidas)} respostas reclassificadas pela equipe no total.</p>}
					</section>

					{/* Por quem atende (só Admin e Gestão) */}
					{podeVerDesempenho && (
						<section className="rounded-2xl bg-white p-6" style={{ boxShadow: CARD_SHADOW }}>
							<h2 className="text-[16px] font-semibold text-[#1D1D1F]">Por quem atende</h2>
							<p className="mt-0.5 text-[13px] text-[#6E6E73]">Sigiloso — só Admin e Gestão veem.</p>
							{desempenho.length === 0 ? (
								<p className="py-6 text-center text-[14px] text-[#8E8E93]">Sem atendimentos no período.</p>
							) : (
								<div className="mt-4 overflow-x-auto">
									<table className="w-full border-collapse text-[14px]">
										<thead><tr className="border-b border-[#E5E5EA] text-left text-[12px] font-semibold uppercase tracking-wide text-[#8E8E93]">
											<th className="py-2 pr-4">Pessoa</th><th className="py-2 pr-4 text-right">Atendidas</th><th className="py-2 pr-4 text-right">Primeira resposta (mediana)</th><th className="py-2 pr-4 text-right">Resolvidas</th>
										</tr></thead>
										<tbody>
											{desempenho.map((d, i) => (
												<tr key={i} className="border-b border-[#F0F0F2]">
													<td className="py-2.5 pr-4 text-[#1D1D1F]">{d.pessoa}</td>
													<td className="py-2.5 pr-4 text-right tnum">{num(d.atendidas)}</td>
													<td className="py-2.5 pr-4 text-right tnum text-[#6E6E73]">{d.primeira_resposta_mediana != null ? `${d.primeira_resposta_mediana} min` : '—'}</td>
													<td className="py-2.5 pr-4 text-right tnum">{num(d.resolvidas)}</td>
												</tr>
											))}
										</tbody>
									</table>
								</div>
							)}
						</section>
					)}
				</div>
			)}
		</div>
	);
}

function NumeroCard({ icone, titulo, valor, sub, cor }: { icone: React.ReactNode; titulo: string; valor: string; sub?: string; cor?: string }) {
	return (
		<div className="rounded-2xl bg-white p-5" style={{ boxShadow: CARD_SHADOW }}>
			<div className="flex items-center gap-1.5 text-[#8E8E93]">
				{icone}
				<p className="text-[12px] font-semibold uppercase tracking-wide">{titulo}</p>
			</div>
			<p className="mt-2 text-[26px] font-bold tnum" style={{ color: cor ?? '#1D1D1F' }}>{valor}</p>
			{sub && <p className="mt-0.5 text-[12px] tnum text-[#8E8E93]">{sub}</p>}
		</div>
	);
}
