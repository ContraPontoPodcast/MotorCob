import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { Empty, Loading, Notice } from '@/components/app-shell';
import { useJornadaCarteira, JornadaHeading, SemCarteiraCard } from '@/components/jornada/jornada-shell';
import { dateBR, friendlyError, numberBR, supabase, today, type Row } from '@/lib/supabase';
import { fetchAcoes, periodo30 } from '@/lib/acoes';
import { MOMENTOS, REGUA_NOME, CANAL_NOME, momentoAtivo } from '@/lib/jornada';

export function JornadaInicio() {
	const { empresa, carteiras, carteira, loading: cLoading } = useJornadaCarteira();
	const [resumo, setResumo] = useState<Row[]>([]);
	const [rodada, setRodada] = useState<string>(today());
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState('');
	const [acoes, setAcoes] = useState<Row[]>([]);
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

	useEffect(() => {
		if (!empresa || !carteira) { setAcoes([]); setALoading(false); return; }
		let active = true;
		setALoading(true);
		const p = periodo30();
		fetchAcoes(empresa.id, p.de, p.ate, carteira.id).then(rows => { if (active) { setAcoes(rows as unknown as Row[]); setALoading(false); } }).catch(() => { if (active) { setAcoes([]); setALoading(false); } });
		return () => { active = false; };
	}, [empresa?.id, carteira?.id]);

	const diaRows = useMemo(() => resumo.filter(r => String(r.data) === rodada), [resumo, rodada]);

	const cards = useMemo(() => MOMENTOS.map(m => {
		const rows = diaRows.filter(r => String(r.momento) === m.id);
		const total = rows.reduce((s, r) => s + (Number(r.clientes) || 0), 0);
		const comAcao = rows.filter(r => String(r.motivo) === 'com ação hoje').reduce((s, r) => s + (Number(r.clientes) || 0), 0);
		return { m, total, comAcao, ativo: momentoAtivo({ recencia_horas: 48, momentos: {} }, m.id) };
	}), [diaRows]);

	const fora = useMemo(() => {
		const map: Record<string, number> = {};
		diaRows.filter(r => String(r.momento) === '' || String(r.motivo) !== 'com ação hoje').forEach(r => {
			const k = String(r.motivo) || 'sem motivo';
			map[k] = (map[k] ?? 0) + (Number(r.clientes) || 0);
		});
		return Object.entries(map).sort((a, b) => b[1] - a[1]);
	}, [diaRows]);

	const acoesAgrup = useMemo(() => {
		const porRegua: Record<string, number> = {};
		const porReguaCanal: Record<string, Record<string, number>> = {};
		for (const r of acoes) {
			const regua = String(r.regua ?? '');
			if (!REGUA_NOME[regua]) continue;
			const env = Number(r.enviadas) || 0;
			porRegua[regua] = (porRegua[regua] ?? 0) + env;
			const canal = String(r.canal ?? '');
			porReguaCanal[regua] = porReguaCanal[regua] ?? {};
			porReguaCanal[regua][canal] = (porReguaCanal[regua][canal] ?? 0) + env;
		}
		const max = Math.max(1, ...Object.values(porRegua));
		return MOMENTOS.map(m => ({ m, total: porRegua[m.id] ?? 0, canais: porReguaCanal[m.id] ?? {}, max }));
	}, [acoes]);

	if (cLoading) return <div className="mc-platform"><Loading /></div>;
	if (carteiras.length === 0) return <><JornadaHeading title="Jornada" /><SemCarteiraCard /></>;
	if (!carteira) return <div className="mc-platform"><Loading /></div>;

	const linha = `${empresa?.nome ?? ''} · ${carteira.nome} · ${dateBR(rodada)}`;

	return (
		<>
			<JornadaHeading title="Jornada" linha={linha} />
			{error && <div className="mb-5"><Notice>{error}</Notice></div>}

			{!loading && resumo.length === 0 ? (
				<div className="rounded-2xl bg-white p-10 text-center" style={{ boxShadow: '0 0 0 1px #E5E5EA, 0 2px 12px rgba(0,0,0,.04)' }}>
					<span className="mc-area-tag mb-3">Jornada do Cliente</span>
					<h2 className="text-[18px] font-semibold text-[#1D1D1F]">Jornada</h2>
					<p className="mx-auto mt-2 max-w-sm text-[14px] text-[#6E6E73]">Os clientes aparecem aqui depois da primeira carga, já em uma etapa da jornada.</p>
					<Link to="/jornada/cargas" className="mt-5 inline-flex h-10 items-center gap-2 rounded-full bg-[#1D1D1F] px-5 text-[14px] font-medium text-white hover:opacity-85">Enviar a primeira carga</Link>
				</div>
			) : (
			<>
			<section className="mb-8">
				<h2 className="mb-3 text-[13px] font-semibold uppercase tracking-wide text-[#8E8E93]">Momentos da jornada</h2>
				{loading ? <Loading /> : (
					<div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
						{cards.map(({ m, total, comAcao, ativo }) => (
							<div key={m.id} className={`rounded-2xl border p-5 ${ativo ? 'border-[#E5E5EA] bg-white' : 'border-[#E5E5EA] bg-[#F5F5F7] opacity-70'}`} style={{ boxShadow: '0 0 0 1px #E5E5EA, 0 2px 12px rgba(0,0,0,.04)' }}>
								<p className="text-[13px] font-semibold text-[#1D1D1F]">{m.nome}</p>
								<p className="mt-1 text-[11px] text-[#8E8E93]">{m.descricao}</p>
								{ativo ? (
									<>
										<p className="mt-4 text-[28px] font-bold tracking-tight text-[#1D1D1F] tnum">{numberBR(comAcao)}</p>
										<p className="text-[12px] text-[#6E6E73]">com ação hoje · {numberBR(total)} no momento</p>
									</>
								) : (
									<p className="mt-4 text-[13px] font-semibold text-[#8E8E93]">Desligado</p>
								)}
							</div>
						))}
					</div>
				)}
			</section>

			<section className="mb-8">
				<h2 className="mb-3 text-[13px] font-semibold uppercase tracking-wide text-[#8E8E93]">Quem ficou de fora hoje</h2>
				<div className="rounded-2xl border border-[#E5E5EA] bg-white p-5" style={{ boxShadow: '0 0 0 1px #E5E5EA, 0 2px 12px rgba(0,0,0,.04)' }}>
					{loading ? <Loading /> : fora.length === 0 ? <Empty>Ninguém fora da jornada hoje.</Empty> : (
						<ul className="divide-y divide-[#F0F0F2]">
							{fora.map(([motivo, n]) => (
								<li key={motivo} className="flex items-center justify-between py-3 text-[14px]">
									<span className="text-[#1D1D1F]">{motivo}</span>
									<span className="font-semibold text-[#1D1D1F] tnum">{numberBR(n)}</span>
								</li>
							))}
						</ul>
					)}
				</div>
			</section>

			<section>
				<h2 className="mb-3 text-[13px] font-semibold uppercase tracking-wide text-[#8E8E93]">Ações dos últimos 30 dias</h2>
				<div className="rounded-2xl border border-[#E5E5EA] bg-white p-5" style={{ boxShadow: '0 0 0 1px #E5E5EA, 0 2px 12px rgba(0,0,0,.04)' }}>
					{aLoading ? <Loading /> : acoesAgrup.every(a => a.total === 0) ? <Empty>Sem ações registradas nos últimos 30 dias.</Empty> : (
						<div className="space-y-4">
							{acoesAgrup.map(({ m, total, canais, max }) => (
								<div key={m.id}>
									<div className="mb-1.5 flex items-center justify-between text-[13px]">
										<span className="font-medium text-[#1D1D1F]">{m.nome}</span>
										<span className="text-[#6E6E73] tnum">{numberBR(total)}</span>
									</div>
									<div className="h-2.5 w-full overflow-hidden rounded-full bg-[#F2F2F7]">
										<div className="h-full rounded-full bg-[#1D1D1F]" style={{ width: `${(total / max) * 100}%` }} />
									</div>
									{total > 0 && (
										<div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-[#8E8E93]">
											{Object.entries(canais).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).map(([c, v]) => (
												<span key={c}>{CANAL_NOME[c] ?? c}: <strong className="text-[#1D1D1F] tnum">{numberBR(v)}</strong></span>
											))}
										</div>
									)}
								</div>
							))}
						</div>
					)}
				</div>
			</section>
			</>
			)}
		</>
	);
}
