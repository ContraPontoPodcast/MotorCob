import { useEffect, useState, type ReactNode } from 'react';
import { Navigate, Outlet, useNavigate } from 'react-router';
import { Shield, Info, X } from 'lucide-react';
import { useMotorAuth } from '@/components/auth-provider';
import { supabase } from '@/lib/supabase';
import { mfaRedirect } from '@/lib/mfa-guard';
import { useFrente } from '@/components/frente-provider';
import { FRENTE_AVISO_KEY, frenteInfo, type FrenteId } from '@/lib/frentes';
import { AssistenteProvider } from '@/components/workspace/assistente/assistente-context';
import { AssistenteAvatar } from '@/components/workspace/assistente/assistente-avatar';
import { AssistenteGaveta } from '@/components/workspace/assistente/assistente-gaveta';
import { LateralIcones, useLarguraLateral } from '@/components/lateral-icones';
import { MobileNavDrawer, AvatarMenu, CompanyPill } from '@/components/platform-top-bar';
import { SinoAvisos } from '@/components/comuns/sino-avisos';
import { CommandPalette } from '@/components/workspace/workspace-command-palette';
import { useAreaLabel } from '@/components/tema-provider';
import { AbasTelas } from '@/components/abas-telas';
import { areaDaRota } from '@/lib/area-rota';
import { Link, useLocation } from 'react-router';
import { Menu, Search, HelpCircle } from 'lucide-react';
import { MarcaMotorCX } from '@/components/site/marca-motorcx';

/** Aviso discreto de frente do link não liberada, mostrado no topo do Workspace. */
function FrenteAvisoBanner() {
	const [aviso, setAviso] = useState<FrenteId | null>(null);
	useEffect(() => {
		const v = sessionStorage.getItem(FRENTE_AVISO_KEY);
		if (v === 'motorcob' || v === 'motorcli') {
			setAviso(v);
			sessionStorage.removeItem(FRENTE_AVISO_KEY);
		}
	}, []);
	if (!aviso) return null;
	const nome = frenteInfo(aviso).nome;
	return (
		<div className="mx-auto max-w-[1200px] px-4 pt-3">
			<div className="flex items-center gap-3 rounded-xl bg-[var(--base-fill)] px-4 py-2.5 text-[13px]" style={{ boxShadow: '0 0 0 1px var(--base-borda)', color: 'var(--base-texto)' }}>
				<Info size={15} className="shrink-0 text-[var(--base-texto-3)]" />
				<span className="flex-1">Sua empresa ainda não tem a {nome}. Fale com o time comercial.</span>
				<button onClick={() => setAviso(null)} aria-label="Fechar aviso" className="grid h-6 w-6 shrink-0 place-items-center rounded-md text-[var(--base-texto-3)] hover:bg-[var(--base-fill-2)]"><X size={14} /></button>
			</div>
		</div>
	);
}

function BlockedScreen({ title, subtitle, onSair }: { title: string; subtitle: string; onSair: () => void }) {
	return (
		<div className="mc-platform grid min-h-screen place-items-center p-6" style={{ backgroundColor: 'var(--base-conteudo)' }}>
			<div className="rounded-2xl bg-[var(--base-cartao)] p-10 text-center" style={{ boxShadow: '0 0 0 1px var(--base-borda), 0 2px 12px rgba(0,0,0,.04)' }}>
				<Shield className="mx-auto mb-5" style={{ color: 'var(--base-texto)' }} size={36} />
				<h1 className="text-xl font-semibold" style={{ color: 'var(--base-texto)' }}>{title}</h1>
				<p className="mt-2 text-sm text-[var(--base-texto-2)]">{subtitle}</p>
				<button onClick={onSair} className="mt-6 rounded-full bg-[var(--base-texto)] px-6 py-3 text-[15px] font-medium text-white">Sair</button>
			</div>
		</div>
	);
}

