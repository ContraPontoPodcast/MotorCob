import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import { ArrowLeft, Download } from 'lucide-react';
import { supabase, friendlyError, dateTimeBR, type Row } from '@/lib/supabase';
import { LoteCabecalho } from '@/components/mensageria/lotes-lista';
import { SIT_MSG, ITEM_NOME, OPERADORA_NOME, exportarCsv, type LoteMensageria, type MensagemMensageria } from '@/lib/mensageria';

const POR_PAGINA = 50;

function horaBR(v: string) {
	try {
		return new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' }).format(new Date(v));
	} catch { return ''; }
}

export function LoteDetalhe() {
	const { id, canal } = useParams();
	const [lote, setLote] = useState<LoteMensageria | null>(null);
	const [msgs, setMsgs] = useState<MensagemMensageria[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState('');
	const [filtro, setFiltro] = useState('all');
	const [filtroOp, setFiltroOp] = useState('all');
	const [pagina, setPagina] = useState(0);

	useEffect(() => {
		if (!supabase || !id) return;
		let active = true;
		setLoading(true);
		(async () => {
			const { data: l, error: el } = await supabase.from('mensageria_lotes').select('*').eq('id', id).maybeSingle();
			if (!active) return;
			if (el) { setError(friendlyError(el)); setLoading(false); return; }
			setLote((l as Row | null) as LoteMensageria | null);
			const { data: m, error: em } = await supabase.from('mensageria_mensagens')
				.select('id_cliente,destino_mascara,situacao,motivo,fornecedor,tentativas,enviado_em,item,operadora,respondida_em')
				.eq('lote_id', id).order('id');
			if (!active) return;
			if (em) { setError(friendlyError(em)); setLoading(false); return; }
			setMsgs((m ?? []) as MensagemMensageria[]);
			setLoading(false);
		})();
		return () => { active = false; };
	}, [id]);

	const isSms = lote?.canal === 'sms';
	let filtradas = filtro === 'all' ? msgs : msgs.filter((m) => m.situacao === filtro);
	if (isSms && filtroOp !== 'all') filtradas = filtradas.filter((m) => (m.operadora ?? '') === filtroOp);
	const total = filtradas.length;
	const inicio = pagina * POR_PAGINA;
	const visiveis = filtradas.slice(inicio, inicio + POR_PAGINA);
	const totalPaginas = Math.max(1, Math.ceil(total / POR_PAGINA));

	function exportar() {
		exportarCsv(`lote-${id}.csv`,
			['ID do cliente', 'Destino', 'Tipo', 'Operadora', 'Situação', 'Motivo', 'Fornecedor', 'Enviado em', 'Respondeu'],
			filtradas.map((m) => [
				m.id_cliente, m.destino_mascara,
				ITEM_NOME[m.item ?? ''] ?? m.item ?? '',
				isSms ? (OPERADORA_NOME[m.operadora ?? ''] ?? m.operadora ?? '') : '',
				SIT_MSG[m.situacao] ?? m.situacao, m.motivo ?? '', m.fornecedor ?? '',
				m.enviado_em ? dateTimeBR(m.enviado_em) : '',
				m.respondida_em ? `Sim · ${horaBR(m.respondida_em)}` : '—',
			]),
		);
	}

	if (loading) return <p className="py-8 text-center text-[14px] text-[#8E8E93]">Carregando...</p>;
	if (error) return <div className="rounded-xl bg-[#FFE8E6] px-4 py-3 text-[14px] text-[#FF3B30]">{error}</div>;
	if (!lote) return <div className="rounded-2xl bg-white p-10 text-center text-[14px] text-[#6E6E73]" style={{ boxShadow: '0 0 0 1px #E5E5EA, 0 2px 12px rgba(0,0,0,.04)' }}>Lote não encontrado.</div>;

	return (
		<div className="space-y-4">
			<Link to={`/mensageria/${canal}/lotes`} className="inline-flex items-center gap-1.5 text-[14px] font-medium text-[#0A60D0] hover:underline"><ArrowLeft size={15} /> Voltar para Lotes</Link>

			<LoteCabecalho lote={lote} />

			<div className="rounded-2xl bg-white p-5" style={{ boxShadow: '0 0 0 1px #E5E5EA, 0 2px 12px rgba(0,0,0,.04)' }}>
				<div className="mb-4 flex flex-wrap items-center justify-between gap-3">
					<h2 className="text-[16px] font-semibold text-[#1D1D1F]">Mensagens</h2>
					<div className="flex flex-wrap items-center gap-2">
						<select value={filtro} onChange={(e) => { setFiltro(e.target.value); setPagina(0); }} className="h-9 rounded-lg border border-[#D2D2D7] bg-white px-3 text-[14px] text-[#1D1D1F] outline-none focus-visible:ring-2 focus-visible:ring-[#0071E5]/40">
							<option value="all">Todas as situações</option>
							{Object.entries(SIT_MSG).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
						</select>
						{isSms && (
							<select value={filtroOp} onChange={(e) => { setFiltroOp(e.target.value); setPagina(0); }} className="h-9 rounded-lg border border-[#D2D2D7] bg-white px-3 text-[14px] text-[#1D1D1F] outline-none focus-visible:ring-2 focus-visible:ring-[#0071E5]/40">
								<option value="all">Todas as operadoras</option>
								{Object.entries(OPERADORA_NOME).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
							</select>
						)}
						<button onClick={exportar} className="flex h-9 items-center gap-2 rounded-full border border-[#D2D2D7] px-4 text-[14px] font-medium text-[#1D1D1F] hover:bg-[#F5F5F7]"><Download size={15} /> Exportar CSV</button>
					</div>
				</div>

				{visiveis.length === 0 ? (
					<p className="py-6 text-center text-[14px] text-[#8E8E93]">Nenhuma mensagem.</p>
				) : (
					<div className="overflow-x-auto">
						<table className="w-full border-collapse text-[14px]">
							<thead>
								<tr className="border-b border-[#E5E5EA] text-left text-[12px] font-semibold uppercase tracking-wide text-[#8E8E93]">
									<th className="py-2 pr-4 font-semibold">ID do cliente</th>
									<th className="py-2 pr-4 font-semibold">Destino</th>
									<th className="py-2 pr-4 font-semibold">Tipo</th>
									{isSms && <th className="py-2 pr-4 font-semibold">Operadora</th>}
									<th className="py-2 pr-4 font-semibold">Situação</th>
									<th className="py-2 pr-4 font-semibold">Motivo</th>
									<th className="py-2 pr-4 font-semibold">Fornecedor</th>
									<th className="py-2 pr-4 font-semibold">Enviado em</th>
									<th className="py-2 font-semibold">Respondeu</th>
								</tr>
							</thead>
							<tbody>
								{visiveis.map((m, i) => (
									<tr key={i} className="border-b border-[#F0F0F2] align-top">
										<td className="py-2.5 pr-4 tnum text-[#1D1D1F]">{m.id_cliente}</td>
										<td className="py-2.5 pr-4 text-[#1D1D1F]">{m.destino_mascara}</td>
										<td className="py-2.5 pr-4 text-[#1D1D1F]">{ITEM_NOME[m.item ?? ''] ?? m.item ?? '—'}</td>
										{isSms && <td className="py-2.5 pr-4 text-[#1D1D1F]">{m.operadora ? <span className={m.operadora === 'invalido' ? 'text-[#FF3B30]' : ''}>{OPERADORA_NOME[m.operadora] ?? m.operadora}</span> : '—'}</td>}
										<td className="py-2.5 pr-4 text-[#1D1D1F]">{SIT_MSG[m.situacao] ?? m.situacao}</td>
										<td className="py-2.5 pr-4 text-[#6E6E73]">{m.motivo ?? '—'}</td>
										<td className="py-2.5 pr-4 text-[#6E6E73]">{m.fornecedor ?? '—'}</td>
										<td className="py-2.5 pr-4 tnum text-[#6E6E73]">{m.enviado_em ? dateTimeBR(m.enviado_em) : '—'}</td>
										<td className="py-2.5 tnum text-[#6E6E73]">{m.respondida_em ? `Sim · ${horaBR(m.respondida_em)}` : '—'}</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
				)}

				{totalPaginas > 1 && (
					<div className="mt-4 flex items-center justify-between">
						<p className="text-[13px] text-[#8E8E93]">{inicio + 1}–{Math.min(inicio + POR_PAGINA, total)} de {total}</p>
						<div className="flex gap-2">
							<button disabled={pagina === 0} onClick={() => setPagina((p) => p - 1)} className="h-9 rounded-full border border-[#D2D2D7] px-4 text-[14px] font-medium text-[#1D1D1F] disabled:opacity-50 hover:bg-[#F5F5F7]">Anterior</button>
							<button disabled={pagina >= totalPaginas - 1} onClick={() => setPagina((p) => p + 1)} className="h-9 rounded-full border border-[#D2D2D7] px-4 text-[14px] font-medium text-[#1D1D1F] disabled:opacity-50 hover:bg-[#F5F5F7]">Próxima</button>
						</div>
					</div>
				)}
			</div>
		</div>
	);
}
