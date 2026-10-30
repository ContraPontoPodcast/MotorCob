import { useEffect, useState } from 'react';
import { useParams } from 'react-router';
import { supabase, friendlyError, dateBR } from '@/lib/supabase';
import { useMotorAuth } from '@/components/auth-provider';
import { LoteRow } from '@/components/mensageria/lote-card';
import { SIT_LOTE, CANAL_NOME, CANAL_COR, type LoteMensageria } from '@/lib/mensageria';

const POR_PAGINA = 30;

export function LotesLista() {
	const { empresa } = useMotorAuth();
	const { canal } = useParams();
	const [lotes, setLotes] = useState<LoteMensageria[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState('');
	const [situacao, setSituacao] = useState('all');
	const [pagina, setPagina] = useState(0);

	useEffect(() => {
		if (!supabase || !empresa || !canal) return;
		let active = true;
		setLoading(true);
		(async () => {
			let q = supabase.from('mensageria_lotes').select('*').eq('empresa_id', empresa.id).eq('canal', canal).order('data', { ascending: false });
			if (situacao !== 'all') q = q.eq('situacao', situacao);
			const { data, error } = await q;
			if (!active) return;
			if (error) { setError(friendlyError(error)); setLoading(false); return; }
			setLotes((data ?? []) as LoteMensageria[]);
			setError('');
			setLoading(false);
		})();
		return () => { active = false; };
	}, [empresa?.id, canal, situacao]);

	const total = lotes.length;
	const inicio = pagina * POR_PAGINA;
	const visiveis = lotes.slice(inicio, inicio + POR_PAGINA);
	const totalPaginas = Math.max(1, Math.ceil(total / POR_PAGINA));

	return (
		<div className="space-y-4">
			{/* Filtros */}
			<div className="flex flex-wrap items-center gap-3">
				<select value={situacao} onChange={(e) => { setSituacao(e.target.value); setPagina(0); }} className="h-9 rounded-lg border border-[#D2D2D7] bg-white px-3 text-[14px] text-[#1D1D1F] outline-none focus-visible:ring-2 focus-visible:ring-[#0071E5]/40">
					<option value="all">Todas as situações</option>
					{Object.entries(SIT_LOTE).map(([id, s]) => <option key={id} value={id}>{s.label}</option>)}
				</select>
			</div>

			{error && <div className="rounded-xl bg-[#FFE8E6] px-4 py-3 text-[14px] text-[#FF3B30]">{error}</div>}

			{loading ? <p className="py-8 text-center text-[14px] text-[#8E8E93]">Carregando...</p> :
				visiveis.length === 0 ? (
					<div className="rounded-2xl bg-white p-10 text-center text-[14px] text-[#6E6E73]" style={{ boxShadow: '0 0 0 1px #E5E5EA, 0 2px 12px rgba(0,0,0,.04)' }}>
						Nenhum lote encontrado.
					</div>
				) : (
					<div className="space-y-3">
						{visiveis.map((l) => <LoteRow key={l.id} lote={l} />)}
					</div>
				)}

			{totalPaginas > 1 && (
				<div className="flex items-center justify-between pt-2">
					<p className="text-[13px] text-[#8E8E93]">{inicio + 1}–{Math.min(inicio + POR_PAGINA, total)} de {total}</p>
					<div className="flex gap-2">
						<button disabled={pagina === 0} onClick={() => setPagina((p) => p - 1)} className="h-9 rounded-full border border-[#D2D2D7] px-4 text-[14px] font-medium text-[#1D1D1F] disabled:opacity-50 hover:bg-[#F5F5F7]">Anterior</button>
						<button disabled={pagina >= totalPaginas - 1} onClick={() => setPagina((p) => p + 1)} className="h-9 rounded-full border border-[#D2D2D7] px-4 text-[14px] font-medium text-[#1D1D1F] disabled:opacity-50 hover:bg-[#F5F5F7]">Próxima</button>
					</div>
				</div>
			)}
		</div>
	);
}

/** Cabeçalho do lote na página de detalhe. */
export function LoteCabecalho({ lote }: { lote: LoteMensageria }) {
	const sit = SIT_LOTE[lote.situacao] ?? { label: lote.situacao, cor: '#6E6E73', bg: '#F5F5F7' };
	const canalNome = CANAL_NOME[lote.canal] ?? lote.canal;
	return (
		<div className="rounded-2xl bg-white p-6" style={{ boxShadow: '0 0 0 1px #E5E5EA, 0 2px 12px rgba(0,0,0,.04)' }}>
			<div className="flex flex-wrap items-center gap-2">
				<span className="inline-flex items-center rounded-full px-2.5 py-0.5 text-[12px] font-semibold text-white" style={{ backgroundColor: CANAL_COR[lote.canal] ?? '#8E8E93' }}>{canalNome}</span>
				{lote.credor_nome && <span className="text-[15px] font-medium text-[#1D1D1F]">{lote.credor_nome}</span>}
				<span className="inline-flex items-center rounded-full px-2.5 py-0.5 text-[12px] font-semibold" style={{ color: sit.cor, backgroundColor: sit.bg }}>{sit.label}</span>
			</div>
			<div className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-[14px] text-[#1D1D1F]">
				<span><span className="text-[#8E8E93]">Data </span>{dateBR(lote.data)}</span>
				{lote.janela_inicio && lote.janela_fim && <span><span className="text-[#8E8E93]">Janela </span>{lote.janela_inicio}–{lote.janela_fim}</span>}
				<span><span className="text-[#8E8E93]">Total </span>{Number(lote.total).toLocaleString('pt-BR')}</span>
				<span><span className="text-[#8E8E93]">Enviadas </span>{Number(lote.enviadas).toLocaleString('pt-BR')}</span>
				<span><span className="text-[#8E8E93]">Entregues </span>{Number(lote.entregues).toLocaleString('pt-BR')}</span>
				<span><span className="text-[#8E8E93]">Não entregues </span>{Number(lote.falhas).toLocaleString('pt-BR')}</span>
				<span><span className="text-[#8E8E93]">Descadastros </span>{Number(lote.descadastros).toLocaleString('pt-BR')}</span>
				<span><span className="text-[#8E8E93]">Respostas </span>{Number(lote.respostas).toLocaleString('pt-BR')}</span>
				<span><span className="text-[#8E8E93]">Bloqueadas </span>{Number(lote.bloqueadas).toLocaleString('pt-BR')}</span>
			</div>
			{lote.motivo && <p className="mt-2 text-[13px] text-[#6E6E73]">{lote.motivo}</p>}
		</div>
	);
}


