import { useEffect, useState } from 'react';
import { UserMinus } from 'lucide-react';
import { supabase, friendlyError, dateTimeBR } from '@/lib/supabase';
import { useMotorAuth } from '@/components/auth-provider';
import { DescadastrarModal } from '@/components/mensageria/descadastrar-modal';
import { ORIGEM_DESCADASTRO, CANAL_NOME, type DescadastroMensageria } from '@/lib/mensageria';

export function Descadastros() {
	const { empresa, permissoes } = useMotorAuth();
	const canAct = permissoes.includes('enviar_mensagens');
	const [lista, setLista] = useState<DescadastroMensageria[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState('');
	const [sucesso, setSucesso] = useState('');
	const [modal, setModal] = useState(false);

	async function reload() {
		if (!supabase || !empresa) return;
		setLoading(true);
		const { data, error } = await supabase.from('mensageria_descadastros').select('*').eq('empresa_id', empresa.id).order('criado_em', { ascending: false });
		if (error) { setError(friendlyError(error)); setLoading(false); return; }
		setLista((data ?? []) as DescadastroMensageria[]);
		setError('');
		setLoading(false);
	}
	useEffect(() => { void reload(); }, [empresa?.id]);

	return (
		<div className="space-y-4">
			{canAct && (
				<div className="flex justify-end">
					<button onClick={() => setModal(true)} className="flex h-9 items-center gap-2 rounded-full bg-[#1D1D1F] px-4 text-[14px] font-medium text-white hover:opacity-85"><UserMinus size={15} /> Descadastrar contato</button>
				</div>
			)}

			{sucesso && <div className="rounded-xl bg-[#E8F8EC] px-4 py-3 text-[14px] text-[#248A3D]">{sucesso}</div>}
			{error && <div className="rounded-xl bg-[#FFE8E6] px-4 py-3 text-[14px] text-[#FF3B30]">{error}</div>}

			{loading ? <p className="py-8 text-center text-[14px] text-[#8E8E93]">Carregando...</p> :
				lista.length === 0 ? (
					<div className="rounded-2xl bg-white p-10 text-center text-[14px] text-[#6E6E73]" style={{ boxShadow: '0 0 0 1px #E5E5EA, 0 2px 12px rgba(0,0,0,.04)' }}>
						Nenhum descadastro registrado.
					</div>
				) : (
					<div className="overflow-x-auto rounded-2xl bg-white" style={{ boxShadow: '0 0 0 1px #E5E5EA, 0 2px 12px rgba(0,0,0,.04)' }}>
						<table className="w-full border-collapse text-[14px]">
							<thead>
								<tr className="border-b border-[#E5E5EA] text-left text-[12px] font-semibold uppercase tracking-wide text-[#8E8E93]">
									<th className="px-5 py-3 font-semibold">Destino</th>
									<th className="px-5 py-3 font-semibold">Canal</th>
									<th className="px-5 py-3 font-semibold">Origem</th>
									<th className="px-5 py-3 font-semibold">Data</th>
								</tr>
							</thead>
							<tbody>
								{lista.map((d) => (
									<tr key={d.id} className="border-b border-[#F0F0F2]">
										<td className="px-5 py-3 text-[#1D1D1F]">{d.destino_mascara}</td>
										<td className="px-5 py-3 text-[#1D1D1F]">{CANAL_NOME[d.canal] ?? d.canal}</td>
										<td className="px-5 py-3 text-[#1D1D1F]">{ORIGEM_DESCADASTRO[d.origem] ?? d.origem}</td>
										<td className="px-5 py-3 tnum text-[#6E6E73]">{dateTimeBR(d.criado_em)}</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
				)
			}

			{modal && empresa && (
				<DescadastrarModal
					empresaId={empresa.id}
					onClose={() => setModal(false)}
					onDone={(msg) => { setSucesso(msg); setModal(false); void reload(); }}
				/>
			)}
		</div>
	);
}
