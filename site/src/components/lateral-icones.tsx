import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link, useNavigate, useLocation } from 'react-router';
import {
	House, CircleDollarSign, Route, MessagesSquare, FileChartColumn,
	Building, Headset, ShieldCheck, ChevronsRight,
} from 'lucide-react';
import { useMotorAuth } from '@/components/auth-provider';
import { useFrente } from '@/components/frente-provider';
import { areaDaRota, type AreaRota } from '@/lib/area-rota';
import { useAreasLiberadas } from '@/hooks/use-areas-liberadas';
import { supabase } from '@/lib/supabase';
import { AvatarMenu } from '@/components/platform-top-bar';
import { MotorCXMark } from '@/components/site/marca-motorcx';

const LATERAL_KEY = 'mc-lateral-nomes';

type RailItem = {
	area: AreaRota;
	nome: string;
	icon: typeof House;
	to: string;
	contratada: boolean;
};

/** Conta de chamados "Aguardando você" (atualiza a cada 60 s + mc:suporte-visto). */
function useSuportePendentes() {
	const { empresa } = useMotorAuth();
	const [n, setN] = useState(0);
	useEffect(() => {
		if (!supabase || !empresa) { setN(0); return; }
		const sb = supabase;
		const empId = empresa.id;
		let active = true;
		async function reload() {
			const { count } = await sb.from('chamados').select('id', { count: 'exact', head: true }).eq('empresa_id', empId).eq('situacao', 'aguardando_cliente');
			if (!active) return;
			setN(Number(count ?? 0));
		}
		void reload();
		const id = window.setInterval(reload, 60000);
		function onVisto() { void reload(); }
		window.addEventListener('mc:suporte-visto', onVisto);
		return () => { active = false; window.clearInterval(id); window.removeEventListener('mc:suporte-visto', onVisto); };
	}, [empresa?.id]);
	return n;
}

/** Dica escura à direita do botão (portal no body, z-[70]). */
function Dica({ texto, x, y }: { texto: string; x: number; y: number }) {
	if (typeof document === 'undefined') return null;
	return createPortal(
		<div style={{ position: 'fixed', left: x, top: y, zIndex: 70 }} className="pointer-events-none whitespace-nowrap rounded-lg bg-[#1D1D1F] px-2.5 py-1.5 text-[12.5px] text-white" >
			{texto}
		</div>,
		document.body,
	);
}

function RailButton({
	item, ativo, recolhido, onHover, onLeave,
}: {
	item: RailItem; ativo: boolean; recolhido: boolean;
	onHover: (texto: string, el: HTMLElement) => void; onLeave: () => void;
}) {
	const Icon = item.icon;
	const navigate = useNavigate();
	const { aplicarFrente } = useFrente();
	const areasLib = useAreasLiberadas();

	function clicar() {
		if (!item.contratada && !areasLib.semEmpresa) {
			// Navega para a rota; o app-shell mostra "área não contratada".
			navigate(item.to);
			return;
		}
		if (item.area === 'cobranca') aplicarFrente('motorcob');
		if (item.area === 'jornada') aplicarFrente('motorcli');
		navigate(item.to);
	}

	const opacidade = !item.contratada && !areasLib.semEmpresa ? 'opacity-45' : '';

	return (
		<button
			onClick={clicar}
			onMouseEnter={e => onHover(item.nome, e.currentTarget)}
			onMouseLeave={onLeave}
			onFocus={e => onHover(item.nome, e.currentTarget)}
			onBlur={onLeave}
			aria-label={item.nome}
			className={`relative flex items-center gap-2.5 rounded-[9px] transition-colors ${recolhido ? 'h-9 w-9 justify-center' : 'h-9 w-full px-2.5'} ${ativo ? 'font-semibold' : 'font-normal'} ${opacidade} hover:bg-[var(--base-fill)]`}
			style={ativo ? { backgroundColor: 'var(--base-fill)' } : undefined}
		>
			{ativo && (
				<span className="absolute left-0 top-1/2 h-5 w-[2px] -translate-y-1/2 rounded-r" style={{ backgroundColor: 'var(--base-texto)' }} />
			)}
			<Icon size={recolhido ? 18 : 18} strokeWidth={1.8} className="shrink-0" style={{ color: 'var(--base-texto-2)' }} />
			{!recolhido && <span className="truncate text-[13px]" style={{ color: ativo ? 'var(--base-texto)' : 'var(--base-texto-2)' }}>{item.nome}</span>}
		</button>
	);
}

