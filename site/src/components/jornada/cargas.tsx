import { useEffect, useRef, useState, type ChangeEvent, type DragEvent } from 'react';
import { UploadCloud, FileSpreadsheet, Download } from 'lucide-react';
import { Empty, Loading, Notice } from '@/components/app-shell';
import { useJornadaCarteira, JornadaHeading, SemCarteiraCard } from '@/components/jornada/jornada-shell';
import { dateTimeBR, friendlyError, logAccess, safeFileName, supabase, today, type Row } from '@/lib/supabase';

const TIPOS = [
	{
		id: 'clientes', label: 'Clientes da jornada',
		header: 'id_cliente;data_contratacao;proximo_vencimento;vencimento_pago;ativado;ultima_atividade;dias_atraso;bloqueio',
		layout: 'id_cliente · data_contratacao · proximo_vencimento · vencimento_pago · ativado · ultima_atividade · dias_atraso · bloqueio',
	},
	{
		id: 'contatos', label: 'Contatos',
		header: 'id_cliente;contato;tipo;whatsapp_valido',
		layout: 'id_cliente · contato · tipo (telefone ou email) · whatsapp_valido (sim só se confirmado)',
	},
];

const AJUDA = 'Datas em AAAA-MM-DD ou DD/MM/AAAA. vencimento_pago e ativado: sim ou não. Cliente com dias_atraso maior que zero fica com a cobrança (MotorCX).';

