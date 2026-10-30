import { useEffect, useState, type ReactNode } from 'react';
import { Link, Outlet, Navigate, useNavigate, useLocation } from 'react-router';
import { Activity, Lock, Search, HelpCircle, Menu, ShieldCheck } from 'lucide-react';
import { useMotorAuth } from '@/components/auth-provider';
import { supabase, dateBR, moneyBR, type Row } from '@/lib/supabase';
import { mfaRedirect } from '@/lib/mfa-guard';
import { ErrorDetail } from '@/components/error-detail';
import { useFrente } from '@/components/frente-provider';
import { PERM } from '@/lib/permissoes';
import { isCanalValido, CANAL_STORAGE_KEY } from '@/lib/mensageria-produtos';
import { areaDaRota } from '@/lib/area-rota';
import { useAreasLiberadas } from '@/hooks/use-areas-liberadas';
import { AssistenteProvider } from '@/components/workspace/assistente/assistente-context';
import { AssistenteAvatar } from '@/components/workspace/assistente/assistente-avatar';
import { AssistenteGaveta } from '@/components/workspace/assistente/assistente-gaveta';
import { useAreaLabel } from '@/components/tema-provider';
import { AreaNaoContratada } from '@/components/area-nao-contratada';
import { LateralIcones, useLarguraLateral } from '@/components/lateral-icones';
import { AbasTelas } from '@/components/abas-telas';
import { CompanyPill, AvatarMenu, MobileNavDrawer } from '@/components/platform-top-bar';
import { SinoAvisos } from '@/components/comuns/sino-avisos';
import { CommandPalette } from '@/components/workspace/workspace-command-palette';
import { CanalPills } from '@/components/mensageria/canal-pills';
import { MarcaMotorCX } from '@/components/site/marca-motorcx';

function dateExtensa() {
	try { return new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date()); }
	catch { return ''; }
}

function minusDayISO(iso: string): string {
	const dt = new Date(iso);
	if (isNaN(dt.getTime())) return iso;
	dt.setDate(dt.getDate() - 1);
	const yy = dt.getFullYear();
	const mm = String(dt.getMonth() + 1).padStart(2, '0');
	const dd = String(dt.getDate()).padStart(2, '0');
	return `${yy}-${mm}-${dd}`;
}

/** Controles do cabeçalho: buscar cliente + credor. */
function HeaderControls() {
	const { empresa, credor, credores, selectCredor } = useMotorAuth();
	const navigate = useNavigate();
	const [busca, setBusca] = useState('');
	function buscar(e: React.FormEvent) {
		e.preventDefault();
		const id = busca.trim();
		if (!id) return;
		navigate(`/cliente?id=${encodeURIComponent(id)}`);
		setBusca('');
	}
	return (
		<div className="flex flex-wrap items-center gap-2">
			<form onSubmit={buscar} className="relative">
				<input
					value={busca}
					onChange={e => setBusca(e.target.value)}
					placeholder="Buscar cliente"
					aria-label="Buscar cliente por ID ou contrato"
					className="h-9 w-[200px] rounded-[10px] bg-[var(--base-fill)] px-3 text-[13px] text-[var(--base-texto)] outline-none placeholder:text-[var(--base-texto-3)] focus-visible:bg-[var(--base-cartao)] focus-visible:ring-1 focus-visible:ring-[var(--base-field-border)] sm:w-[260px]"
				/>
			</form>
			{empresa && credores.length > 0 && (
				credores.length === 1 ? (
					<span className="hidden h-9 items-center gap-1.5 rounded-[10px] bg-[var(--base-fill)] px-3 text-[13px] font-medium text-[var(--base-texto)] sm:flex">
						{credores[0].nome}
					</span>
				) : (
					<label className="flex h-9 items-center gap-1.5 rounded-[10px] bg-[var(--base-fill)] px-3 text-[13px] font-medium text-[var(--base-texto)]">
						<span className="sr-only">Carteira</span>
						<select aria-label="Carteira" value={credor?.id ?? ''} onChange={e => selectCredor(e.target.value || null)} className="h-9 max-w-[190px] bg-transparent text-[13px] font-medium outline-none">
							<option value="">Todas as carteiras</option>
							{credores.map(c => <option key={c.id} value={c.id} style={c.ativo ? undefined : { color: '#8E8E93' }}>{c.nome}{c.ativo ? '' : ' (fora de cobrança)'}</option>)}
						</select>
					</label>
				)
			)}
		</div>
	);
}

