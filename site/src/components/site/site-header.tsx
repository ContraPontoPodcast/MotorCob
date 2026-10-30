import { Link } from 'react-router';
import { Logo } from './logo';
import { useMotorAuth } from '@/components/auth-provider';

const links = [
	{ href: '#plataforma', label: 'Plataforma' },
	{ href: '#orquestracao-site', label: 'Orquestração' },
	{ href: '#mensageria-site', label: 'Mensageria' },
	{ href: '#personas-site', label: 'Personas' },
	{ href: '#workspace-site', label: 'Workspace' },
	{ href: '#seguranca', label: 'Segurança' },
	{ href: '#contato', label: 'Contato' },
];

export function SiteHeader() {
	const { session } = useMotorAuth();
	return (
		<header
			className="fixed inset-x-0 top-0 z-50"
			style={{ backgroundColor: 'rgba(22,22,23,.88)', backdropFilter: 'saturate(180%) blur(20px)', WebkitBackdropFilter: 'saturate(180%) blur(20px)' }}
		>
			<div className="mx-auto flex h-[52px] max-w-[1120px] items-center justify-between px-5">
				<a href="#top" aria-label="MotorCX — início"><Logo tone="onDark" markClass="h-7 w-7" /></a>
				<nav className="hidden items-center gap-7 md:flex">
					{links.map(l => (
						<a key={l.href} href={l.href} className="text-[13px] text-white/80 transition-colors hover:text-white">{l.label}</a>
					))}
				</nav>
				{session ? (
					<Link to="/inicio" className="rounded-full px-4 py-1.5 text-[13px] font-medium text-white transition-colors hover:bg-white/25" style={{ backgroundColor: 'rgba(255,255,255,.14)' }}>Ir para a plataforma</Link>
				) : (
					<Link to="/login" className="rounded-full px-4 py-1.5 text-[13px] font-medium text-white transition-colors hover:bg-white/25" style={{ backgroundColor: 'rgba(255,255,255,.14)' }}>Entrar</Link>
				)}
			</div>
			<div className="flex gap-5 overflow-x-auto px-5 pb-2 md:hidden" style={{ scrollbarWidth: 'none' }}>
				{links.map(l => (
					<a key={l.href} href={l.href} className="whitespace-nowrap text-[13px] text-white/80">{l.label}</a>
				))}
			</div>
		</header>
	);
}
