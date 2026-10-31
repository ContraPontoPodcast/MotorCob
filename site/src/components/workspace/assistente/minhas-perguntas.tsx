import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { ChevronRight, RotateCw, ArrowRight, ThumbsUp, ThumbsDown, MessageCircle } from 'lucide-react';
import { useMotorAuth } from '@/components/auth-provider';
import { useAssistente } from './assistente-context';
import { supabase, dateBR, dateTimeBR, type Row } from '@/lib/supabase';
import { rotaDaAcao, telaNome } from '@/lib/assistente';
import { PageHeading } from '@/components/app-shell';
import { useAreasLiberadas } from '@/hooks/use-areas-liberadas';

type PerguntaRow = {
	id: string;
	pergunta: string;
	tela_nome: string | null;
	tela: string | null;
	criado_em: string;
	situacao: string | null;
	avaliacao: number | null;
	resposta: string | null;
	acao: { id: string; rotulo: string } | null;
};

function resultadoLabel(r: PerguntaRow): { texto: string; cor: string } {
	if (r.avaliacao === 1) return { texto: '👍', cor: '#248A3D' };
	if (r.avaliacao === -1) return { texto: '👎', cor: '#FF3B30' };
	const s = r.situacao ?? 'respondida';
	if (s === 'sem_resposta') return { texto: 'sem resposta', cor: '#9A631B' };
	if (s === 'fora_do_ar') return { texto: 'fora do ar', cor: '#8E8E93' };
	return { texto: 'respondida', cor: '#1D1D1F' };
}