/** Barra do topo do cartão (sticky): migalha + pílula da empresa + ⌘K + ? + sino. */
function TopoCartao({ onMenuClick }: { onMenuClick?: () => void }) {
	const areaLabel = useAreaLabel();
	const [paletteOpen, setPaletteOpen] = useState(false);
	const loc = useLocation();

	useEffect(() => {
		function onKey(e: KeyboardEvent) {
			if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
				e.preventDefault();
				if (loc.pathname === '/inicio') {
					window.dispatchEvent(new CustomEvent('motorcob:focus-busca'));
				} else {
					setPaletteOpen(o => !o);
				}
			}
		}
		window.addEventListener('keydown', onKey);
		return () => window.removeEventListener('keydown', onKey);
	}, [loc.pathname]);

	return (
		<>
			<div className="sticky top-0 z-30 flex h-11 items-center gap-2 border-b px-3" style={{ borderColor: 'var(--base-borda)', backgroundColor: 'var(--base-cartao)' }}>
				{/* Mobile: ☰ */}
				{onMenuClick && (
					<button onClick={onMenuClick} aria-label="Abrir menu" className="grid h-9 w-9 place-items-center rounded-lg text-[var(--base-texto)] hover:bg-[var(--base-fill)] lg:hidden"><Menu size={20} /></button>
				)}
				{/* Mobile: logo */}
				<Link to="/inicio" className="flex items-center gap-2 lg:hidden">
					<MarcaMotorCX />
				</Link>
				{/* Migalha (desktop) */}
				<span className="hidden text-[13px] font-medium text-[var(--base-texto-3)] lg:block">{areaLabel}</span>
				{/* Pílula da empresa (equipe) */}
				<div className="hidden lg:block"><CompanyPill /></div>
				{/* Direita: ⌘K + ? + sino + avatar (mobile) */}
				<div className="ml-auto flex items-center gap-1">
					<button onClick={() => setPaletteOpen(true)} className="hidden h-9 items-center gap-2 rounded-lg border px-3 text-[13px] text-[var(--base-texto-3)] hover:bg-[var(--base-fill)] lg:flex" style={{ borderColor: 'var(--base-borda)', backgroundColor: 'var(--base-fill)' }}>
						<Search size={15} />
						<span className="max-w-[180px] truncate">Busque uma tela, um cliente ou pergunte</span>
						<kbd className="rounded bg-[var(--base-borda)] px-1.5 py-0.5 text-[10px] font-medium">⌘K</kbd>
					</button>
					<button onClick={() => setPaletteOpen(true)} aria-label="Buscar" className="grid h-9 w-9 place-items-center rounded-lg text-[var(--base-texto-2)] hover:bg-[var(--base-fill)] lg:hidden"><Search size={18} /></button>
					<Link to="/ajuda/o-que-significa" aria-label="O que significa" className="hidden h-9 w-9 place-items-center rounded-lg text-[var(--base-texto-3)] hover:bg-[var(--base-fill)] hover:text-[var(--base-texto)] lg:grid"><HelpCircle size={18} /></Link>
					<SinoAvisos />
					<div className="lg:hidden"><AvatarMenu /></div>
				</div>
			</div>
			<CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
		</>
	);
}

