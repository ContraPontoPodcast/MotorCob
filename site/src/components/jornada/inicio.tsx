import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { Empty, Loading, Notice } from '@/components/app-shell';
import { useJornadaCarteira, JornadaHeading, SemCarteiraCard } from '@/components/jornada/jornada-shell';
import { ChartNoAxesCombined } from 'lucide-react';
import { dateBR, friendlyError, moneyBR, numberBR, supabase, today, type Row } from '@/lib/supabase';
import { MOMENTOS } from '@/lib/jornada';
import { fetchMapa, fetchResultado, pct1, periodoDe, taxaDe, totais, type MapaMomento, type ResultadoCanal } from '@/lib/jornada-resultado';

export function JornadaInicio() {
	const { empresa, carteiras, carteira, loading: cLoading } = useJornadaCarteira();
	const [resumo, setResumo] = useState<Row[]>([]);
	const [rodada, setRodada] = useState<string>(today());
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState('');
	const [mapa, setMapa] = useState<MapaMomento[]>([]);
	const [res, setRes] = useState<ResultadoCanal[]>([]);
	const [aLoading, setALoading] = useState(true);

	useEffect(() => {
		if (!supabase || !empresa || !carteira) { setResumo([]); setLoading(false); return; }
		let active = true;
		setLoading(true); setError('');
		supabase.from('jornada_resumo').select('data,momento,motivo,clientes')
			.eq('empresa_id', empresa.id).eq('credor_id', carteira.id)
			.order('data', { ascending: false }).limit(500)
			.then(({ data, error }) => {
				if (!active) return;
				if (error) { setError(friendlyError()); setLoading(false); return; }
				const rows = (data ?? []) as Row[];
				setResumo(rows);
				if (rows.length) setRodada(String(rows[0].data));
				setLoading(false);
			});
		return () => { active = false; };
	}, [empresa?.id, carteira?.id]);

	// Cartões e os 4 números de 30 dias: mapa_jornada e resultado_jornada (SQL 40). O detalhe fica no Painel.
	useEffect(() => {
		if (!empresa || !carteira) { setMapa([]); setRes([]); setALoading(false); return; }
		let active = true;
		setALoading(true);
		const p = periodoDe(30);
		Promise.all([fetchMapa(carteira.id, p), fetchResultado(carteira.id, p)])
			.then(([m, r]) => { if (active) { setMapa(m); setRes(r); setALoading(false); } })
			.catch(() => { if (active) { setMapa([]); setRes([]); setALoading(false); } });
		return () => { active = false; };
	}, [empresa?.id, carteira?.id]);

	const diaRows = useMemo(() => resumo.filter(r => String(r.data) === rodada), [resumo, rodada]);

	const cards = useMemo(() => MOMENTOS.map(m => {
		const x = mapa.find(r => r.momento === m.id);
		return { m, total: x?.no_momento ?? 0, comAcao: x?.com_acao ?? 0, taxa: x ? taxaDe(x.sucesso, x.sucesso + x.nao) : null };
	}), [mapa]);
	const t30 = useMemo(() => totais(mapa, res), [mapa, res]);

	const fora = useMemo(() => {
		const map: Record<string, number> = {};
		diaRows.filter(r => String(r.momento) === '' || String(r.motivo) !== 'com ação hoje').forEach(r => {
			const k = String(r.motivo) || 'sem motivo';
			map[k] = (map[k] ?? 0) + (Number(r.clientes) || 0);
		});
		return Object.entries(map).sort((a, b) => b[1] - a[1]);
	}, [diaRows]);

	if (cLoading) return <div className="mc-platform"><Loading /></div>;
	if (carteiras.length === 0) return <><JornadaHeading title="Jornada" /><SemCarteiraCard /></>;
	if (!carteira) return <div className="mc-platform"><Loading /></div>;

	const linha = `${empresa?.nome ?? ''} · ${carteira.nome} · rodada de ${dateBR(rodada)}`;

	return (
		<>
			<JornadaHeading title="Jornada" linha={linha} />
			{error && <div className="mb-5"><Notice>{error}</Notice></div>}

			{!loading && resumo.length === 0 ? (
				<div className="rounded-2xl bg-white p-10 text-center" style={{ boxShadow: '0 0 0 1px var(--base-borda), 0 2px 12px rgba(0,0,0,.04)' }}>
					<span className="mc-area-tag mb-3">Jornada do Cliente</span>
					<h2 className="text-[18px] font-semibold text-[#1D1D1F]">Jornada</h2>
					<p className="mx-auto mt-2 max-w-sm text-[14px] text-[#6E6E73]">Os clientes aparecem aqui depois da primeira carga, já em uma etapa da jornada.</p>
					<Link to="/jornada/cargas" className="mt-5 inline-flex h-10 items-center gap-2 rounded-full bg-[#1D1D1F] px-5 text-[14px] font-medium text-white hover:opacity-85">Enviar a primeira carga</Link>
				</div>
			) : (
			<>
			<section className="mb-8">
				<div className="mb-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
					<h2 className="text-[13px] font-semibold uppercase tracking-wide text-[#8E8E93]">Momentos da jornada</h2>
					<p className="text-[12.5px] text-[#6E6E73]">Quem está em cada momento hoje e quanto deu certo nos últimos 30 dias.</p>
				</div>
				{loading || aLoading ? <Loading /> : (
					<div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5 lg:gap-4">
						{cards.map(({ m, total, comAcao, taxa }) => (
							<div key={m.id} className="min-w-0 rounded-2xl border border-[#E5E5EA] bg-white p-4 lg:p-5" style={{ boxShadow: '0 0 0 1px var(--base-borda), 0 2px 12px rgba(0,0,0,.04)' }}>
								<p className="text-[13px] font-semibold text-[#1D1D1F]">{m.nome}</p>
								<p className="mt-1 text-[11px] text-[#8E8E93]">{m.descricao}</p>
								<p className="mt-3 text-[24px] font-bold tracking-tight text-[#1D1D1F] tnum lg:mt-4 lg:text-[28px]">{numberBR(comAcao)}</p>
								<p className="text-[12px] text-[#6E6E73]">com ação hoje · {numberBR(total)} no momento</p>
								<div className="mt-2.5 flex justify-between border-t border-[#F0F0F2] pt-2.5 text-[12px] text-[#6E6E73]">
									<span>Resultado 30 dias</span>
									<b className="text-[#1D1D1F] tnum">{pct1(taxa)}</b>
								</div>
							</div>
						))}
					</div>
				)}
			</section>

			<div className="grid gap-4 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
				<section className="min-w-0 rounded-2xl border border-[#E5E5EA] bg-white p-5" style={{ boxShadow: '0 0 0 1px var(--base-borda), 0 2px 12px rgba(0,0,0,.04)' }}>
					<h2 className="mb-3 text-[13px] font-semibold uppercase tracking-wide text-[#8E8E93]">Quem ficou de fora hoje</h2>
					{loading ? <Loading /> : fora.length === 0 ? <Empty>Ninguém fora da jornada hoje.</Empty> : (
						<ul className="divide-y divide-[color:var(--base-separator)]">
							{fora.map(([motivo, n]) => (
								<li key={motivo} className="flex items-center justify-between py-3 text-[14px]">
									<span className="text-[#1D1D1F]">{motivo}</span>
									<span className="font-semibold text-[#1D1D1F] tnum">{numberBR(n)}</span>
								</li>
							))}
						</ul>
					)}
				</section>

				<section className="min-w-0 rounded-2xl border border-[#E5E5EA] bg-white p-5" style={{ boxShadow: '0 0 0 1px var(--base-borda), 0 2px 12px rgba(0,0,0,.04)' }}>
					<h2 className="mb-3 text-[13px] font-semibold uppercase tracking-wide text-[#8E8E93]">Últimos 30 dias</h2>
					{aLoading ? <Loading /> : (
						<>
							<div className="grid grid-cols-2 gap-3">
								<div><p className="text-[12px] text-[#6E6E73]">Acionamentos</p><p className="mt-1 text-[24px] font-bold tracking-tight text-[#1D1D1F] tnum">{numberBR(t30.acionamentos)}</p></div>
								<div><p className="text-[12px] text-[#6E6E73]">Deu certo</p><p className="mt-1 text-[24px] font-bold tracking-tight text-[#1D1D1F] tnum">{numberBR(t30.sucesso)}</p><p className="text-[12px] text-[#6E6E73]">taxa de {pct1(taxaDe(t30.sucesso, t30.fechados))}</p></div>
								<div><p className="text-[12px] text-[#6E6E73]">Custo por resultado</p><p className="mt-1 text-[24px] font-bold tracking-tight text-[#1D1D1F] tnum">{t30.sucesso > 0 ? moneyBR(t30.custo / t30.sucesso) : '—'}</p></div>
								<div><p className="text-[12px] text-[#6E6E73]">Foram para a cobrança</p><p className="mt-1 text-[24px] font-bold tracking-tight text-[#1D1D1F] tnum">{numberBR(t30.cobranca)}</p></div>
							</div>
							<p className="mb-2 mt-3 text-[12.5px] text-[#6E6E73]">O detalhe por canal e por mensagem fica no Painel.</p>
							<Link to={`/jornada/painel?carteira=${encodeURIComponent(carteira.codigo)}`} className="inline-flex h-[30px] items-center gap-1.5 rounded-full border border-[#D2D2D7] px-3 text-[12.5px] font-semibold text-[#1D1D1F] hover:bg-[#F5F5F7]">Abrir o Painel <ChartNoAxesCombined size={14} /></Link>
						</>
					)}
				</section>
			</div>
			</>
			)}
		</>
	);
}
