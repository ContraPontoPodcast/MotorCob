import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useNavigate, useLocation } from 'react-router';
import { Building2, ChevronDown, HelpCircle, LogOut, Menu, Search, User as UserIcon, BookOpen, X, Terminal, ShieldCheck, type LucideIcon } from 'lucide-react';
import { useMotorAuth } from '@/components/auth-provider';
import { useFrente } from '@/components/frente-provider';
import { areaDaRota, areaLabel } from '@/lib/area-rota';
import { AREA_ICON } from '@/lib/area-icones';
import { MarcaMotorCX } from '@/components/site/marca-motorcx';
import { SinoAvisos } from '@/components/comuns/sino-avisos';
import { CommandPalette } from '@/components/workspace/workspace-command-palette';
import { PERM } from '@/lib/permissoes';
import { supabase } from '@/lib/supabase';
import { useAreasLiberadas } from '@/hooks/use-areas-liberadas';

const roleName: Record<string, string> = { admin: 'Administrador', planejamento: 'Planejamento', operacao: 'Operação', gestao: 'Gestão' };

function initials(nome?: string) {
	if (!nome) return 'U';
	const p = nome.trim().split(/\s+/);
	return ((p[0]?.[0] ?? '') + (p[1]?.[0] ?? '')).toUpperCase();
}

function useClickOutside<T extends HTMLElement>(onOut: () => void) {
	const ref = useRef<T>(null);
	useEffect(() => {
		function handler(e: MouseEvent) { if (ref.current && !ref.current.contains(e.target as Node)) onOut(); }
		document.addEventListener('mousedown', handler);
		return () => document.removeEventListener('mousedown', handler);
	}, [onOut]);
	return ref;
}

type AreaItem = { id: string; nome: string; icon: LucideIcon; cor: string; to: string; contratada: boolean };