export function AppShell() {
	const { session, perfil, empresa, permissoes, loading, error, desativado } = useMotorAuth();
	const { aplicarFrente } = useFrente();
	const [mobileOpen, setMobileOpen] = useState(false);
	const larguraLateral = useLarguraLateral();
	const navigate = useNavigate();
	const loc = useLocation();

	const areasLib = useAreasLiberadas();
	const isConsole = loc.pathname.startsWith('/console');
	const canalMatch = loc.pathname.match(/^\/mensageria\/([^/]+)/);
	const canal = (() => {
		const raw = canalMatch?.[1];
		if (raw && isCanalValido(raw)) return raw;
		if (raw && !isCanalValido(raw)) {
			const fromUrl = new URLSearchParams(loc.search).get('canal');
			if (fromUrl && isCanalValido(fromUrl)) return fromUrl;
		}
		let stored: string | null = null;
		try { stored = localStorage.getItem(CANAL_STORAGE_KEY); } catch { /* ignore */ }
		return (stored && isCanalValido(stored)) ? stored : areasLib.canalPadrao;
	})();

	const [atendimentoPendentes, setAtendimentoPendentes] = useState(0);
	const [implantacaoPedidos, setImplantacaoPedidos] = useState(0);
	const [acesso, setAcesso] = useState<Row | null>(null);
	const [acordo, setAcordo] = useState<Row | null>(null);
	const [quemPaga, setQuemPaga] = useState<string | null>(null);

	useEffect(() => {
		if (!supabase || !perfil?.equipe || !isConsole) { setAtendimentoPendentes(0); return; }
		const sb = supabase;
		let active = true;
		async function reload() {
			const { data } = await sb.rpc('atendimento_pendentes');
			if (!active) return;
			setAtendimentoPendentes(Number((data as Row | null)?.aguardando_equipe ?? 0));
		}
		void reload();
		const id = window.setInterval(reload, 60000);
		function onVisto() { void reload(); }
		window.addEventListener('mc:atendimento-visto', onVisto);
		return () => { active = false; window.clearInterval(id); window.removeEventListener('mc:atendimento-visto', onVisto); };
	}, [perfil?.equipe, isConsole]);

	useEffect(() => {
		if (!supabase || !perfil?.equipe || !isConsole) { setImplantacaoPedidos(0); return; }
		const sb = supabase;
		let active = true;
		async function reload() {
			const { count } = await sb.from('pedidos_envio_real').select('id', { count: 'exact', head: true }).eq('situacao', 'aberto');
			if (!active) return;
			setImplantacaoPedidos(count ?? 0);
		}
		void reload();
		const id = window.setInterval(reload, 60000);
		return () => { active = false; window.clearInterval(id); };
	}, [perfil?.equipe, isConsole]);

	useEffect(() => {
		if (!supabase || !empresa || perfil?.equipe) { setAcesso(null); setAcordo(null); return; }
		const sb = supabase;
		let active = true;
		(async () => {
			const { data: ac } = await sb.rpc('acesso_da_empresa', { empresa_id: empresa.id });
			if (!active) return;
			setAcesso((ac as Row | null) ?? null);
			try {
				const { data: acs } = await sb.rpc('acordos', { empresa_id: empresa.id });
				if (!active) return;
				setAcordo((Array.isArray(acs) ? (acs as Row[]) : [])[0] ?? null);
			} catch { if (active) setAcordo(null); }
		})();
		return () => { active = false; };
	}, [empresa?.id, perfil?.equipe, loc.pathname]);

	useEffect(() => {
		if (!supabase || !empresa || perfil?.equipe) { setQuemPaga(null); return; }
		let active = true;
		(async () => {
			try {
				const { data } = await supabase.rpc('pessoas_empresa', { empresa: empresa.id });
				if (!active) return;
				const admins = ((data ?? []) as Row[]).filter((r) => r.papel === 'admin' && r.nome).map((r) => String(r.nome));
				setQuemPaga(admins.length ? admins.join(', ') : null);
			} catch { if (active) setQuemPaga(null); }
		})();
		return () => { active = false; };
	}, [empresa?.id, perfil?.equipe]);

	useEffect(() => {
		if (!supabase || !session || !perfil) return;
		let active = true;
		mfaRedirect(supabase, perfil.papel === 'admin').then(path => { if (!active || !path) return; navigate(path, { replace: true }); }).catch(() => { /* ignora */ });
		return () => { active = false; };
	}, [session, perfil, navigate]);

	// Sincroniza a frente da sessão com a rota (só cobranca e jornada).
	useEffect(() => {
		const a = areaDaRota(loc.pathname);
		if (a === 'cobranca') aplicarFrente('motorcob');
		else if (a === 'jornada') aplicarFrente('motorcli');
	}, [loc.pathname, aplicarFrente]);

	async function logout() { await supabase?.auth.signOut(); navigate('/login', { replace: true }); }

	if (loading) return <div className="mc-platform grid min-h-screen place-items-center" style={{ backgroundColor: 'var(--base-conteudo)', color: 'var(--base-texto)' }}><div className="flex items-center gap-3"><Activity className="animate-pulse" /> Carregando seu espaço...</div></div>;
	if (!session) return <Navigate to="/login" replace />;
	if (desativado) return <div className="mc-platform grid min-h-screen place-items-center p-6" style={{ backgroundColor: 'var(--base-conteudo)' }}><div className="rounded-2xl bg-[var(--base-cartao)] p-10 text-center" style={{ boxShadow: '0 0 0 1px var(--base-borda), 0 2px 12px rgba(0,0,0,.04)' }}><ShieldCheck className="mx-auto mb-5" style={{ color: 'var(--base-texto)' }} size={36} /><h1 className="text-xl font-semibold">Seu acesso foi desativado.</h1><p className="mt-2 text-sm text-[var(--base-texto-2)]">Fale com o Admin da sua empresa.</p><button onClick={logout} className="mt-6 rounded-full bg-[var(--base-texto)] px-6 py-3 text-[15px] font-medium text-white">Sair</button></div></div>;
	if (error) return <div className="mc-platform grid min-h-screen place-items-center p-6" style={{ backgroundColor: 'var(--base-conteudo)', color: 'var(--base-texto)' }}><p>Não foi possível verificar seu acesso. Atualize a página e tente novamente.</p></div>;
	const bloqueado = !perfil?.ativo || (!perfil.equipe && !perfil.empresa_id);
	if (bloqueado) return <div className="mc-platform grid min-h-screen place-items-center p-6" style={{ backgroundColor: 'var(--base-conteudo)' }}><div className="rounded-2xl bg-[var(--base-cartao)] p-10 text-center" style={{ boxShadow: '0 0 0 1px var(--base-borda), 0 2px 12px rgba(0,0,0,.04)' }}><ShieldCheck className="mx-auto mb-5" style={{ color: 'var(--base-texto)' }} size={36} /><h1 className="text-xl font-semibold">Acesso não liberado. Fale com o administrador.</h1><button onClick={logout} className="mt-6 rounded-full bg-[var(--base-texto)] px-6 py-3 text-[15px] font-medium text-white">Sair</button></div></div>;

	const area = areaDaRota(loc.pathname);

	// Cliente sem a área contratada → página de área não contratada.
	const areaContratada = area === 'cobranca' ? areasLib.cobranca :
		area === 'jornada' ? areasLib.jornada :
		area === 'mensageria' ? areasLib.mensageria : true;
	if (!areaContratada) {
		return (
			<AssistenteProvider>
				<div className="mc-platform min-h-screen" style={{ backgroundColor: 'var(--base-conteudo)', color: 'var(--base-texto)' }}>
					<div className="hidden lg:block"><LateralIcones /></div>
					<div style={{ marginLeft: larguraLateral }} className="lg:p-2.5">
						<div className="overflow-hidden rounded-2xl border" style={{ borderColor: 'var(--base-borda)', backgroundColor: 'var(--base-cartao)' }}>
							<TopoCartao onMenuClick={() => setMobileOpen(true)} />
							<main className="mx-auto max-w-[1480px] px-4 pb-28 pt-7 sm:px-[clamp(16px,4vw,48px)]">
								<AreaNaoContratada area={area} empresaNome={empresa?.nome} equipeComPill={!!perfil?.equipe && !!empresa} />
							</main>
						</div>
					</div>
					<MobileNavDrawer open={mobileOpen} onClose={() => setMobileOpen(false)} />
					<AssistenteAvatar />
					<AssistenteGaveta />
				</div>
			</AssistenteProvider>
		);
	}

	const acessoBloqueado = acesso?.bloqueada === true;
	const acessoSituacao = String(acesso?.situacao ?? '');
	const acessoLiberadaAte = acesso?.liberada_ate ? dateBR(acesso.liberada_ate) : '';
	const rotaPermitidaBloqueio = !acessoBloqueado || /^\/(empresa\/faturamento|suporte)/.test(loc.pathname);

	const podePagar = permissoes.includes(PERM.verFaturamento) && permissoes.includes(PERM.pagarFaturas);
	function PagarAgora({ corTexto }: { corTexto: string }) {
		if (podePagar) return <Link to="/empresa/faturamento" className="shrink-0 rounded-lg bg-white px-4 py-2 text-[13px] font-semibold hover:bg-white/90" style={{ color: corTexto }}>Pagar agora</Link>;
		return <span className="shrink-0 text-[13px] font-medium text-white/90">Quem paga as faturas é {quemPaga ?? 'o Admin da sua empresa'}.</span>;
	}

	const acordoSit = String(acordo?.situacao ?? '');
	const acordoQuebrado = acordoSit === 'quebrado' && Number(acordo?.valor_restante ?? 0) > 0;
	const acordoParcelaVencida = acordoSit === 'parcela_vencida';
	const acordoEmDia = acordoSit === 'em_dia';
	const naInicioOuFaturamento = loc.pathname === '/inicio' || loc.pathname === '/empresa/faturamento';
	const acordoPagueAte = acordo?.quebra_em ? dateBR(minusDayISO(String(acordo.quebra_em))) : '';

	// Áreas que mostram abas.
	const mostraAbas = ['cobranca', 'jornada', 'mensageria', 'relatorios', 'empresa', 'console'].includes(area);
	const badgesConsole = { atendimento: atendimentoPendentes, implantacao: implantacaoPedidos };

	return (
		<AssistenteProvider>
			<div className="mc-platform min-h-screen" style={{ backgroundColor: 'var(--base-conteudo)', color: 'var(--base-texto)' }}>
				{/* Lateral de ícones (desktop) */}
				<div className="hidden lg:block"><LateralIcones /></div>

				{/* Conteúdo: cartão à direita da lateral */}
				<div style={{ marginLeft: larguraLateral }} className="lg:p-2.5">
					<div className="overflow-hidden rounded-2xl border" style={{ borderColor: 'var(--base-borda)', backgroundColor: 'var(--base-cartao)', minHeight: 'calc(100vh - 20px)' }}>
						<TopoCartao onMenuClick={() => setMobileOpen(true)} />

						{/* Linha de canais da Mensageria (acima das abas) */}
						{area === 'mensageria' && <CanalPills />}

						{/* Abas da área */}
						{mostraAbas && (
							<AbasTelas area={area} canal={canal} badges={area === 'console' ? badgesConsole : undefined} />
						)}

						{/* Faixas de acesso/acordo */}
						{acessoBloqueado && acordoQuebrado && (
							<div className="flex flex-wrap items-center justify-between gap-3 bg-[#FF3B30] px-6 py-3 text-white">
								<p className="text-[14px] font-medium">O acordo de pagamento foi desfeito. O que falta, {moneyBR(acordo?.valor_restante)}, voltou a ser cobrado: pague em Faturamento para liberar.</p>
								<PagarAgora corTexto="#FF3B30" />
							</div>
						)}
						{acessoBloqueado && !acordoQuebrado && acessoSituacao === 'inadimplente' && (
							<div className="flex flex-wrap items-center justify-between gap-3 bg-[#FF3B30] px-6 py-3 text-white">
								<p className="text-[14px] font-medium">A fatura está vencida há mais de 10 dias. O acesso está bloqueado e os envios estão parados. Pague em Faturamento para liberar; volta sozinho quando o pagamento confirmar.</p>
								<PagarAgora corTexto="#FF3B30" />
							</div>
						)}
						{acessoBloqueado && !acordoQuebrado && (acessoSituacao === 'suspensa' || acessoSituacao === 'encerrada') && (
							<div className="flex flex-wrap items-center justify-between gap-3 bg-[#FF3B30] px-6 py-3 text-white">
								<p className="text-[14px] font-medium">Acesso suspenso pela equipe MotorCX. Fale com o Suporte.</p>
								<Link to="/suporte/novo?assunto=Acesso suspenso" className="shrink-0 rounded-lg bg-white px-4 py-2 text-[13px] font-semibold text-[#FF3B30] hover:bg-white/90">Falar com o Suporte</Link>
							</div>
						)}
						{!acessoBloqueado && acordoParcelaVencida && (
							<div className="flex flex-wrap items-center justify-between gap-3 bg-[#FF3B30] px-6 py-3 text-white">
								<p className="text-[14px] font-medium">A {Number(acordo?.proxima_numero ?? 0)}ª parcela do acordo venceu há {Number(acordo?.dias_atraso ?? 0)} dias. Pague até {acordoPagueAte} para não desfazer o acordo e bloquear o acesso.</p>
								<PagarAgora corTexto="#FF3B30" />
							</div>
						)}
						{!acessoBloqueado && !acordoParcelaVencida && acordoEmDia && naInicioOuFaturamento && (
							<div className="flex flex-wrap items-center justify-between gap-3 bg-[#FF9500] px-6 py-3 text-white">
								<p className="text-[14px] font-medium">Acordo de pagamento em dia. Próxima parcela: {moneyBR(acordo?.proxima_valor)} em {dateBR(acordo?.proxima_vencimento)}. O acesso fica liberado enquanto as parcelas estiverem em dia.</p>
								<PagarAgora corTexto="#9a631b" />
							</div>
						)}
						{!acessoBloqueado && !acordoParcelaVencida && !(acordoEmDia && naInicioOuFaturamento) && acesso?.liberada_ate && (
							<div className="flex flex-wrap items-center justify-between gap-3 bg-[#FF9500] px-6 py-3 text-white">
								<p className="text-[14px] font-medium">Acesso liberado pela MotorCX até {acessoLiberadaAte}. A fatura continua em aberto: pague até lá para não bloquear de novo.</p>
								<PagarAgora corTexto="#9a631b" />
							</div>
						)}

						<main className="mx-auto max-w-[1480px] px-4 pb-28 pt-7 sm:px-[clamp(16px,4vw,48px)]">
							{rotaPermitidaBloqueio ? <Outlet /> : (
								<div className="rounded-2xl bg-[var(--base-fill)] px-6 py-16 text-center" style={{ boxShadow: '0 0 0 1px var(--base-borda), 0 2px 12px rgba(0,0,0,.04)' }}>
									<Lock className="mx-auto mb-4 text-[#FF3B30]" size={32} />
									<h2 className="text-[18px] font-semibold">Acesso bloqueado por fatura vencida</h2>
									<p className="mt-2 text-[14px] text-[var(--base-texto-2)]">Pague a fatura em aberto para liberar o acesso.{acesso?.motivo ? ` · ${acesso.motivo}` : ''}</p>
									{podePagar
										? <Link to="/empresa/faturamento" className="mt-5 inline-flex h-10 items-center rounded-lg bg-[var(--base-texto)] px-6 text-[14px] font-semibold text-white hover:opacity-85">Pagar agora</Link>
										: <p className="mt-5 text-[14px] font-medium">Quem paga as faturas é {quemPaga ?? 'o Admin da sua empresa'}.</p>}
								</div>
							)}
						</main>

						<footer className="flex items-center justify-between border-t px-4 py-5 text-[11px] text-[var(--base-texto-3)] sm:px-[clamp(16px,4vw,48px)]" style={{ borderColor: 'var(--base-borda)' }}>
							<span>© {new Date().getFullYear()} MotorCX · Cobrança e experiência do cliente</span>
							<span>Ambiente seguro</span>
						</footer>
					</div>
				</div>

				<MobileNavDrawer open={mobileOpen} onClose={() => setMobileOpen(false)} />
				<AssistenteAvatar />
				<AssistenteGaveta />
			</div>
		</AssistenteProvider>
	);
}

