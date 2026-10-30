import { useEffect, useState } from 'react';
import { ArrowLeft, Download, Clock } from 'lucide-react';
import { supabase, friendlyError, dateBR, type Row } from '@/lib/supabase';
import { useMotorAuth } from '@/components/auth-provider';
import { exportacaoSituacao, type Exportacao } from '@/lib/relatorios';

export function MeusArquivos({ onBack }: { onBack: () => void }) {
	const { empresa } = useMotorAuth();
	const [lista, setLista] = useState<Exportacao[]>([]);
	const [loading, setLoading] = useState(true);
	const [erro, setErro] = useState('');

	async function reload() {
		if (!supabase || !empresa) return;
		setLoading(true);
		const { data, error } = await supabase.from('relatorio_exportacoes').select('*').eq('empresa_id', empresa.id).order('criado_em', { ascending: false }).limit(50);
		setLoading(false);
		if (error) { setErro(friendlyError(error)); return; }
		setLista((data ?? []) as Exportacao[]);
	}
	useEffect(() => { void reload(); /* eslint-disable-next-line */ }, [empresa?.id]);

	const expirada = (e: Exportacao) => e.expira_em && new Date(e.expira_em) < new Date();

	return (
		<div className="mx-auto max-w-[860px]">
			<button onClick={onBack} className="mb-4 inline-flex items-center gap-1.5 text-[14px] font-medium text-[#0A60D0] hover:underline"><ArrowLeft size={15} /> Voltar</button>
			<h1 className="mb-1 text-[24px] font-bold tracking-tight text-[#1D1D1F]">Meus arquivos</h1>
			<p className="mb-5 text-[14px] text-[#6E6E73]">Exportações geradas a partir dos relatórios.</p>

			{erro && <div className="mb-4 rounded-xl bg-[#FFE8E6] px-4 py-3 text-[14px] text-[#FF3B30]">{erro}</div>}

			{loading ? <p className="py-8 text-center text-[14px] text-[#8E8E93]">Carregando…</p> :
				lista.length === 0 ? (
					<div className="rounded-2xl bg-white p-10 text-center text-[14px] text-[#6E6E73]" style={{ boxShadow: '0 0 0 1px #E5E5EA, 0 2px 12px rgba(0,0,0,.04)' }}>
						Nenhuma exportação ainda. Exporte um relatório acima de 50.000 linhas e ele aparece aqui.
					</div>
				) : (
					<div className="overflow-x-auto rounded-2xl bg-white" style={{ boxShadow: '0 0 0 1px #E5E5EA, 0 2px 12px rgba(0,0,0,.04)' }}>
						<table className="w-full border-collapse text-[14px]">
							<thead><tr className="border-b border-[#E5E5EA] text-left text-[12px] font-semibold uppercase tracking-wide text-[#8E8E93]">
								<th className="px-5 py-3">Nome</th><th className="px-5 py-3">Linhas</th><th className="px-5 py-3">Situação</th><th className="px-5 py-3">Expira em</th><th className="px-5 py-3 text-right">Ação</th>
							</tr></thead>
							<tbody>
								{lista.map(e => {
									const sit = exportacaoSituacao(e.situacao);
									const vencida = expirada(e);
									return (
										<tr key={e.id} className="border-b border-[#F0F0F2]">
											<td className="px-5 py-3 font-medium text-[#1D1D1F]">{e.nome}</td>
											<td className="px-5 py-3 tnum text-[#6E6E73]">{e.linhas != null ? Number(e.linhas).toLocaleString('pt-BR') : '—'}</td>
											<td className="px-5 py-3"><span className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[12px] font-semibold" style={{ backgroundColor: `${sit.cor}1A`, color: sit.cor }}>{e.situacao === 'processando' && <Clock size={11} />} {sit.label}</span></td>
											<td className="px-5 py-3 text-[#6E6E73]">{e.expira_em ? (vencida ? <span className="text-[#FF3B30]">Vencido em {dateBR(e.expira_em)}</span> : dateBR(e.expira_em)) : '—'}</td>
											<td className="px-5 py-3 text-right">
												{e.arquivo_url && !vencida ? (
													<a href={String(e.arquivo_url)} download className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-[#1D1D1F] px-3 text-[13px] font-medium text-white hover:opacity-85"><Download size={14} /> Baixar</a>
												) : <span className="text-[13px] text-[#8E8E93]">—</span>}
											</td>
										</tr>
									);
								})}
							</tbody>
						</table>
					</div>
				)}
		</div>
	);
}
