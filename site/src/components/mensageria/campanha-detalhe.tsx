import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router';
import { ArrowLeft } from 'lucide-react';
import { supabase, friendlyError, dateTimeBR, type Row } from '@/lib/supabase';
import { useMotorAuth } from '@/components/auth-provider';
import { PRODUTO_MAP, SIT_CAMPANHA, isCanalValido, num, pct } from '@/lib/mensageria-produtos';
import { INFO_DEFS } from '@/lib/mensageria-info';
import { InfoButton } from '@/components/mensageria/info-button';
import { exportarCsv } from '@/lib/mensageria';

type StatusRow = Record<string, any>;
function g(r: StatusRow, k: string): number { return Number(r?.[k] ?? 0); }

export function CampanhaDetalhe() {
	const { canal, id } = useParams();
	const { empresa, permissoes } = useMotorAuth();
	const canAct = permissoes.includes('enviar_mensagens');
	const [camp, setCamp] = useState<Row | null>(null);
	const [funilRows, setFunilRows] = useState<StatusRow[]>([]);
	const [links, setLinks] = useState<Row | null>(null);
	const [cliques, setCliques] = useState<Row[]>([]);
	const [linkRows, setLinkRows] = useState<Row[]>([]);
	const [loading, setLoading] = useState(true);
	const [erro, setErro] = useState('');

	useEffect(() => {
		if (!supabase || !empresa || !id) return;
		let active = true;
		(async () => {
			const [{ data: c, error: ec }, { data: f }, { data: l }, { data: cl }, { data: lr }] = await Promise.all([
					supabase.from('mensageria_campanhas').select('*, mensageria_templates(nome), mensageria_centros_custo(nome)').eq('id', id).maybeSingle(),
				supabase.from('mensageria_funil_status').select('*').eq('empresa_id', empresa.id).eq('campanha_id', id),
				supabase.from('mensageria_funil_links').select('*').eq('empresa_id', empresa.id).eq('campanha_id', id).maybeSingle(),
				supabase.from('mensageria_cliques').select('clicado_em,dispositivo,mensageria_links!inner(campanha_id)').eq('mensageria_links.campanha_id', id),
				supabase.from('mensageria_links').select('id_cliente,codigo,mensageria_cliques(clicado_em,dispositivo)').eq('campanha_id', id),
			]);
			if (!active) return;
			if (ec) { setErro(friendlyError(ec)); setLoading(false); return; }
			setCamp(c as Row | null);
			setFunilRows((f ?? []) as StatusRow[]);
			setLinks(l as Row | null);
			setCliques(cl ?? []);
			setLinkRows(lr ?? []);
			setLoading(false);
		})();
		return () => { active = false; };
	}, [empresa?.id, id]);

	const porHora = useMemo(() => {
		const h: number[] = new Array(24).fill(0);
		cliques.forEach(c => { try { const hr = new Date(c.clicado_em).getHours(); h[hr]++; } catch { /* ignore */ } });
		return h;
	}, [cliques]);

	const porDispositivo = useMemo(() => {
		const d: Record<string, number> = { celular: 0, computador: 0, outro: 0 };
		cliques.forEach(c => { const disp = (c.dispositivo as string) ?? 'outro'; d[disp in d ? disp : 'outro']++; });
		return d;
	}, [cliques]);

	const quemClicou = useMemo(() => linkRows.filter(r => Array.isArray(r.mensageria_cliques) && r.mensageria_cliques.length > 0), [linkRows]);

	if (!isCanalValido(canal)) return null;
	if (loading) return <p className="py-8 text-center text-[14px] text-[#8E8E93]">Carregando...</p>;
	if (erro) return <div className="rounded-xl bg-[#FFE8E6] px-4 py-3 text-[14px] text-[#FF3B30]">{erro}</div>;
	if (!camp) return <div className="rounded-2xl bg-white p-10 text-center text-[14px] text-[#6E6E73]" style={{ boxShadow: '0 0 0 1px #E5E5EA, 0 2px 12px rgba(0,0,0,.04)' }}>Campanha não encontrada.</div>;

	const cor = PRODUTO_MAP[canal].cor;
	const sit = SIT_CAMPANHA[camp.situacao as string] ?? { label: camp.situacao, cor: '#6E6E73', bg: '#F5F5F7' };
	const f: Record<string, number> = {};
	funilRows.forEach(r => { for (const k of Object.keys(r)) f[k] = (f[k] ?? 0) + g(r, k); });
	const l = links ?? {};
	const maxHora = Math.max(1, ...porHora);
	const totalDisp = porDispositivo.celular + porDispositivo.computador + porDispositivo.outro;

	return (
		<div className="space-y-5">
			<Link to={`/mensageria/${canal}/campanhas`} className="inline-flex items-center gap-1.5 text-[14px] font-medium text-[#0A60D0] hover:underline"><ArrowLeft size={15} /> Voltar</Link>

			<div className="rounded-2xl bg-white p-6" style={{ boxShadow: '0 0 0 1px #E5E5EA, 0 2px 12px rgba(0,0,0,.04)' }}>
				<div className="flex flex-wrap items-center gap-3">
					<h1 className="text-[20px] font-bold text-[#1D1D1F]">{camp.nome}</h1>
					<span className="inline-flex items-center rounded-full px-2.5 py-0.5 text-[12px] font-semibold" style={{ color: sit.cor, backgroundColor: sit.bg }}>{sit.label}</span>
				</div>
				<div className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-[14px] text-[#6E6E73]">
					<span>Template: {(camp.mensageria_templates as Row)?.nome ?? '—'}</span>
					<span>Centro de custo: {(camp.mensageria_centros_custo as Row)?.nome ?? '—'}</span>
					<span>Criada: {dateTimeBR(camp.criado_em)}</span>
					{camp.rastrear_links && <span>Rastrear links: Sim</span>}
				</div>
			</div>

			{/* Funil de entrega */}
			<section className="rounded-2xl bg-white p-6" style={{ boxShadow: '0 0 0 1px #E5E5EA, 0 2px 12px rgba(0,0,0,.04)' }}>
				<h2 className="mb-4 text-[16px] font-semibold text-[#1D1D1F]">Funil de entrega</h2>
				<div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-6">
					{([
						['Carregados', f.carregados, 'carregados'],
						['Higienizados', f.higienizados, 'higienizados'],
						['Disparados', f.disparados, canal === 'email' ? 'disparados_email' : canal === 'rcs' ? 'disparados_rcs' : 'disparados_sms'],
						['Enviados', f.enviados, 'enviados'],
						['Entregues', f.entregues, canal === 'email' ? 'entregues_email' : 'entregues_sms'],
						['Não entregues', f.nao_entregues, 'nao_entregues'],
					] as [string, number, string][]).map(([label, v, info]) => (
						<div key={label}><div className="flex items-center gap-1.5"><p className="text-[12px] font-semibold uppercase text-[#8E8E93]">{label}</p><InfoButton def={INFO_DEFS[info]} /></div><p className="mt-1 text-[22px] font-bold tnum text-[#1D1D1F]">{num(v)}</p></div>
					))}
				</div>
			</section>

			{/* Funil de engajamento */}
			{l.links > 0 && (
				<section className="rounded-2xl bg-white p-6" style={{ boxShadow: '0 0 0 1px #E5E5EA, 0 2px 12px rgba(0,0,0,.04)' }}>
					<h2 className="mb-4 text-[16px] font-semibold text-[#1D1D1F]">Funil de engajamento</h2>
					<div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-5">
						{[['Enviados', +l.enviados], ['Entregues', +l.entregues], ['Clicaram', +l.clicaram], ['Responderam', +l.responderam], ['CPC Negócio', +l.cpc_negocio]].map(([label, v]) => (
							<div key={label as string}><p className="text-[12px] font-semibold uppercase text-[#8E8E93]">{label}</p><p className="mt-1 text-[22px] font-bold tnum text-[#1D1D1F]">{num(v)}</p></div>
						))}
					</div>
					<p className="mt-4 text-[13px] text-[#6E6E73]">Cliques no total {num(l.cliques)} · Links gerados {num(l.links)}</p>
				</section>
			)}

			{/* Cliques por hora e dispositivo */}
			{cliques.length > 0 && (
				<section className="rounded-2xl bg-white p-6" style={{ boxShadow: '0 0 0 1px #E5E5EA, 0 2px 12px rgba(0,0,0,.04)' }}>
					<h2 className="mb-4 text-[16px] font-semibold text-[#1D1D1F]">Cliques por hora e aparelho</h2>
					<div className="grid gap-6 lg:grid-cols-2">
						<div>
							<div className="flex items-end gap-1" style={{ height: 120 }}>
								{porHora.map((v, h) => <div key={h} className="flex-1 rounded-t bg-[#F5F5F7]" style={{ height: `${(v / maxHora) * 100}%`, backgroundColor: v > 0 ? cor : '#F5F5F7' }} title={`${h}h: ${v}`} />)}
							</div>
							<div className="mt-1 flex justify-between text-[10px] text-[#8E8E93]"><span>0h</span><span>12h</span><span>23h</span></div>
						</div>
						<div className="space-y-2">
							{[['celular', 'Celular'], ['computador', 'Computador'], ['outro', 'Outro']].map(([k, label]) => (
								<div key={k} className="flex items-center gap-3">
									<span className="w-24 text-[14px] text-[#6E6E73]">{label}</span>
									<div className="h-5 flex-1 overflow-hidden rounded bg-[#F5F5F7]"><div className="h-full rounded" style={{ width: `${totalDisp ? (porDispositivo[k] / totalDisp) * 100 : 0}%`, backgroundColor: cor }} /></div>
									<span className="w-10 text-right text-[14px] tnum text-[#1D1D1F]">{porDispositivo[k]}</span>
								</div>
							))}
						</div>
					</div>
				</section>
			)}

			{/* Quem clicou */}
			{canAct && quemClicou.length > 0 && (
				<section className="rounded-2xl bg-white p-5" style={{ boxShadow: '0 0 0 1px #E5E5EA, 0 2px 12px rgba(0,0,0,.04)' }}>
					<div className="mb-4 flex items-center justify-between">
						<h2 className="text-[16px] font-semibold text-[#1D1D1F]">Quem clicou</h2>
						<button onClick={() => exportarCsv('quem-clicou.csv', ['ID do cliente', 'Primeiro clique', 'Cliques', 'Aparelho'], quemClicou.map(r => { const cl = (r.mensageria_cliques as Row[]) ?? []; const primeiro = cl[0]?.clicado_em ? dateTimeBR(cl[0].clicado_em) : '—'; return [r.id_cliente, primeiro, cl.length, cl[0]?.dispositivo ?? '—']; }))} className="flex h-9 items-center gap-2 rounded-full border border-[#D2D2D7] px-4 text-[14px] font-medium text-[#1D1D1F] hover:bg-[#F5F5F7]">Exportar CSV</button>
					</div>
					<div className="overflow-x-auto">
						<table className="w-full border-collapse text-[14px]">
							<thead><tr className="border-b border-[#E5E5EA] text-left text-[12px] font-semibold uppercase tracking-wide text-[#8E8E93]">
								<th className="py-2 pr-4">ID do cliente</th><th className="py-2 pr-4">Primeiro clique</th><th className="py-2 pr-4 text-right">Cliques</th><th className="py-2">Aparelho</th>
							</tr></thead>
							<tbody>
								{quemClicou.map((r, i) => { const cl = (r.mensageria_cliques as Row[]) ?? []; return (
									<tr key={i} className="border-b border-[#F0F0F2]">
										<td className="py-2.5 pr-4 tnum text-[#1D1D1F]">{r.id_cliente}</td>
										<td className="py-2.5 pr-4 tnum text-[#6E6E73]">{cl[0]?.clicado_em ? dateTimeBR(cl[0].clicado_em) : '—'}</td>
										<td className="py-2.5 pr-4 text-right tnum">{cl.length}</td>
										<td className="py-2.5 text-[#6E6E73]">{cl[0]?.dispositivo ?? '—'}</td>
									</tr>
								); })}
							</tbody>
						</table>
					</div>
				</section>
			)}
		</div>
	);
}