export function usePermissao(codigo: string): boolean {
	const { permissoes } = useMotorAuth();
	return permissoes.includes(codigo);
}

export function useAllowed(roles: string[]) {
	const { permissoes, perfil } = useMotorAuth();
	if (!perfil) return false;
	if (roles.includes('admin') || roles.includes('planejamento')) {
		return permissoes.some(p => p.startsWith('editar_') || p === 'enviar_arquivos' || p === 'gerenciar_usuarios' || p === 'gerenciar_permissoes' || p === 'gerenciar_empresas');
	}
	return true;
}

export function PageHeading({ title, description, actions, titleExtra }: { eyebrow?: string; title: string; description?: string; actions?: ReactNode; titleExtra?: ReactNode }) {
	const { empresa, credor } = useMotorAuth();
	const areaLabel = useAreaLabel();
	const contexto = [empresa?.nome, credor?.nome, dateExtensa()].filter(Boolean).join(' · ');
	return (
		<div className="mb-7 flex flex-wrap items-start justify-between gap-4">
			<div className="min-w-0">
				<span className="mc-area-tag mb-1.5">{areaLabel}</span>
				<div className="flex items-center gap-2">
					<h1 className="mc-page-title text-[24px] font-bold leading-tight tracking-tight">{title}</h1>
					{titleExtra}
				</div>
				{contexto && <p className="mt-1 text-[14px] text-[var(--base-texto-2)]">{contexto}</p>}
				{description && <p className="mt-0.5 text-[13px] text-[var(--base-texto-3)]">{description}</p>}
			</div>
			<div className="mc-page-actions flex flex-wrap items-center gap-2">
				<HeaderControls />
				{actions}
			</div>
		</div>
	);
}

