import { useEffect, useMemo, useState } from 'react';
import { CalendarDays, Download } from 'lucide-react';
import { Empty, Loading, Notice } from '@/components/app-shell';
import { useJornadaCarteira, JornadaHeading, SemCarteiraCard } from '@/components/jornada/jornada-shell';
import { friendlyError, signedDownload, supabase, today, type Row } from '@/lib/supabase';
import { MOMENTOS, MOMENTO_NOME, CANAL_NOME, diaLabel, type MomentoId } from '@/lib/jornada';

const CANAIS = ['whatsapp', 'rcs', 'sms', 'email', 'agente_voz', 'discador'];

function passoLabel(momento: MomentoId | null, passo: unknown): string {
	if (passo == null || passo === '') return '—';
	const n = Number(passo);
	if (!Number.isNaN(n) && momento) return diaLabel(momento, n);
	return String(passo);
}

export function JornadaLista() {
	const { empresa, carteiras, carteira, loading: cLoading } = useJornadaCarteira();
	const [date, setDate] = useState(today());
	const [rows, setRows] = useState<Row[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState('');
	const [downloading, setDownloading] = useState('');
	const [fMomento, setFMomento] = useState('all');
	const [fCanal, setFCanal] = useState('all');

	useEffect(() => {
		if (!supabase || !empresa || !carteira) { setRows([]); setLoading(false); return; }
		let active = true;
		setLoading(true); setError('');
		supabase.from('fila_dia').select('*').eq('empresa_id', empresa.id).eq('credor_id', carteira.id).eq('data', date)
			.then(({ data, error }) => {
				if (!active) return;
				if (error) { setError(friendlyError()); setLoading(false); return; }
				setRows((data ?? []) as Row[]);
				setLoading(false);
			});
		return () => { active = false; };
	}, [empresa?.id, carteira?.id, date]);

	const filtered = useMemo(() => rows.filter(r => {
		const m = String(r.momento ?? r.regua ?? '');
		if (fMomento !== 'all' && m !== fMomento) return false;
		if (fCanal !== 'all' && String(r.canal ?? '') !== fCanal) return false;
		return true;
	}), [rows, fMomento, fCanal]);

	async function baixar(canal: string) {
		if (!empresa || !carteira) return;
		const path = `${empresa.slug}/${date}/${carteira.codigo}/ids/${canal}.csv`;
		setDownloading(path); setError('');
		try { await signedDownload(path, `${canal}.csv`, 'saidas', empresa.id); }
		catch { setError('Ainda não gerado para esta data'); }
		finally { setDownloading(''); }
	}

	if (cLoading) return <div className="mc-platform"><Loading /></div>;
	if (carteiras.length === 0) return <><JornadaHeading title="Lista do dia" /><SemCarteiraCard /></>;
	if (!carteira) return <div className="mc-platform"><Loading /></div>;

	return (
		<>
			<JornadaHeading title="Lista do dia" linha={`${empresa?.nome ?? ''} · ${carteira.nome}`} actions={
				<label className="flex h-9 items-center gap-2 rounded-[10px] bg-[#F2F2F7] px-3 text-[13px] font-medium text-[#1D1D1F]">
					<CalendarDays size={15} className="text-[#8E8E93]" />
					<span className="sr-only">Data</span>
					<input type="date" value={date} onChange={e => setDate(e.target.value)} className="h-9 bg-transparent text-[13px] font-medium outline-none" />
				</label>
			} />
			{error && <div className="mb-5"><Notice variant={error.includes('Ainda') ? 'warning' : 'error'}>{error}</Notice></div>}

			<div className="mb-5 flex flex-wrap items-center gap-3">
				<select value={fMomento} onChange={e => setFMomento(e.target.value)} className="h-9 rounded-[10px] border border-[#D2D2D7] bg-white px-3 text-[13px] outline-none">
					<option value="all">Todos os momentos</option>
					{MOMENTOS.map(m => <option key={m.id} value={m.id}>{m.nome}</option>)}
				</select>
				<select value={fCanal} onChange={e => setFCanal(e.target.value)} className="h-9 rounded-[10px] border border-[#D2D2D7] bg-white px-3 text-[13px] outline-none">
					<option value="all">Todos os canais</option>
					{CANAIS.map(c => <option key={c} value={c}>{CANAL_NOME[c] ?? c}</option>)}
				</select>
				<div className="ml-auto flex flex-wrap gap-2">
					{CANAIS.map(c => (
						<button key={c} onClick={() => baixar(c)} disabled={!!downloading} className="flex h-9 items-center gap-1.5 rounded-full border border-[#D2D2D7] px-3 text-[12px] font-medium text-[#1D1D1F] hover:bg-[#F5F5F7] disabled:opacity-50">
							<Download size={13} /> {CANAL_NOME[c] ?? c}
						</button>
					))}
				</div>
			</div>

			<div className="rounded-2xl border border-[#E5E5EA] bg-white" style={{ boxShadow: '0 0 0 1px #E5E5EA, 0 2px 12px rgba(0,0,0,.04)' }}>
				{loading ? <div className="p-6"><Loading /></div> : filtered.length === 0 ? <div className="p-6"><Empty>Nenhum cliente na lista em {date}.</Empty></div> : (
					<div className="overflow-x-auto">
						<table className="w-full min-w-[560px] text-left text-[13px]">
							<thead className="border-b border-[#E5E5EA] text-[11px] uppercase tracking-wide text-[#8E8E93]">
								<tr><th className="px-5 py-3 font-medium">ID do cliente</th><th className="px-5 py-3 font-medium">Momento</th><th className="px-5 py-3 font-medium">Passo</th><th className="px-5 py-3 font-medium">Canal</th></tr>
							</thead>
							<tbody className="divide-y divide-[#F0F0F2]">
								{filtered.map((r, i) => {
									const m = String(r.momento ?? r.regua ?? '') as MomentoId;
									const mid = MOMENTOS.find(x => x.id === m)?.id ?? null;
									return (
										<tr key={r.id ?? i} className="hover:bg-[#FAFAFC]">
											<td className="px-5 py-3 font-medium text-[#1D1D1F] tnum">{String(r.id_cliente ?? r.cliente_id ?? r.id ?? '—')}</td>
											<td className="px-5 py-3 text-[#6E6E73]">{MOMENTO_NOME[m] ?? (m || '—')}</td>
											<td className="px-5 py-3 text-[#6E6E73]">{passoLabel(mid, r.passo ?? r.dia)}</td>
											<td className="px-5 py-3 text-[#6E6E73]">{CANAL_NOME[String(r.canal ?? '')] ?? String(r.canal ?? '—')}</td>
										</tr>
									);
								})}
							</tbody>
						</table>
					</div>
				)}
			</div>
			<p className="mt-3 text-[11px] text-[#8E8E93]">Sem telefone ou e-mail na tela — use só o arquivo baixado na ferramenta do canal.</p>
		</>
	);
}
