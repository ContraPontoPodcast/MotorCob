import { type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router';

const TABS = [
	{ id: 'dados', label: 'Dados' },
	{ id: 'seguranca', label: 'Segurança' },
	{ id: 'notificacoes', label: 'Notificações' },
	{ id: 'preferencias', label: 'Preferências' },
	{ id: 'perfil', label: 'Meu perfil' },
];

export function ContaShell({ children }: { children: ReactNode }) {
	const [params] = useSearchParams();
	const aba = params.get('aba') || 'dados';
	return (
		<div className="mx-auto max-w-[760px] px-4 py-8">
			<h1 className="mb-5 text-[26px] font-bold tracking-tight text-[#1D1D1F]">Minha conta</h1>
			{/* Seletor no celular */}
			<div className="mb-4 sm:hidden">
				<select
					value={aba}
					onChange={e => { window.location.href = `/conta?aba=${e.target.value}`; }}
					className="h-10 w-full rounded-lg border border-[#D2D2D7] bg-white px-3 text-[15px] outline-none focus:border-[#1D1D1F]"
				>
					{TABS.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
				</select>
			</div>
			{/* Abas (desktop) */}
			<div className="no-scrollbar mb-6 hidden items-center gap-1 overflow-x-auto rounded-[12px] bg-[#F5F5F7] p-1 sm:flex">
				{TABS.map(t => (
					<Link
						key={t.id}
						to={`/conta?aba=${t.id}`}
						className={`shrink-0 rounded-[9px] px-3 py-1.5 text-[15px] font-medium transition-colors ${aba === t.id ? 'bg-white text-[#1D1D1F] font-semibold shadow-[0_1px_3px_rgba(0,0,0,0.12)]' : 'text-[#1D1D1F] hover:bg-[#E8E8ED]'}`}
					>
						{t.label}
					</Link>
				))}
			</div>
			{children}
		</div>
	);
}

export const cardShadow = '0 0 0 1px #E5E5EA, 0 2px 12px rgba(0,0,0,.04)';
