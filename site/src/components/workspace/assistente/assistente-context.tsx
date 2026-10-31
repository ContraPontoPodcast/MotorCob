import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { useNavigate, useLocation } from 'react-router';
import { useMotorAuth } from '@/components/auth-provider';
import { useFrente } from '@/components/frente-provider';
import { useAreasLiberadas } from '@/hooks/use-areas-liberadas';
import {
	avaliarResposta,
	carregarSugestoes,
	chamarAssistente,
	falarComSuporte,
	rotaDaAcao,
	telaNome,
	CHAMADO_ASSISTENTE_KEY,
	type MsgHistorico,
	type StreamEvento,
} from '@/lib/assistente';

export type Mensagem = {
	id?: string;
	papel: 'usuario' | 'assistente';
	texto: string;
	passos?: string[];
	acao?: { id: string; rotulo: string } | null;
	situacao?: string;
	removeu?: boolean;
	avaliacao?: 1 | -1 | null;
	avaliacaoMotivo?: string | null;
	erro?: 'limite' | 'erro' | 'sessao' | null;
	origem: 'busca' | 'conversa';
	streaming?: boolean;
};

type Sugestoes = { tela: string[]; frequentes: string[] };

type AssistenteContextValue = {
	mensagens: Mensagem[];
	loading: boolean;
	campoVisivel: boolean;
	drawerOpen: boolean;
	oculto: boolean;
	balaoVisivel: boolean;
	balaoSaindo: boolean;
	aviso: string | null;
	telaNomeAtual: string;
	sugestoes: Sugestoes;
	carregandoSugestoes: boolean;
	perguntar: (pergunta: string, origem: 'busca' | 'conversa') => Promise<void>;
	avaliar: (msgId: string | undefined, nota: 1 | -1, motivo?: string) => Promise<void>;
	abrirGaveta: () => void;
	fecharGaveta: () => void;
	fecharCampo: () => void;
	executarAcao: (msg: Mensagem) => void;
	/** A ação da resposta leva a uma tela que a pessoa pode abrir (permissão e área contratada)? */
	acaoDisponivel: (msg: Mensagem) => boolean;
	esconderAssistente: () => void;
	mostrarAssistente: () => void;
	abrirSuporte: (msg: Mensagem, avaliacaoMotivo?: string | null) => Promise<void>;
};

const Context = createContext<AssistenteContextValue>({
	mensagens: [],
	loading: false,
	campoVisivel: false,
	drawerOpen: false,
	oculto: false,
	balaoVisivel: false,
	balaoSaindo: false,
	aviso: null,
	telaNomeAtual: '',
	sugestoes: { tela: [], frequentes: [] },
	carregandoSugestoes: false,
	perguntar: async () => {},
	avaliar: async () => {},
	abrirGaveta: () => {},
	fecharGaveta: () => {},
	fecharCampo: () => {},
	executarAcao: () => {},
	acaoDisponivel: () => false,
	esconderAssistente: () => {},
	mostrarAssistente: () => {},
	abrirSuporte: async () => {},
});

export const useAssistente = () => useContext(Context);

const STORAGE_KEY = 'motorcob.assistente.conversa';
const OCULTO_KEY = 'mc-assistente-oculto';

// Flag em memória: o balão já foi mostrado nesta sessão de navegação.
let balaoJaMostrado = false;

function carregarMensagens(): Mensagem[] {
	if (typeof window === 'undefined') return [];
	try {
		const raw = sessionStorage.getItem(STORAGE_KEY);
		const list = raw ? (JSON.parse(raw) as Mensagem[]) : [];
		// Mensagens em streaming no reload viram não-streaming.
		return list.map(m => m.streaming ? { ...m, streaming: false } : m);
	} catch { return []; }
}

function lerOculto(): boolean {
	if (typeof window === 'undefined') return false;
	try { return localStorage.getItem(OCULTO_KEY) === '1'; } catch { return false; }
}