export function LateralIcones() {
	const { perfil } = useMotorAuth();
	const loc = useLocation();
	const areasLib = useAreasLiberadas();
	const suporteN = useSuportePendentes();
	const isEquipe = !!perfil?.equipe;
	const [recolhido, setRecolhido] = useState(() => {
		if (typeof window === 'undefined') return true;
		try { return localStorage.getItem(LATERAL_KEY) !== '1'; } catch { return true; }
	});
	const [dica, setDica] = useState<{ texto: string; x: number; y: number } | null>(null);

	useEffect(() => {
		try { localStorage.setItem(LATERAL_KEY, recolhido ? '0' : '1'); } catch { /* ignore */ }
		window.dispatchEvent(new Event('mc-lateral-toggle'));
	}, [recolhido]);

	const areaAtual = areaDaRota(loc.pathname);

	function onHover(texto: string, el: HTMLElement) {
		if (!recolhido) return;
		const r = el.getBoundingClientRect();
		setDica({ texto, x: r.right + 8, y: r.top + r.height / 2 - 12 });
	}
	function onLeave() { setDica(null); }

	const items: RailItem[] = [
		{ area: 'cobranca', nome: 'Cobrança', icon: CircleDollarSign, to: '/fila', contratada: areasLib.cobranca },
		{ area: 'jornada', nome: 'Jornada do Cliente', icon: Route, to: '/jornada', contratada: areasLib.jornada },
		{ area: 'mensageria', nome: 'Mensageria', icon: MessagesSquare, to: `/mensageria/${areasLib.canalPadrao}`, contratada: areasLib.mensageria },
		{ area: 'relatorios', nome: 'Relatórios', icon: FileChartColumn, to: '/relatorios', contratada: true },
	];

	const largura = recolhido ? 44 : 192;

	return (
		<>
			<aside
				className="fixed inset-y-0 left-0 z-40 flex flex-col items-center py-2 lg:flex"
				style={{ width: largura, transition: 'width 200ms ease' }}
			>
				{/* Logo */}
				<Link to="/inicio" aria-label="Início" className="mb-2 grid h-9 w-9 shrink-0 place-items-center">
					<MotorCXMark className="h-7 w-7" />
				</Link>

				{/* Início */}
				<div className="w-full" style={{ paddingLeft: recolhido ? 0 : 4, paddingRight: recolhido ? 0 : 4 }}>
					<RailButton
						item={{ area: 'inicio', nome: 'Início', icon: House, to: '/inicio', contratada: true }}
						ativo={areaAtual === 'inicio'}
						recolhido={recolhido}
						onHover={onHover}
						onLeave={onLeave}
					/>
				</div>

				{/* Áreas */}
				<div className="mt-1 w-full space-y-0.5" style={{ paddingLeft: recolhido ? 0 : 4, paddingRight: recolhido ? 0 : 4 }}>
					{items.map(it => (
						<RailButton
							key={it.area}
							item={it}
							ativo={areaAtual === it.area}
							recolhido={recolhido}
							onHover={onHover}
							onLeave={onLeave}
						/>
					))}
				</div>

				{/* Espaço + Empresa */}
				<div className="mt-3 w-full" style={{ paddingLeft: recolhido ? 0 : 4, paddingRight: recolhido ? 0 : 4 }}>
					<RailButton
						item={{ area: 'empresa', nome: 'Empresa', icon: Building, to: '/empresa', contratada: true }}
						ativo={areaAtual === 'empresa'}
						recolhido={recolhido}
						onHover={onHover}
						onLeave={onLeave}
					/>
				</div>

				{/* Espaço + Suporte + Console */}
				<div className="mt-auto w-full space-y-0.5" style={{ paddingLeft: recolhido ? 0 : 4, paddingRight: recolhido ? 0 : 4 }}>
					<div className="relative">
						<RailButton
							item={{ area: 'suporte', nome: 'Suporte', icon: Headset, to: '/suporte', contratada: true }}
							ativo={areaAtual === 'suporte'}
							recolhido={recolhido}
							onHover={onHover}
							onLeave={onLeave}
						/>
						{suporteN > 0 && (
							<span className="pointer-events-none absolute right-1 top-1 grid h-[16px] min-w-[16px] place-items-center rounded-full bg-[#FF3B30] px-1 text-[9px] font-bold text-white tnum">{suporteN > 99 ? '99+' : suporteN}</span>
						)}
					</div>
					{isEquipe && (
						<RailButton
							item={{ area: 'console', nome: 'Console MotorCX', icon: ShieldCheck, to: '/console', contratada: true }}
							ativo={areaAtual === 'console'}
							recolhido={recolhido}
							onHover={onHover}
							onLeave={onLeave}
						/>
					)}
				</div>

				{/* Pé: toggle nomes + avatar */}
				<div className="mt-2 flex w-full flex-col items-center gap-1" style={{ paddingLeft: recolhido ? 0 : 4, paddingRight: recolhido ? 0 : 4 }}>
					<button
						onClick={() => setRecolhido(r => !r)}
						aria-label={recolhido ? 'Mostrar os nomes' : 'Esconder os nomes'}
						onMouseEnter={e => onHover(recolhido ? 'Mostrar os nomes' : 'Esconder os nomes', e.currentTarget)}
						onMouseLeave={onLeave}
						className={`flex items-center gap-2.5 rounded-[9px] py-1.5 text-[var(--base-texto-2)] hover:bg-[var(--base-fill)] ${recolhido ? 'h-9 w-9 justify-center' : 'h-9 w-full px-2.5'}`}
					>
						<ChevronsRight size={18} strokeWidth={1.8} className="shrink-0 transition-transform" style={{ transform: recolhido ? 'none' : 'rotate(180deg)' }} />
						{!recolhido && <span className="text-[13px]">Esconder</span>}
					</button>
					<div className={recolhido ? 'flex justify-center' : 'flex w-full justify-center'}>
						<AvatarMenu />
					</div>
				</div>
			</aside>

			{dica && <Dica texto={dica.texto} x={dica.x} y={dica.y} />}
		</>
	);
}