export function MinhasPerguntas() {
	const { session, permissoes } = useMotorAuth();
	const areasLib = useAreasLiberadas();
	const { perguntar, abrirGaveta } = useAssistente();
	const navigate = useNavigate();
	const [lista, setLista] = useState<PerguntaRow[]>([]);
	const [loading, setLoading] = useState(true);
	const [aberta, setAberta] = useState<string | null>(null);

	useEffect(() => {
		if (!supabase || !session) return;
		let active = true;
		setLoading(true);
		const limite = new Date(Date.now() - 90 * 86400000).toISOString();
		(async () => {
			const { data, error } = await supabase
				.from('assistente_perguntas')
				.select('id,pergunta,tela_nome,tela,criado_em,situacao,avaliacao,resposta,acao')
				.eq('usuario_id', session.user.id)
				.gte('criado_em', limite)
				.order('criado_em', { ascending: false });
			if (!active) return;
			if (!error) setLista((data ?? []) as PerguntaRow[]);
			setLoading(false);
		})();
		return () => { active = false; };
	}, [session]);

	async function perguntarDeNovo(r: PerguntaRow) {
		await perguntar(r.pergunta, 'conversa');
		abrirGaveta();
		navigate('/inicio');
	}

	function executarAcao(r: PerguntaRow) {
		if (!r.acao) return;
		const rota = rotaDaAcao(r.acao.id, permissoes, undefined, areasLib);
		if (rota) navigate(rota);
	}

	return (
		<div className="mx-auto max-w-[960px] px-4 py-8 sm:px-6">
			<PageHeading title="Minhas perguntas" description="Suas conversas com o Assistente dos últimos 90 dias." />
			{loading ? (
				<div className="rounded-2xl bg-white p-8 text-center text-[14px] text-[#8E8E93]" style={{ boxShadow: '0 0 0 1px #E5E5EA, 0 2px 12px rgba(0,0,0,.04)' }}>Carregando...</div>
			) : lista.length === 0 ? (
				<div className="rounded-2xl bg-[#F5F5F7] p-10 text-center text-[14px] text-[#6E6E73]" style={{ boxShadow: '0 0 0 1px #E5E5EA, 0 2px 12px rgba(0,0,0,.04)' }}>
					<MessageCircle size={28} className="mx-auto mb-3 text-[#8E8E93]" />
					Você ainda não fez perguntas ao Assistente.
				</div>
			) : (
				<div className="overflow-hidden rounded-2xl bg-white" style={{ boxShadow: '0 0 0 1px #E5E5EA, 0 2px 12px rgba(0,0,0,.04)' }}>
					{/* Desktop: tabela */}
					<div className="hidden md:block">
						<div className="grid grid-cols-[1fr_180px_120px_140px_40px] gap-3 border-b border-[#E5E5EA] px-5 py-3 text-[12px] font-semibold text-[#8E8E93]">
							<span>Pergunta</span>
							<span>Tela</span>
							<span>Quando</span>
							<span>Resultado</span>
							<span />
						</div>
						{lista.map(r => (
							<div key={r.id}>
								<button
									onClick={() => setAberta(aberta === r.id ? null : r.id)}
									aria-expanded={aberta === r.id}
									className="grid w-full grid-cols-[1fr_180px_120px_140px_40px] items-center gap-3 border-b border-[#F0F0F2] px-5 py-3 text-left hover:bg-[#F5F5F7]"
								>
									<span className="truncate text-[14px] text-[#1D1D1F]">{r.pergunta}</span>
									<span className="truncate text-[13px] text-[#6E6E73]">{r.tela_nome ?? telaNome(r.tela ?? '')}</span>
									<span className="text-[13px] text-[#6E6E73] tnum">{dateBR(r.criado_em)}</span>
									<ResultadoPill r={r} />
									<ChevronRight size={15} className={`text-[#8E8E93] transition-transform ${aberta === r.id ? 'rotate-90' : ''}`} />
								</button>
								{aberta === r.id && (
									<div className="border-b border-[#F0F0F2] bg-[#F5F5F7] px-5 py-4">
										{r.resposta && <p className="whitespace-pre-wrap text-[14px] leading-relaxed text-[#1D1D1F]">{r.resposta}</p>}
										<div className="mt-3 flex flex-wrap gap-2">
											<button onClick={() => void perguntarDeNovo(r)} className="inline-flex h-8 items-center gap-1.5 rounded-full border border-[#D2D2D7] bg-white px-3 text-[12.5px] font-medium text-[#1D1D1F] hover:bg-[#F5F5F7]">
												<RotateCw size={13} /> Perguntar de novo
											</button>
											{r.acao && rotaDaAcao(r.acao.id, permissoes, undefined, areasLib) !== null && (
												<button onClick={() => executarAcao(r)} className="inline-flex h-8 items-center gap-1.5 rounded-full bg-[#1D1D1F] px-3 text-[12.5px] font-semibold text-white hover:opacity-85">
													{r.acao.rotulo} <ArrowRight size={13} />
												</button>
											)}
										</div>
									</div>
								)}
							</div>
						))}
					</div>

					{/* Mobile: cartões */}
					<div className="divide-y divide-[#F0F0F2] md:hidden">
						{lista.map(r => (
							<div key={r.id}>
								<button
									onClick={() => setAberta(aberta === r.id ? null : r.id)}
									aria-expanded={aberta === r.id}
									className="flex w-full items-start gap-3 px-4 py-3 text-left"
								>
									<div className="min-w-0 flex-1">
										<p className="text-[14px] text-[#1D1D1F]">{r.pergunta}</p>
										<div className="mt-1 flex flex-wrap items-center gap-2 text-[12px] text-[#8E8E93]">
											<span>{r.tela_nome ?? telaNome(r.tela ?? '')}</span>
											<span>·</span>
											<span className="tnum">{dateTimeBR(r.criado_em)}</span>
										</div>
										<div className="mt-1.5"><ResultadoPill r={r} /></div>
									</div>
									<ChevronRight size={15} className={`mt-1 shrink-0 text-[#8E8E93] transition-transform ${aberta === r.id ? 'rotate-90' : ''}`} />
								</button>
								{aberta === r.id && (
									<div className="bg-[#F5F5F7] px-4 py-3">
										{r.resposta && <p className="whitespace-pre-wrap text-[13.5px] leading-relaxed text-[#1D1D1F]">{r.resposta}</p>}
										<div className="mt-3 flex flex-wrap gap-2">
											<button onClick={() => void perguntarDeNovo(r)} className="inline-flex h-8 items-center gap-1.5 rounded-full border border-[#D2D2D7] bg-white px-3 text-[12px] font-medium text-[#1D1D1F] hover:bg-[#F5F5F7]">
												<RotateCw size={12} /> Perguntar de novo
											</button>
											{r.acao && rotaDaAcao(r.acao.id, permissoes, undefined, areasLib) !== null && (
												<button onClick={() => executarAcao(r)} className="inline-flex h-8 items-center gap-1.5 rounded-full bg-[#1D1D1F] px-3 text-[12px] font-semibold text-white hover:opacity-85">
													{r.acao.rotulo} <ArrowRight size={12} />
												</button>
											)}
										</div>
									</div>
								)}
							</div>
						))}
					</div>
				</div>
			)}
		</div>
	);
}

function ResultadoPill({ r }: { r: PerguntaRow }) {
	const { texto, cor } = resultadoLabel(r);
	const icon = r.avaliacao === 1 ? <ThumbsUp size={12} /> : r.avaliacao === -1 ? <ThumbsDown size={12} /> : null;
	return (
		<span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[12px] font-medium" style={{ backgroundColor: cor === '#8E8E93' || cor === '#9A631B' ? '#FFF7E8' : '#F5F5F7', color: cor }}>
			{icon}
			{texto}
		</span>
	);
}
