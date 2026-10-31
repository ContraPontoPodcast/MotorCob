import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { useMotorAuth } from '@/components/auth-provider';
import { supabase, dateBR, friendlyError, type Row } from '@/lib/supabase';
import { ConsoleShell } from './console-shell';
import { useConsolePerms } from './console-perms';

/** Console › Integrações (prompt 63, item 6): tokens de API de todas as empresas, sem o token. */
export function ConsoleIntegracoesPage() {
	const { selectEmpresa } = useMotorAuth();
	const { isMaster } = useConsolePerms();
	const navigate = useNavigate();
	const [linhas, setLinhas] = useState<Row[]>([]);
	const [loading, setLoading] = useState(true);
	const [erro, setErro] = useState('');

	useEffect(() => {
		if (!supabase) return;
		let active = true;
		(async () => {
			const { data, error } = await supabase.rpc('tokens_console');
			if (!active) return;
			if (error) setErro(friendlyError(error)); else setLinhas((data ?? []) as Row[]);
			setLoading(false);
		})();
		return () => { active = false; };
	}, []);

	async function ver(r: Row) {
		await selectEmpresa(String(r.empresa_id));
		navigate('/empresa/integracoes');
	}

	return (
		<ConsoleShell>
			<div className="mb-5">
				<h1 className="text-[24px] font-bold tracking-tight text-[#1D1D1F]">Integrações</h1>
				<p className="mt-1 text-[14px] text-[#6E6E73]">Tokens de API por empresa (nunca o token). {isMaster ? 'Revogar por incidente de segurança: em "Ver", com o motivo.' : 'Só o Master revoga token de cliente.'}</p>
			</div>
			{erro && <p role="alert" className="mb-4 rounded-xl bg-[#FFE8E6] px-4 py-3 text-[14px] text-[#FF3B30]">{erro}</p>}
			{loading ? <p className="py-10 text-center text-[14px] text-[#8E8E93]">Carregando…</p> : linhas.length === 0 ? (
				<div className="rounded-2xl bg-[#F5F5F7] px-6 py-10 text-center text-[14px] text-[#6E6E73]">Nenhuma empresa criou token de API ainda.</div>
			) : (
				<div className="overflow-x-auto rounded-2xl bg-white" style={{ boxShadow: '0 0 0 1px #E5E5EA, 0 2px 12px rgba(0,0,0,.04)' }}>
					<table className="w-full min-w-[720px] text-left text-[14px]">
						<thead><tr className="border-b border-[#E5E5EA] text-[12px] font-semibold text-[#8E8E93]">
							<th className="px-5 py-3">Empresa</th><th className="px-5 py-3">Tokens ativos</th><th className="px-5 py-3">Chamadas · 7 dias</th><th className="px-5 py-3">Erros</th><th className="px-5 py-3">Vence primeiro</th><th className="px-5 py-3" />
						</tr></thead>
						<tbody className="divide-y divide-[#F0F0F2]">
							{linhas.map(r => {
								const parou = Number(r.recusados_401_7d ?? 0) > 50;
								return (
									<tr key={String(r.empresa_id)} className={parou ? 'bg-[#FFE8E6]/50' : ''}>
										<td className="px-5 py-3">
											<p className="font-medium text-[#1D1D1F]">{r.empresa}</p>
											{parou && <p className="text-[12px] font-semibold text-[#FF3B30]">O sistema desta empresa parou ({Number(r.recusados_401_7d).toLocaleString('pt-BR')} chamadas recusadas por token inválido em 7 dias)</p>}
										</td>
										<td className="px-5 py-3 tnum">{Number(r.ativos ?? 0).toLocaleString('pt-BR')}</td>
										<td className="px-5 py-3 tnum">{Number(r.chamadas_7d ?? 0).toLocaleString('pt-BR')}</td>
										<td className={`px-5 py-3 tnum ${Number(r.erros_7d ?? 0) > 0 ? 'text-[#FF3B30]' : ''}`}>{Number(r.erros_7d ?? 0).toLocaleString('pt-BR')}</td>
										<td className="px-5 py-3 text-[#6E6E73]">{r.vence_primeiro ? dateBR(r.vence_primeiro) : '—'}</td>
										<td className="px-5 py-3 text-right"><button onClick={() => void ver(r)} className="h-8 rounded-full border border-[#D2D2D7] px-4 text-[13px] font-medium text-[#1D1D1F] hover:bg-[#F5F5F7]">Ver</button></td>
									</tr>
								);
							})}
						</tbody>
					</table>
				</div>
			)}
		</ConsoleShell>
	);
}