export function Empty({ children }: { children: ReactNode }) {
	return <div className="rounded-2xl bg-[var(--base-fill)] px-6 py-12 text-center text-[14px] text-[var(--base-texto-2)]" style={{ boxShadow: '0 0 0 1px var(--base-borda), 0 2px 12px rgba(0,0,0,.04)' }}>{children}</div>;
}

export function Loading() {
	return <div className="flex items-center gap-3 rounded-2xl bg-[var(--base-cartao)] px-8 py-8 text-[14px] text-[var(--base-texto-2)]" style={{ boxShadow: '0 0 0 1px var(--base-borda), 0 2px 12px rgba(0,0,0,.04)' }}><Activity className="animate-pulse" size={18} /> Carregando informações...</div>;
}

export function Notice({ children, variant = 'error' }: { children: ReactNode; variant?: 'error' | 'warning' | 'success' }) {
	const styles = {
		error: { bg: 'var(--base-fill)', fg: 'var(--estado-erro)', icon: 'var(--estado-atencao)' },
		warning: { bg: 'var(--base-fill)', fg: 'var(--base-texto)', icon: 'var(--estado-atencao)' },
		success: { bg: 'var(--base-fill)', fg: 'var(--estado-pronto-texto)', icon: 'var(--estado-pronto)' },
	}[variant];
	return (
		<div role="status" className="flex items-start gap-2 rounded-2xl px-4 py-3 text-[14px]" style={{ backgroundColor: styles.bg, color: styles.fg }}>
			<span className="mt-0.5 inline-block h-4 w-4 shrink-0 rounded-full" style={{ backgroundColor: styles.icon }} />
			<div className="min-w-0 flex-1">{children}{variant === 'error' && <ErrorDetail />}</div>
		</div>
	);
}

export function EmpresaGate({ children }: { children: ReactNode }) {
	const { empresa } = useMotorAuth();
	return empresa ? <>{children}</> : <Notice variant="warning">Escolha a empresa no topo para ver esta página.</Notice>;
}