export function AssistenteProvider({ children }: { children: ReactNode }) {
	const { permissoes } = useMotorAuth();
	const { frente } = useFrente();
	const areasLib = useAreasLiberadas();
	const navigate = useNavigate();
	const location = useLocation();
	const [mensagens, setMensagens] = useState<Mensagem[]>(carregarMensagens);
	const [loading, setLoading] = useState(false);
	const [campoVisivel, setCampoVisivel] = useState(false);
	const [drawerOpen, setDrawerOpen] = useState(false);
	const [oculto, setOculto] = useState<boolean>(lerOculto);
	const [balaoVisivel, setBalaoVisivel] = useState(false);
	const [balaoSaindo, setBalaoSaindo] = useState(false);
	const [aviso, setAviso] = useState<string | null>(null);
	const [sugestoes, setSugestoes] = useState<Sugestoes>({ tela: [], frequentes: [] });
	const [carregandoSugestoes, setCarregandoSugestoes] = useState(false);

	const balaoTimer = useRef<number | null>(null);
	const balaoFadeTimer = useRef<number | null>(null);
	const avisoTimer = useRef<number | null>(null);
	const abortRef = useRef<AbortController | null>(null);
	const telaRef = useRef(location.pathname);

	const telaNomeAtual = telaNome(location.pathname);

	// Persiste a conversa em sessionStorage.
	useEffect(() => {
		try { sessionStorage.setItem(STORAGE_KEY, JSON.stringify(mensagens)); } catch { /* ignore */ }
	}, [mensagens]);

	// Carrega sugestões ao trocar de tela (só com a gaveta sem conversa).
	useEffect(() => {
		telaRef.current = location.pathname;
		if (mensagens.length > 0) return;
		let active = true;
		setCarregandoSugestoes(true);
		carregarSugestoes(location.pathname).then(s => {
			if (!active) return;
			setSugestoes(s);
			setCarregandoSugestoes(false);
		});
		return () => { active = false; };
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [location.pathname, mensagens.length]);

	const dispararBalao = useCallback(() => {
		if (balaoTimer.current) window.clearTimeout(balaoTimer.current);
		if (balaoFadeTimer.current) window.clearTimeout(balaoFadeTimer.current);
		setBalaoSaindo(false);
		setBalaoVisivel(true);
		balaoTimer.current = window.setTimeout(() => {
			setBalaoSaindo(true);
			balaoFadeTimer.current = window.setTimeout(() => {
				setBalaoVisivel(false);
				setBalaoSaindo(false);
			}, 400);
		}, 7000);
	}, []);

	const mostrarAviso = useCallback((texto: string, duracao = 6000) => {
		if (avisoTimer.current) window.clearTimeout(avisoTimer.current);
		setAviso(texto);
		avisoTimer.current = window.setTimeout(() => setAviso(null), duracao);
	}, []);

	const esconderAssistente = useCallback(() => {
		setOculto(true);
		try { localStorage.setItem(OCULTO_KEY, '1'); } catch { /* ignore */ }
		if (balaoTimer.current) window.clearTimeout(balaoTimer.current);
		if (balaoFadeTimer.current) window.clearTimeout(balaoFadeTimer.current);
		setBalaoVisivel(false);
		setBalaoSaindo(false);
		mostrarAviso('Assistente escondido. Para trazer de volta: menu do usuário › Mostrar o Assistente. As perguntas no campo do Início continuam funcionando.', 6000);
	}, [mostrarAviso]);

	const mostrarAssistente = useCallback(() => {
		setOculto(false);
		try { localStorage.setItem(OCULTO_KEY, '0'); } catch { /* ignore */ }
		mostrarAviso('Assistente de volta no canto da tela.', 4000);
		dispararBalao();
	}, [dispararBalao, mostrarAviso]);

	const perguntar = useCallback(async (pergunta: string, origem: 'busca' | 'conversa') => {
		const texto = pergunta.trim();
		if (!texto || loading) return;
		// Cancela qualquer streaming anterior.
		abortRef.current?.abort();
		const ctrl = new AbortController();
		abortRef.current = ctrl;

		const tela = telaRef.current;
		const nomeTela = telaNome(tela);
		const historico: MsgHistorico[] = mensagens.slice(-8).map(m => ({ papel: m.papel, texto: m.texto }));
		const userMsg: Mensagem = { papel: 'usuario', texto, origem };
		const botMsg: Mensagem = { papel: 'assistente', texto: '', passos: [], acao: null, situacao: 'respondida', streaming: true, origem };
		const novas = [...mensagens, userMsg, botMsg];
		setMensagens(novas);
		setLoading(true);
		if (origem === 'busca') setCampoVisivel(true);

		try {
			await chamarAssistente(
				{ pergunta: texto, origem, tela, tela_nome: nomeTela, frente, historico },
				(e: StreamEvento) => {
					if (e.tipo === 'texto') {
						setMensagens(prev => prev.map((m, i) =>
							i === prev.length - 1 ? { ...m, texto: m.texto + e.texto } : m));
					} else {
						const r = e.resposta;
						setMensagens(prev => prev.map((m, i) =>
							i === prev.length - 1 ? {
								...m,
								id: r.id,
								texto: r.texto,
								passos: r.passos,
								acao: r.acao,
								situacao: r.situacao ?? 'respondida',
								removeu: r.removeu,
								streaming: false,
							} : m));
					}
				},
				ctrl.signal,
			);
		} catch (err) {
			if (ctrl.signal.aborted) return;
			const tipo = (err as { tipo?: string }).tipo;
			if (tipo === 'sessao') {
				navigate('/login', { replace: true });
				return;
			}
			const eTipo: 'limite' | 'erro' = tipo === 'limite' ? 'limite' : 'erro';
			setMensagens(prev => prev.map((m, i) =>
				i === prev.length - 1 ? {
					...m,
					texto: eTipo === 'limite'
						? 'Muitas perguntas seguidas. Tente de novo em alguns minutos.'
						: 'O Assistente está fora do ar agora. Tente de novo em alguns minutos ou fale com o Suporte.',
					passos: [],
					acao: null,
					erro: eTipo,
					streaming: false,
					situacao: eTipo === 'limite' ? 'limite' : 'fora_do_ar',
				} : m));
		} finally {
			if (abortRef.current === ctrl) abortRef.current = null;
			setLoading(false);
		}
	}, [mensagens, loading, frente, navigate]);

	const avaliar = useCallback(async (msgId: string | undefined, nota: 1 | -1, motivo?: string) => {
		if (!msgId) return;
		await avaliarResposta(msgId, nota, motivo);
		setMensagens(prev => prev.map(m => m.id === msgId ? { ...m, avaliacao: nota, avaliacaoMotivo: motivo ?? null } : m));
	}, []);

	const abrirGaveta = useCallback(() => setDrawerOpen(true), []);
	const fecharGaveta = useCallback(() => {
		setDrawerOpen(false);
		if (!lerOculto()) dispararBalao();
	}, [dispararBalao]);
	const fecharCampo = useCallback(() => setCampoVisivel(false), []);

	const executarAcao = useCallback((msg: Mensagem) => {
		if (!msg.acao) return;
		if (msg.acao.id === 'abrir_chamado') {
			void abrirSuporte(msg);
			return;
		}
		const rota = rotaDaAcao(msg.acao.id, permissoes, undefined, areasLib);
		if (rota) { setDrawerOpen(false); navigate(rota); }
	}, [permissoes, navigate, areasLib]);

	const acaoDisponivel = useCallback((msg: Mensagem) => {
		if (!msg.acao) return false;
		if (msg.acao.id === 'abrir_chamado') return true;
		return rotaDaAcao(msg.acao.id, permissoes, undefined, areasLib) !== null;
	}, [permissoes, areasLib]);

	const abrirSuporte = useCallback(async (msg: Mensagem, avaliacaoMotivo?: string | null) => {
		const idx = mensagens.indexOf(msg);
		const pergunta = mensagens.slice(0, idx).reverse().find(m => m.papel === 'usuario')?.texto ?? '';
		const historico: MsgHistorico[] = mensagens.slice(-8).map(m => ({ papel: m.papel, texto: m.texto }));
		const avaliacao = avaliacaoMotivo ? `👎 ${avaliacaoMotivo}` : null;
		setDrawerOpen(false);
		setCampoVisivel(false);
		try {
			const r = await falarComSuporte({
				pergunta,
				tela: telaRef.current,
				tela_nome: telaNome(telaRef.current),
				historico,
				avaliacao,
			});
			const payload = {
				motivo: r.motivo,
				assunto: r.assunto,
				conversa: r.conversa,
				assistente_pergunta_id: msg.id ?? '',
			};
			try { sessionStorage.setItem(CHAMADO_ASSISTENTE_KEY, JSON.stringify(payload)); } catch { /* ignore */ }
			navigate('/suporte/novo?assistente=1');
		} catch {
			mostrarAviso('Não foi possível abrir o chamado agora. Tente de novo em alguns minutos.', 5000);
		}
	}, [mensagens, navigate, mostrarAviso]);

	// Mostra o balão uma vez ao carregar.
	useEffect(() => {
		if (!oculto && !balaoJaMostrado) {
			balaoJaMostrado = true;
			dispararBalao();
		}
	}, [oculto, dispararBalao]);

	// Limpa os temporizadores ao desmontar.
	useEffect(() => () => {
		if (balaoTimer.current) window.clearTimeout(balaoTimer.current);
		if (balaoFadeTimer.current) window.clearTimeout(balaoFadeTimer.current);
		if (avisoTimer.current) window.clearTimeout(avisoTimer.current);
		abortRef.current?.abort();
	}, []);

	return (
		<Context.Provider value={{
			mensagens, loading, campoVisivel, drawerOpen, oculto, balaoVisivel, balaoSaindo, aviso,
			telaNomeAtual, sugestoes, carregandoSugestoes,
			perguntar, avaliar, abrirGaveta, fecharGaveta, fecharCampo, executarAcao, acaoDisponivel, esconderAssistente, mostrarAssistente, abrirSuporte,
		}}>
			{children}
			{aviso && (
				<div className="fixed inset-x-0 bottom-0 z-[95] flex justify-center px-4" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }} role="status" aria-live="polite">
					<div className="mb-5 max-w-[520px] rounded-2xl bg-[#1D1D1F] px-4 py-3 text-[13.5px] leading-snug text-white" style={{ boxShadow: '0 8px 24px rgba(0,0,0,.22)' }}>
						{aviso}
					</div>
				</div>
			)}
		</Context.Provider>
	);
}
