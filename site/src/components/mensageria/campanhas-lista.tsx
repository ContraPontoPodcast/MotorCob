import { useEffect, useState } from 'react';
import { Link, useParams, useNavigate } from 'react-router';
import { Plus } from 'lucide-react';
import { supabase, friendlyError, dateTimeBR, type Row } from '@/lib/supabase';
import { useMotorAuth } from '@/components/auth-provider';
import { SIT_CAMPANHA, isCanalValido } from '@/lib/mensageria-produtos';
import { num } from '@/lib/mensageria-produtos';
import { TabelaResponsiva } from '@/components/comuns/tabela-responsiva';

export function CampanhasLista() {
	const { canal } = useParams();
	const navigate = useNavigate();
	const { empresa, permissoes } = useMotorAuth();
	const canAct = permissoes.includes('enviar_mensagens');
	const [lista, setLista] = useState<Row[]>([]);
	const [loading, setLoading] = useState(true);
	const [erro, setErro] = useState('');

	useEffect(() => {
		if (!supabase || !empresa || !isCanalValido(canal)) return;
		let active = true;
		(async () => {
			const { data, error } = await supabase.from('mensageria_campanhas')
				.select('*, mensageria_templates(nome), mensageria_centros_custo(nome)')
				.eq('empresa_id', empresa.id).eq('canal', canal).order('criado_em', { ascending: false });
			if (!active) return;
			if (error) { setErro(friendlyError(error)); setLoading(false); return; }
			setLista(data ?? []);
			setLoading(false);
		})();
		return () => { active = false; };
	}, [empresa?.id, canal]);

	if (!isCanalValido(canal)) return null;

	return (
		<div className="space-y-4">
			<div className="flex justify-end">
				{canAct && <Link to={`/mensageria/${canal}/campanhas/nova`} className="flex h-9 items-center gap-2 rounded-full bg-[#1D1D1F] px-4 text-[14px] font-medium text-white hover:opacity-85"><Plus size={15} /> Nova campanha</Link>}
			</div>

			{erro && <div className="rounded-xl bg-[#FFE8E6] px-4 py-3 text-[14px] text-[#FF3B30]">{erro}</div>}

			{loading ? <p className="py-8 text-center text-[14px] text-[#8E8E93]">Carregando...</p> :
				lista.length === 0 ? (
					<div className="rounded-2xl bg-white p-10 text-center" style={{ boxShadow: '0 0 0 1px #E5E5EA, 0 2px 12px rgba(0,0,0,.04)' }}>
						<span className="mc-area-tag mb-3">Mensageria</span>
						<h2 className="text-[18px] font-semibold text-[#1D1D1F]">Campanhas</h2>
						<p className="mx-auto mt-2 max-w-sm text-[14px] text-[#6E6E73]">Suba uma lista com os contatos, confira as colunas e escolha o template. Em simulação, nada sai para os seus clientes.</p>
						{canAct && <Link to={`/mensageria/${canal}/campanhas/nova`} className="mt-5 inline-flex h-10 items-center gap-2 rounded-full bg-[#1D1D1F] px-5 text-[14px] font-medium text-white hover:opacity-85"><Plus size={16} /> Nova campanha</Link>}
					</div>
				) : (
					<div className="rounded-2xl bg-white p-4 sm:p-5" style={{ boxShadow: '0 0 0 1px #E5E5EA, 0 2px 12px rgba(0,0,0,.04)' }}>
						<TabelaResponsiva
							cabecalho={['Nome', 'Situação', 'Carregados', 'Template', 'Centro de custo', 'Criada em']}
							destaque={[0, 1, 5, 2]}
							linhas={lista.map(c => {
								const sit = SIT_CAMPANHA[c.situacao as string] ?? { label: c.situacao, cor: '#6E6E73', bg: '#F5F5F7' };
								const dataAg = c.situacao === 'agendada' && c.agendado_para ? dateTimeBR(c.agendado_para) : null;
								return {
									onClick: () => navigate(`/mensageria/${canal}/campanhas/${c.id}`),
									celulas: [
										<Link to={`/mensageria/${canal}/campanhas/${c.id}`} key="n" className="font-medium text-[#0A60D0] hover:underline">{c.nome}</Link>,
										<span key="s" className="inline-flex items-center rounded-full px-2.5 py-0.5 text-[12px] font-semibold" style={{ color: sit.cor, backgroundColor: sit.bg }}>{dataAg ? `Agendada ${dataAg}` : sit.label}</span>,
										<span key="c" className="tnum">{num(c.carregados)}</span>,
										<span key="t" className="text-[#6E6E73]">{(c.mensageria_templates as Row)?.nome ?? '—'}</span>,
										<span key="cc" className="text-[#6E6E73]">{(c.mensageria_centros_custo as Row)?.nome ?? '—'}</span>,
										<span key="d" className="tnum text-[#6E6E73]">{dateTimeBR(c.criado_em)}</span>,
									],
								};
							})}
						/>
					</div>
				)}
		</div>
	);
}