/** Largura atual da lateral (para o margin-left do conteúdo). */
export function useLarguraLateral(): number {
	const [recolhido, setRecolhido] = useState(() => {
		if (typeof window === 'undefined') return true;
		try { return localStorage.getItem(LATERAL_KEY) !== '1'; } catch { return true; }
	});
	useEffect(() => {
		function onStorage(e: StorageEvent) {
			if (e.key === LATERAL_KEY) {
				try { setRecolhido(localStorage.getItem(LATERAL_KEY) !== '1'); } catch { /* ignore */ }
			}
		}
		function onToggle() {
			try { setRecolhido(localStorage.getItem(LATERAL_KEY) !== '1'); } catch { /* ignore */ }
		}
		window.addEventListener('storage', onStorage);
		window.addEventListener('mc-lateral-toggle', onToggle);
		return () => { window.removeEventListener('storage', onStorage); window.removeEventListener('mc-lateral-toggle', onToggle); };
	}, []);
	const [desktop, setDesktop] = useState(() => typeof window !== 'undefined' ? window.innerWidth >= 1024 : true);
	useEffect(() => {
		function onResize() { setDesktop(window.innerWidth >= 1024); }
		window.addEventListener('resize', onResize);
		return () => window.removeEventListener('resize', onResize);
	}, []);
	if (!desktop) return 0;
	return recolhido ? 44 : 192;
}