/** Barra do topo do cartão (sticky) para o Workspace. */
function TopoCartaoWorkspace({ onMenuClick }: { onMenuClick?: () => void }) {
	const areaLabel = useAreaLabel();
	const loc = useLocation();
	const [paletteOpen, setPaletteOpen] = useState(false);

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
				{onMenuClick && (
					<button onClick={onMenuClick} aria-label="Abrir menu" className="grid h-9 w-9 place-items-center rounded-lg hover:bg-[var(--base-fill)] lg:hidden" style={{ color: 'var(--base-texto)' }}><Menu size={20} /></button>
				)}
				<Link to="/inicio" className="flex items-center gap-2 lg:hidden"><MarcaMotorCX /></Link>
				<span className="hidden text-[13px] font-medium text-[var(--base-texto-3)] lg:block">{areaLabel}</span>
				{/* Pílula da empresa (a mesma das áreas): a equipe escolhe a empresa também no Workspace. */}
				<div className="hidden lg:block"><CompanyPill /></div>
				<div className="ml-auto flex items-center gap-1">
					<button onClick={() => setPaletteOpen(true)} className="hidden h-9 items-center gap-2 rounded-lg border px-3 text-[13px] hover:bg-[var(--base-fill)] lg:flex" style={{ borderColor: 'var(--base-borda)', backgroundColor: 'var(--base-fill)', color: 'var(--base-texto-3)' }}>
						<Search size={15} />
						<span className="max-w-[180px] truncate">Busque uma tela, um cliente ou pergunte</span>
						<kbd className="rounded px-1.5 py-0.5 text-[10px] font-medium" style={{ backgroundColor: 'var(--base-borda)' }}>⌘K</kbd>
					</button>
					<button onClick={() => setPaletteOpen(true)} aria-label="Buscar" className="grid h-9 w-9 place-items-center rounded-lg hover:bg-[var(--base-fill)] lg:hidden" style={{ color: 'var(--base-texto-2)' }}><Search size={18} /></button>
					<Link to="/ajuda/o-que-significa" aria-label="O que significa" className="hidden h-9 w-9 place-items-center rounded-lg hover:bg-[var(--base-fill)] lg:grid" style={{ color: 'var(--base-texto-3)' }}><HelpCircle size={18} /></Link>
					<SinoAvisos />
					<div className="lg:hidden"><AvatarMenu /></div>
				</div>
			</div>
			<CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
		</>
	);
}

/** Shell do Workspace: lateral de ícones + cartão de conteúdo (mesma moldura do app-shell). */
export function WorkspaceShell() {
	const { session, perfil, loading, error, desativado } = useMotorAuth();
	const [mobileOpen, setMobileOpen] = useState(false);
	const larguraLateral = useLarguraLateral();
	const navigate = useNavigate();
	const loc = useLocation();

	useEffect(() => {
		if (!supabase || !session || !perfil) return;
		let active = true;
		mfaRedirect(supabase, perfil.papel === 'admin').then(path => {
			if (!active || !path) return;
			navigate(path, { replace: true });
		}).catch(() => { /* ignora; o login trata */ });
		return () => { active = false; };
	}, [session, perfil, navigate]);

	async function sair() { if (supabase) await supabase.auth.signOut(); navigate('/login', { replace: true }); }

	if (loading) return <div className="mc-platform grid min-h-screen place-items-center" style={{ backgroundColor: 'var(--base-conteudo)', color: 'var(--base-texto)' }}><div className="flex items-center gap-3 text-[var(--base-texto-2)]"><span className="h-5 w-5 animate-spin rounded-full border-2 border-[var(--base-borda)] border-t-[var(--base-texto)]" /> Carregando seu espaço...</div></div>;
	if (!session) return <Navigate to="/login" replace />;
	if (desativado) return <BlockedScreen title="Seu acesso foi desativado." subtitle="Fale com o Admin da sua empresa." onSair={sair} />;
	if (error) return <div className="mc-platform grid min-h-screen place-items-center p-6" style={{ backgroundColor: 'var(--base-conteudo)', color: 'var(--base-texto)' }}><p>Não foi possível verificar seu acesso. Atualize a página.</p></div>;
	const bloqueado = !perfil?.ativo || (!perfil.equipe && !perfil.empresa_id);
	if (bloqueado) return <BlockedScreen title="Acesso não liberado." subtitle="Fale com o administrador." onSair={sair} />;

	return (
		<AssistenteProvider>
			<div className="mc-platform min-h-screen" style={{ backgroundColor: 'var(--base-conteudo)', color: 'var(--base-texto)' }}>
				<div className="hidden lg:block"><LateralIcones /></div>
				<div style={{ marginLeft: larguraLateral }} className="lg:p-2.5">
					<div className="overflow-hidden rounded-2xl border" style={{ borderColor: 'var(--base-borda)', backgroundColor: 'var(--base-cartao)', minHeight: 'calc(100vh - 20px)' }}>
						<TopoCartaoWorkspace onMenuClick={() => setMobileOpen(true)} />
						{areaDaRota(loc.pathname) === 'empresa' && <AbasTelas area="empresa" />}
						<FrenteAvisoBanner />
						<Outlet />
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

/** Cabeçalho de página do Workspace (título + descrição + ações). */
export function WorkspaceHeading({ title, description, actions }: { title: string; description?: string; actions?: ReactNode }) {
	return (
		<div className="mx-auto mb-6 max-w-[1200px] px-4">
			<div className="flex flex-wrap items-start justify-between gap-3">
				<div className="min-w-0">
					<h1 className="text-[24px] font-bold tracking-tight" style={{ color: 'var(--base-texto)' }}>{title}</h1>
					{description && <p className="mt-1 text-[14px] text-[var(--base-texto-2)]">{description}</p>}
				</div>
				{actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
			</div>
		</div>
	);
}
