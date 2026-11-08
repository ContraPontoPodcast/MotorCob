// Assistente de implantação (proposta aprovada, protótipo ux-implantacao): 5 passos num lugar só, com o progresso
// salvo no banco (implantacao_progresso). A equipe começa pelo Console (Nova empresa) ou pelo Início; o cliente chega
// pelos Primeiros passos. Cada passo diz quem faz e o que é obrigatório para rodar.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { Check } from 'lucide-react';
import { useMotorAuth } from '@/components/auth-provider';
import { friendlyError, supabase } from '@/lib/supabase';
import { Estado } from '@/components/ds';
import { Voltar } from '@/components/comuns/voltar';
import { PASSOS, passoInicial, passosFeitos, type Situacao } from '@/lib/implantacao';
import { PassoEmpresa, PassoCarteira, PassoCarga, PassoAcionar, PassoPronto } from './passos';

export function AssistenteImplantacao() {
	const { perfil, empresa, selectEmpresa } = useMotorAuth();
	const navigate = useNavigate();
	const [params, setParams] = useSearchParams();
	const equipe = !!perfil?.equipe;
	const nova = params.get('nova') === '1';
	const empresaId = nova ? null : (params.get('empresa') ?? empresa?.id ?? null);
	const [sit, setSit] = useState<Situacao | null>(null);
	const [erro, setErro] = useState('');
	const [carregando, setCarregando] = useState(!!empresaId);
	const [passo, setPasso] = useState<number>(empresaId ? 0 : 1);

	const carregar = useCallback(async (manterPasso = true) => {
		if (!supabase || !empresaId) { setSit(null); setCarregando(false); return null; }
		const { data, error } = await supabase.rpc('implantacao_situacao', { empresa: empresaId });
		if (error) { setErro(friendlyError(error)); setCarregando(false); return null; }
		const s = data as Situacao;
		setSit(s); setErro(''); setCarregando(false);
		if (!manterPasso) setPasso(passoInicial(s));
		return s;
	}, [empresaId]);

	// a equipe que abre a implantação de uma empresa passa a "estar" nela (Cargas, Lista do dia e Canais usam a escolhida)
	useEffect(() => {
		if (equipe && empresaId && empresa?.id !== empresaId) void selectEmpresa(empresaId);
	}, [equipe, empresaId, empresa?.id, selectEmpresa]);
	useEffect(() => { setCarregando(!!empresaId); void carregar(false); }, [carregar, empresaId]);

	// carga na fila ou esperando as colunas: a tela atualiza sozinha
	const aguardando = sit?.carga?.status === 'pendente';
	useEffect(() => {
		if (!aguardando) return;
		const t = setInterval(() => { void carregar(); }, 6000);
		return () => clearInterval(t);
	}, [aguardando, carregar]);

	const feitos = useMemo(() => passosFeitos(sit), [sit]);

	async function ir(n: number) {
		setPasso(n);
		window.scrollTo?.(0, 0);
		if (supabase && sit && n >= 2) await supabase.rpc('marcar_passo_implantacao', { empresa: sit.empresa.id, passo: n, feito: false });
	}

	function criada(id: string) {
		void selectEmpresa(id);
		setParams({ empresa: id }, { replace: true });
	}

	if (!equipe && !empresa) return <Estado tipo="vazio" titulo="Escolha a empresa">Entre com o usuário da empresa para continuar a implantação.</Estado>;
	if (carregando) return <Estado tipo="carregando" />;
	if (erro) return <Estado tipo="erro" titulo="Não conseguimos abrir a implantação">{erro}</Estado>;

	const atual = passo || 1;
	const prontos = feitos.size;
	return (
		<div className="mx-auto max-w-[1180px] px-4 py-6">
			<Voltar />
			<div className="grid items-start gap-5 md:grid-cols-[260px_minmax(0,1fr)]">
				<aside className="min-w-0 rounded-2xl bg-[var(--base-cartao)] p-4 md:sticky md:top-[68px]" style={{ boxShadow: '0 0 0 1px var(--base-borda), 0 2px 12px rgba(0,0,0,.04)' }} aria-label="Passos da implantação">
					<h2 className="text-[15px] font-semibold text-[var(--base-texto)]">Implantação{sit ? ` da ${sit.empresa.nome}` : ''}</h2>
					<p className="mb-3 text-[12px] text-[var(--base-texto-2)]" data-teste="progresso">{prontos} de 5 prontos</p>
					<div className="mb-3 h-1.5 overflow-hidden rounded-full bg-[var(--base-fill)]"><i className="block h-full rounded-full bg-[var(--estado-pronto)]" style={{ width: `${Math.max(prontos, 0) * 20}%` }} /></div>
					<ol className="flex gap-1 overflow-x-auto md:flex-col">
						{PASSOS.map(p => {
							const feito = feitos.has(p.n) && p.n !== atual;
							const bloqueado = !sit && p.n > 1;
							return (
								<li key={p.n} className="min-w-[150px] md:min-w-0">
									<button type="button" disabled={bloqueado} onClick={() => void ir(p.n)} aria-current={p.n === atual ? 'step' : undefined}
										className={`flex w-full items-start gap-2.5 rounded-xl px-2.5 py-2 text-left disabled:opacity-50 ${p.n === atual ? 'bg-[var(--destaque-suave)]' : 'hover:bg-[var(--base-fill)]'}`}>
										<span className={`grid h-[22px] w-[22px] shrink-0 place-items-center rounded-full border-2 text-[12px] font-bold ${feito ? 'border-[var(--estado-pronto)] bg-[var(--estado-pronto)] text-white' : p.n === atual ? 'border-[var(--destaque)] text-[var(--destaque)]' : 'border-[var(--base-field-border)] text-[var(--base-texto-2)]'}`}>{feito ? <Check size={12} /> : p.n}</span>
										<span className="min-w-0">
											<b className="block text-[13.5px] font-semibold text-[var(--base-texto)]">{p.titulo} {p.quem && <span className={`ml-1 rounded px-1.5 py-px align-[1px] text-[10px] font-bold uppercase tracking-wide ${p.quem === 'equipe' ? 'bg-[var(--base-fill)] text-[var(--base-texto-2)]' : 'bg-[var(--destaque-suave)] text-[var(--destaque)]'}`}>{p.quem}</span>}</b>
											<small className="block text-[12px] text-[var(--base-texto-2)]">{p.sub}</small>
										</span>
									</button>
								</li>
							);
						})}
					</ol>
				</aside>
				<div className="min-w-0">
					{atual === 1 && <PassoEmpresa sit={sit} equipe={equipe} onCriada={criada} onContinuar={() => void ir(2)} onNovaOutra={() => navigate('/implantacao?nova=1')} />}
					{atual === 2 && sit && <PassoCarteira sit={sit} onVoltar={() => void ir(1)} onSalvo={async () => { await carregar(); setPasso(3); }} />}
					{atual === 3 && sit && <PassoCarga sit={sit} recarregar={() => carregar()} onVoltar={() => void ir(2)} onContinuar={() => void ir(4)} />}
					{atual === 4 && sit && <PassoAcionar sit={sit} onVoltar={() => void ir(3)} onSalvo={async () => { await carregar(); setPasso(5); }} />}
					{atual === 5 && sit && <PassoPronto sit={sit} equipe={equipe} recarregar={() => carregar()} onVoltar={() => void ir(4)} onIr={n => void ir(n)} />}
				</div>
			</div>
		</div>
	);
}