export function JornadaCargas() {
	const { empresa, carteiras, carteira, loading: cLoading } = useJornadaCarteira();
	const [busy, setBusy] = useState(false);
	const [rows, setRows] = useState<Row[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState('');
	const [success, setSuccess] = useState('');
	const inputRef = useRef<HTMLInputElement | null>(null);
	const [pickTipo, setPickTipo] = useState<string>('clientes');

	async function reload() {
		if (!supabase || !empresa) return;
		const { data, error } = await supabase.from('envios').select('*').eq('empresa_id', empresa.id).in('tipo', ['clientes', 'contatos']).order('enviado_em', { ascending: false }).limit(50);
		if (error) setError(friendlyError()); else setRows(data ?? []);
		setLoading(false);
	}
	useEffect(() => { void reload(); }, [empresa?.id]);

	function baixarModelo(tipo: 'clientes' | 'contatos') {
		const t = TIPOS.find(x => x.id === tipo)!;
		const blob = new Blob([t.header + '\n'], { type: 'text/csv;charset=utf-8' });
		const link = document.createElement('a');
		link.href = URL.createObjectURL(blob);
		link.download = `modelo_${tipo}.csv`;
		link.click();
		window.setTimeout(() => URL.revokeObjectURL(link.href), 60000);
	}

	async function upload(tipo: string, files: File[]) {
		if (!supabase || !empresa || !empresa.slug || !carteira || !files.length) return;
		setBusy(true); setError(''); setSuccess(''); let done = 0;
		for (const file of files) {
			const safe = safeFileName(file.name);
			const path = `${empresa.slug}/${tipo}/${today()}/${Date.now()}_${safe}`;
			try {
				const { error } = await supabase.storage.from('entradas').upload(path, file, { contentType: 'text/csv', upsert: false });
				if (error) throw error;
				const ins = await supabase.from('envios').insert({ empresa_id: empresa.id, credor_id: carteira.id, tipo, caminho: path, nome_original: file.name });
				if (ins.error) throw ins.error;
				await logAccess('envio', path, empresa.id); done++;
			} catch { setError(`Não foi possível finalizar o envio de ${file.name}. Fale com o administrador.`); break; }
		}
		if (done) { setSuccess(`${done} arquivo${done > 1 ? 's' : ''} enviado${done > 1 ? 's' : ''} com sucesso.`); await reload(); }
		setBusy(false);
	}

	function accept(list: FileList | null): File[] {
		if (!list) return [];
		const next = Array.from(list);
		if (next.some(f => !['.csv','.txt','.xlsx'].some(ext => f.name.toLowerCase().endsWith(ext)))) { setError('Selecione apenas arquivos CSV, TXT ou XLSX.'); return []; }
		setError('');
		return next;
	}
	function onDrop(e: DragEvent, tipo: string) { e.preventDefault(); const f = accept(e.dataTransfer.files); if (f.length) void upload(tipo, f); }
	function onPick(e: ChangeEvent<HTMLInputElement>, tipo: string) { const f = accept(e.target.files); if (f.length) void upload(tipo, f); e.target.value = ''; }

	if (cLoading) return <div className="mc-platform"><Loading /></div>;
	if (carteiras.length === 0) return <><JornadaHeading title="Enviar arquivos" /><SemCarteiraCard /></>;
	if (!carteira) return <div className="mc-platform"><Loading /></div>;

	return (
		<>
			<JornadaHeading title="Enviar arquivos" linha={`${empresa?.nome ?? ''} · ${carteira.nome}`} />
			{error && <div className="mb-5"><Notice>{error}</Notice></div>}
			{success && <div className="mb-5"><Notice variant="success">{success}</Notice></div>}

			<div className="mb-5 rounded-xl border border-[#E5E5EA] bg-[#F5F5F7] p-4 text-[13px] leading-relaxed text-[#6E6E73]">{AJUDA}</div>

			<div className="grid gap-4 lg:grid-cols-2">
				{TIPOS.map(t => (
					<div key={t.id} className="rounded-2xl border border-[#E5E5EA] bg-white p-6" style={{ boxShadow: '0 0 0 1px #E5E5EA, 0 2px 12px rgba(0,0,0,.04)' }}>
						<div className="mb-4 flex items-center gap-3">
							<div className="grid h-10 w-10 place-items-center rounded-lg bg-[#F2F2F7] text-[#1D1D1F]"><UploadCloud size={20} /></div>
							<h2 className="text-[15px] font-semibold">{t.label}</h2>
						</div>
						<label onDragOver={e => e.preventDefault()} onDrop={e => onDrop(e, t.id)} className={`flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed p-8 text-center transition ${busy ? 'opacity-60' : 'border-[#D2D2D7] bg-[#FAFAFC] hover:border-[#1D1D1F] hover:bg-[#F5F5F7]'}`}>
							<input type="file" accept=".csv,.txt,.xlsx" className="sr-only" onChange={e => onPick(e, t.id)} disabled={busy} />
							<UploadCloud size={24} className="mb-2 text-[#8E8E93]" />
							<p className="text-[13px] font-medium">Arraste o arquivo aqui ou clique para selecionar</p>
						</label>
						<div className="mt-4 rounded-lg bg-[#F5F5F7] px-3 py-2 font-mono text-[11px] leading-6 text-[#6E6E73]">{t.layout}</div>
						<button onClick={() => baixarModelo(t.id as 'clientes' | 'contatos')} className="mt-3 flex items-center gap-1.5 text-[12px] font-semibold text-[#1D1D1F] hover:underline"><Download size={13} /> Baixar modelo</button>
					</div>
				))}
			</div>

			<section className="mt-8 rounded-2xl border border-[#E5E5EA] bg-white p-6" style={{ boxShadow: '0 0 0 1px #E5E5EA, 0 2px 12px rgba(0,0,0,.04)' }}>
				<h2 className="mb-1 text-[15px] font-semibold">Histórico de envios</h2>
				<p className="mb-5 text-[12px] text-[#8E8E93]">Últimos 50 arquivos da jornada</p>
				{loading ? <Loading /> : rows.length === 0 ? <Empty>Nenhum arquivo enviado ainda.</Empty> : (
					<div className="overflow-x-auto">
						<table className="w-full min-w-[600px] text-left text-[13px]">
							<thead className="border-b border-[#E5E5EA] text-[11px] uppercase tracking-wide text-[#8E8E93]"><tr><th className="pb-3 font-medium">Data e hora</th><th className="pb-3 font-medium">Tipo</th><th className="pb-3 font-medium">Arquivo</th><th className="pb-3 font-medium">Status</th></tr></thead>
							<tbody className="divide-y divide-[#F0F0F2]">
								{rows.map((r, i) => (
									<tr key={r.id ?? i} className="hover:bg-[#FAFAFC]">
										<td className="py-3 text-[#6E6E73]">{dateTimeBR(r.enviado_em)}</td>
										<td className="py-3 capitalize">{r.tipo === 'clientes' ? 'Clientes da jornada' : 'Contatos'}</td>
										<td className="py-3"><div className="flex items-center gap-2 truncate font-medium text-[#1D1D1F]"><FileSpreadsheet size={14} className="text-[#8E8E93]" />{String(r.nome_original ?? '—')}</div></td>
										<td className="py-3"><span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${r.status === 'processado' ? 'bg-[#34C759]/10 text-[#248A3D]' : r.status === 'erro' ? 'bg-[#FF3B30]/10 text-[#FF3B30]' : 'bg-[#FF9500]/10 text-[#9a631b]'}`}>{r.status ?? 'pendente'}</span></td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
				)}
			</section>
		</>
	);
}