/** Pílula da empresa para a equipe (dropdown com busca). */
export function CompanyPill() {
	const { perfil, empresa, empresas, selectEmpresa } = useMotorAuth();
	const [open, setOpen] = useState(false);
	const [busca, setBusca] = useState('');
	const ref = useClickOutside<HTMLDivElement>(() => setOpen(false));
	useEffect(() => {
		if (!open) return;
		function onKey(e: KeyboardEvent) { if (e.key === 'Escape') setOpen(false); }
		window.addEventListener('keydown', onKey);
		return () => window.removeEventListener('keydown', onKey);
	}, [open]);

	const filtrada = busca.trim() ? empresas.filter(e => e.nome.toLowerCase().includes(busca.trim().toLowerCase())) : empresas;
	return (
		<div className="relative hidden lg:block" ref={ref}>
			<button onClick={() => setOpen(o => !o)} className="flex h-8 items-center gap-1.5 rounded-full border border-[#E5E5EA] px-3 text-[13px] font-medium text-[#1D1D1F] hover:bg-[#F5F5F7]">
				<Building2 size={14} className="text-[#8E8E93]" />
				<span className="max-w-[120px] truncate">{empresa?.nome ?? 'Escolha a empresa'}</span>
				<ChevronDown size={13} className="text-[#8E8E93]" />
			</button>
			{open && (
				<div className="absolute left-0 top-10 z-50 w-[280px] overflow-hidden rounded-2xl bg-white" style={{ boxShadow: '0 0 0 1px #E5E5EA, 0 24px 60px -20px rgba(0,0,0,.4)' }}>
					<div className="border-b border-[#E5E5EA] p-2">
						<input autoFocus value={busca} onChange={e => setBusca(e.target.value)} placeholder="Buscar empresa" className="h-9 w-full rounded-lg bg-[#F5F5F7] px-3 text-[14px] outline-none placeholder:text-[#8E8E93]" />
					</div>
					<div className="max-h-[280px] overflow-y-auto p-1">
						{filtrada.length === 0 ? <p className="px-3 py-4 text-center text-[13px] text-[#8E8E93]">Nenhuma empresa.</p> :
							filtrada.map(e => (
								<button key={e.id} onClick={() => { void selectEmpresa(e.id); setOpen(false); setBusca(''); }} className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-[14px] hover:bg-[#F5F5F7] ${e.id === empresa?.id ? 'font-semibold' : ''}`}>
									<span className="truncate">{e.nome}</span>
									{e.id === empresa?.id && <span className="ml-2 h-2 w-2 shrink-0 rounded-full bg-[#34C759]" />}
								</button>
							))}
					</div>
				</div>
			)}
		</div>
	);
}

/** Dropdown Áreas ▾: Cobrança, Jornada, Mensageria, Relatórios.
 *  Áreas não contratadas aparecem esmaecidas; clicar abre a rota (que mostra
 *  a página "área não contratada"). Equipe sem pílula vê tudo. */
function AreasDropdown({ areas }: { areas: AreaItem[] }) {
	const [open, setOpen] = useState(false);
	const ref = useClickOutside<HTMLDivElement>(() => setOpen(false));
	const navigate = useNavigate();
	const location = useLocation();
	useEffect(() => {
		if (!open) return;
		function onKey(e: KeyboardEvent) { if (e.key === 'Escape') setOpen(false); }
		window.addEventListener('keydown', onKey);
		return () => window.removeEventListener('keydown', onKey);
	}, [open]);

	const atual = areaDaRota(location.pathname);

	return (
		<div className="relative" ref={ref}>
			<button onClick={() => setOpen(o => !o)} className="flex h-8 items-center gap-1 rounded-lg px-3 text-[14px] font-medium text-[#1D1D1F] hover:bg-[#F5F5F7]">
				{atual !== 'workspace' && atual !== 'console' ? areaLabel(location.pathname) : 'Áreas'} <ChevronDown size={14} className={`text-[#8E8E93] transition-transform ${open ? 'rotate-180' : ''}`} />
			</button>
			{open && (
				<div className="absolute left-0 top-10 z-50 w-[300px] overflow-hidden rounded-2xl bg-white py-1" style={{ boxShadow: '0 0 0 1px #E5E5EA, 0 24px 60px -20px rgba(0,0,0,.4)' }}>
					{areas.map(a => {
						const Icon = a.icon;
						return (
							<button key={a.id} onClick={() => { setOpen(false); navigate(a.to); }} className="flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-[#F5F5F7]">
								<span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg" style={{ backgroundColor: a.cor + '20' }}>
									<Icon size={16} style={{ color: a.cor }} />
								</span>
								<div className="min-w-0 flex-1">
									<p className={`text-[14px] font-medium ${a.contratada ? 'text-[#1D1D1F]' : 'text-[#8E8E93]'}`}>{a.nome}</p>
									{!a.contratada && <p className="text-[12px] text-[#8E8E93]">Não contratada</p>}
								</div>
								<span className="shrink-0 text-[12px] font-medium text-[#0A60D0]">{a.contratada ? 'Abrir ›' : 'Ver'}</span>
							</button>
						);
					})}
				</div>
			)}
		</div>
	);
}

/** Dropdown Empresa ▾: Dados e contatos, Pessoas e perfis, Integrações, Faturas, Auditoria. */
function EmpresaDropdown() {
	const { permissoes } = useMotorAuth();
	const [open, setOpen] = useState(false);
	const ref = useClickOutside<HTMLDivElement>(() => setOpen(false));
	useEffect(() => {
		if (!open) return;
		function onKey(e: KeyboardEvent) { if (e.key === 'Escape') setOpen(false); }
		window.addEventListener('keydown', onKey);
		return () => window.removeEventListener('keydown', onKey);
	}, [open]);

	const items: { to: string; label: string; perm?: string }[] = [
		{ to: '/empresa/contatos', label: 'Dados e contatos' },
		{ to: '/empresa/pessoas', label: 'Pessoas e perfis' },
		{ to: '/empresa/integracoes', label: 'Integrações' },
		{ to: '/empresa/faturamento', label: 'Faturas', perm: PERM.verFaturamento },
		{ to: '/empresa/auditoria', label: 'Auditoria', perm: PERM.verAuditoria },
	].filter(it => !it.perm || permissoes.includes(it.perm));

	if (items.length === 0) return null;

	return (
		<div className="relative" ref={ref}>
			<button onClick={() => setOpen(o => !o)} className="flex h-8 items-center gap-1 rounded-lg px-3 text-[14px] font-medium text-[#1D1D1F] hover:bg-[#F5F5F7]">
				Empresa <ChevronDown size={14} className={`text-[#8E8E93] transition-transform ${open ? 'rotate-180' : ''}`} />
			</button>
			{open && (
				<div className="absolute left-0 top-10 z-50 w-[220px] overflow-hidden rounded-2xl bg-white py-1" style={{ boxShadow: '0 0 0 1px #E5E5EA, 0 24px 60px -20px rgba(0,0,0,.4)' }}>
					{items.map(it => (
						<Link key={it.to} to={it.to} onClick={() => setOpen(false)} className="block px-4 py-2.5 text-[14px] text-[#1D1D1F] hover:bg-[#F5F5F7]">{it.label}</Link>
					))}
				</div>
			)}
		</div>
	);
}

/** Menu do avatar: Minha conta, Documentação, Console (equipe), Sair. */
export function AvatarMenu() {
	const { perfil } = useMotorAuth();
	const navigate = useNavigate();
	const [open, setOpen] = useState(false);
	const ref = useClickOutside<HTMLDivElement>(() => setOpen(false));
	const btnRef = useRef<HTMLButtonElement>(null);

	useEffect(() => {
		if (!open) return;
		function onKey(e: KeyboardEvent) { if (e.key === 'Escape') { setOpen(false); btnRef.current?.focus(); } }
		window.addEventListener('keydown', onKey);
		return () => window.removeEventListener('keydown', onKey);
	}, [open]);

	async function sair() { if (supabase) await supabase.auth.signOut(); navigate('/login', { replace: true }); }

	return (
		<div className="relative" ref={ref}>
			<button ref={btnRef} onClick={() => setOpen(o => !o)} aria-label="Menu do usuário" aria-expanded={open} className="grid h-8 w-8 place-items-center rounded-full bg-[#3A3A3C] text-[13px] font-semibold text-white">
				{initials(perfil?.nome)}
			</button>
			{open && (
				<div className="absolute right-0 top-10 z-50 w-[240px] overflow-hidden rounded-2xl bg-white" style={{ boxShadow: '0 0 0 1px #E5E5EA, 0 24px 60px -20px rgba(0,0,0,.4)' }}>
					<div className="flex items-center gap-3 border-b border-[#E5E5EA] p-4">
						<div className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-[#3A3A3C] text-[15px] font-semibold text-white">{initials(perfil?.nome)}</div>
						<div className="min-w-0">
							<p className="truncate text-[15px] font-semibold text-[#1D1D1F]">{perfil?.nome}</p>
							<p className="truncate text-[13px] text-[#6E6E73]">{perfil?.equipe ? 'Equipe MotorCX' : (roleName[perfil?.papel ?? ''] ?? perfil?.papel)}</p>
						</div>
					</div>
					<div className="p-1">
						<button onClick={() => { setOpen(false); navigate('/conta'); }} className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-[14px] text-[#1D1D1F] hover:bg-[#F5F5F7]"><UserIcon size={16} className="text-[#8E8E93]" /> Minha conta</button>
						<button onClick={() => { setOpen(false); navigate('/ajuda/o-que-significa'); }} className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-[14px] text-[#1D1D1F] hover:bg-[#F5F5F7]"><HelpCircle size={16} className="text-[#8E8E93]" /> O que significa</button>
				<button onClick={() => { setOpen(false); navigate('/docs'); }} className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-[14px] text-[#1D1D1F] hover:bg-[#F5F5F7]"><BookOpen size={16} className="text-[#8E8E93]" /> Documentação</button>
						{perfil?.equipe && <button onClick={() => { setOpen(false); navigate('/console'); }} className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-[14px] text-[#1D1D1F] hover:bg-[#F5F5F7]"><ShieldCheck size={16} className="text-[#8E8E93]" /> Console MotorCX</button>}
						<div className="my-1 border-t border-[#E5E5EA]" />
						<button onClick={sair} className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-[14px] text-[#FF3B30] hover:bg-[#FFE8E6]"><LogOut size={16} /> Sair</button>
					</div>
				</div>
			)}
		</div>
	);
}

export function PlatformTopBar({ onMenuClick }: { onMenuClick?: () => void }) {
	const { perfil, empresa } = useMotorAuth();
	const { aplicarFrente } = useFrente();
	const navigate = useNavigate();
	const location = useLocation();
	const [paletteOpen, setPaletteOpen] = useState(false);
	const [suportePendentes, setSuportePendentes] = useState(0);
	const areasLib = useAreasLiberadas();
	const isEquipe = !!perfil?.equipe;

	// ⌘K: no Início foca a busca do Assistente; nas demais abre a palette.
	useEffect(() => {
		function onKey(e: KeyboardEvent) {
			if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
				e.preventDefault();
				if (location.pathname === '/inicio') {
					window.dispatchEvent(new CustomEvent('motorcob:focus-busca'));
				} else {
					setPaletteOpen(o => !o);
				}
			}
		}
		window.addEventListener('keydown', onKey);
		return () => window.removeEventListener('keydown', onKey);
	}, [location.pathname]);

	// Chamados "Aguardando você".
	useEffect(() => {
		if (!supabase || !empresa) { setSuportePendentes(0); return; }
		const sb = supabase;
		const empId = empresa.id;
		let active = true;
		async function reload() {
			const { count } = await sb.from('chamados').select('id', { count: 'exact', head: true }).eq('empresa_id', empId).eq('situacao', 'aguardando_cliente');
			if (!active) return;
			setSuportePendentes(Number(count ?? 0));
		}
		void reload();
		const id = window.setInterval(reload, 60000);
		function onVisto() { void reload(); }
		window.addEventListener('mc:suporte-visto', onVisto);
		return () => { active = false; window.clearInterval(id); window.removeEventListener('mc:suporte-visto', onVisto); };
	}, [empresa?.id]);

	function irArea(a: AreaItem) {
		// A troca de área é navegação: só sincroniza a frente da sessão (não apaga a preferência).
		if (a.id === 'cobranca') aplicarFrente('motorcob');
		if (a.id === 'jornada') aplicarFrente('motorcli');
		navigate(a.to);
	}

	const areas: AreaItem[] = [
		{ id: 'cobranca', nome: 'Cobrança', icon: AREA_ICON.cobranca, cor: '#C9A35A', to: '/fila', contratada: areasLib.cobranca },
		{ id: 'jornada', nome: 'Jornada do Cliente', icon: AREA_ICON.jornada, cor: '#8E8E93', to: '/jornada', contratada: areasLib.jornada },
		{ id: 'mensageria', nome: 'Mensageria', icon: AREA_ICON.mensageria, cor: '#7A4FB0', to: `/mensageria/${areasLib.canalPadrao}`, contratada: areasLib.mensageria },
		{ id: 'relatorios', nome: 'Relatórios', icon: AREA_ICON.relatorios, cor: '#0A60D0', to: '/relatorios', contratada: true },
	];

	return (
		<>
			<header className="sticky top-0 z-40 border-b border-[#E5E5EA] bg-white">
				<div className="mx-auto flex h-14 max-w-[1480px] items-center gap-1 px-4">
					{/* Mobile: ☰ */}
					{onMenuClick && (
						<button onClick={onMenuClick} aria-label="Abrir menu" className="grid h-9 w-9 place-items-center rounded-lg text-[#1D1D1F] hover:bg-[#F5F5F7] lg:hidden"><Menu size={20} /></button>
					)}

					{/* Logo */}
					<Link to="/inicio" className="flex items-center gap-2 shrink-0">
						<MarcaMotorCX />
					</Link>

					{/* Company pill (equipe) */}
					{isEquipe && <CompanyPill />}

					{/* Desktop nav */}
					<nav className="hidden lg:flex items-center gap-0.5 ml-2">
						<Link to="/inicio" className="flex h-8 items-center rounded-lg px-3 text-[14px] font-medium text-[#1D1D1F] hover:bg-[#F5F5F7]">Início</Link>
						<AreasDropdown areas={areas} />
						<EmpresaDropdown />
						<Link to="/suporte" className="flex h-8 items-center gap-1.5 rounded-lg px-3 text-[14px] font-medium text-[#1D1D1F] hover:bg-[#F5F5F7]">
							Suporte
							{suportePendentes > 0 && <span className="inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-[#FF3B30] px-1 text-[11px] font-semibold text-white tnum">{suportePendentes > 99 ? '99+' : suportePendentes}</span>}
						</Link>
					</nav>

					{/* Search (desktop) */}
					<button onClick={() => setPaletteOpen(true)} className="ml-auto hidden h-9 min-w-[200px] items-center gap-2 rounded-lg border border-[#E5E5EA] bg-[#F5F5F7] px-3 text-[13px] text-[#8E8E93] hover:bg-[#EEEEF0] lg:flex xl:min-w-[280px]">
						<Search size={15} />
						<span className="flex-1 text-left truncate">Busque uma tela ou pergunte ao Assistente</span>
						<kbd className="rounded bg-[#E5E5EA] px-1.5 py-0.5 text-[10px] font-medium text-[#8E8E93]">⌘K</kbd>
					</button>

					{/* Right side */}
					<div className="ml-auto flex items-center gap-1 lg:ml-2">
						{isEquipe && (
							<button onClick={() => navigate('/console')} className="hidden h-9 items-center gap-1.5 rounded-lg px-3 text-[14px] font-medium text-[#1D1D1F] hover:bg-[#F5F5F7] lg:flex">
								<Terminal size={16} className="text-[#8E8E93]" /> Console
							</button>
						)}
						<Link to="/ajuda/o-que-significa" aria-label="O que significa" className="hidden h-9 w-9 place-items-center rounded-lg text-[#8E8E93] hover:bg-[#F5F5F7] hover:text-[#1D1D1F] lg:grid"><HelpCircle size={18} /></Link>
						<SinoAvisos />
						<AvatarMenu />
					</div>
				</div>
			</header>

			<CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
		</>
	);
}

/** Gaveta móvel com Início, Console (equipe), Áreas, Empresa, Suporte (e conteúdo extra da área). */
export function MobileNavDrawer({ open, onClose, children }: { open: boolean; onClose: () => void; children?: ReactNode }) {
	const { perfil, permissoes } = useMotorAuth();
	const { aplicarFrente } = useFrente();
	const navigate = useNavigate();
	const areasLib = useAreasLiberadas();
	const isEquipe = !!perfil?.equipe;

	function irArea(id: string, to: string) {
		if (id === 'cobranca') aplicarFrente('motorcob');
		if (id === 'jornada') aplicarFrente('motorcli');
		navigate(to);
		onClose();
	}

	if (!open) return null;

	const areas: { id: string; nome: string; to: string; contratada: boolean }[] = [
		{ id: 'cobranca', nome: 'Cobrança', to: '/fila', contratada: areasLib.cobranca },
		{ id: 'jornada', nome: 'Jornada do Cliente', to: '/jornada', contratada: areasLib.jornada },
		{ id: 'mensageria', nome: 'Mensageria', to: `/mensageria/${areasLib.canalPadrao}`, contratada: areasLib.mensageria },
		{ id: 'relatorios', nome: 'Relatórios', to: '/relatorios', contratada: true },
	];

	const areaIcon = (id: string) => { const I = AREA_ICON[id as keyof typeof AREA_ICON] ?? Building2; return I; };

	return (
		<div className="fixed inset-0 z-[60] lg:hidden" role="dialog" aria-modal="true">
			<button aria-label="Fechar menu" className="absolute inset-0 bg-black/40" onClick={onClose} />
			<div className="absolute inset-y-0 left-0 flex w-[300px] max-w-[85vw] flex-col bg-white">
				<div className="flex h-14 items-center justify-between border-b border-[#E5E5EA] px-4">
					<MarcaMotorCX />
					<button onClick={onClose} aria-label="Fechar" className="grid h-8 w-8 place-items-center rounded-lg text-[#8E8E93] hover:bg-[#F5F5F7]"><X size={18} /></button>
				</div>
				<div className="flex-1 overflow-y-auto p-2">
					<Link to="/inicio" onClick={onClose} className="block rounded-lg px-3 py-2.5 text-[15px] font-medium text-[#1D1D1F] hover:bg-[#F5F5F7]">Início</Link>
					{isEquipe && (
						<button onClick={() => { navigate('/console'); onClose(); }} className="flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-left text-[15px] font-medium text-[#1D1D1F] hover:bg-[#F5F5F7]">
							<Terminal size={16} className="text-[#8E8E93]" /> Console MotorCX
						</button>
					)}

					<p className="px-3 pt-3 pb-1 text-[11px] font-semibold uppercase tracking-wide text-[#8E8E93]">Áreas</p>
					{areas.map(a => { const Icon = areaIcon(a.id); return (
						<button key={a.id} onClick={() => irArea(a.id, a.to)} className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-[15px] hover:bg-[#F5F5F7]">
							<Icon size={16} className={a.contratada ? 'text-[#8E8E93]' : 'text-[#8E8E93] opacity-60'} />
							<span className={`flex-1 ${a.contratada ? 'text-[#1D1D1F]' : 'text-[#8E8E93]'}`}>{a.nome}</span>
							<span className="text-[12px] font-medium text-[#0A60D0]">{a.contratada ? 'Abrir ›' : 'Ver'}</span>
						</button>
					); })}

					<p className="px-3 pt-3 pb-1 text-[11px] font-semibold uppercase tracking-wide text-[#8E8E93]">Empresa</p>
					<Link to="/empresa/contatos" onClick={onClose} className="block rounded-lg px-3 py-2.5 text-[15px] text-[#1D1D1F] hover:bg-[#F5F5F7]">Dados e contatos</Link>
					<Link to="/empresa/pessoas" onClick={onClose} className="block rounded-lg px-3 py-2.5 text-[15px] text-[#1D1D1F] hover:bg-[#F5F5F7]">Pessoas e perfis</Link>
					<Link to="/empresa/integracoes" onClick={onClose} className="block rounded-lg px-3 py-2.5 text-[15px] text-[#1D1D1F] hover:bg-[#F5F5F7]">Integrações</Link>
					{permissoes.includes(PERM.verFaturamento) && <Link to="/empresa/faturamento" onClick={onClose} className="block rounded-lg px-3 py-2.5 text-[15px] text-[#1D1D1F] hover:bg-[#F5F5F7]">Faturas</Link>}
					{permissoes.includes(PERM.verAuditoria) && <Link to="/empresa/auditoria" onClick={onClose} className="block rounded-lg px-3 py-2.5 text-[15px] text-[#1D1D1F] hover:bg-[#F5F5F7]">Auditoria</Link>}

					<p className="px-3 pt-3 pb-1 text-[11px] font-semibold uppercase tracking-wide text-[#8E8E93]">Suporte</p>
					<Link to="/suporte" onClick={onClose} className="block rounded-lg px-3 py-2.5 text-[15px] text-[#1D1D1F] hover:bg-[#F5F5F7]">Chamados</Link>

					{children}

					<div className="mt-4 border-t border-[#E5E5EA] p-2">
						<Link to="/conta" onClick={onClose} className="block rounded-lg px-3 py-2.5 text-[15px] text-[#1D1D1F] hover:bg-[#F5F5F7]">Minha conta</Link>
						<Link to="/ajuda/o-que-significa" onClick={onClose} className="block rounded-lg px-3 py-2.5 text-[15px] text-[#1D1D1F] hover:bg-[#F5F5F7]">O que significa</Link>
					<Link to="/docs" onClick={onClose} className="block rounded-lg px-3 py-2.5 text-[15px] text-[#1D1D1F] hover:bg-[#F5F5F7]">Documentação</Link>
					</div>
				</div>
			</div>
		</div>
	);
}
