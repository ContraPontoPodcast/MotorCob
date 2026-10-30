import type { Route } from './+types/app-not-found';
import { Link, useLocation, useNavigate } from 'react-router';
import { seo } from '@/lib/seo';

export function meta({ matches, location }: Route.MetaArgs) {
	return seo({ matches, location }, { title: '404 · Página não encontrada | MotorCX', description: 'A página não existe ou mudou de endereço.', noindex: true });
}

export default function AppNotFound() {
	const loc = useLocation();
	const navigate = useNavigate();
	const rota = loc.pathname + loc.search;
	return (
		<div className="mx-auto max-w-[560px] px-4 py-16 text-center">
			<p className="text-[64px] font-bold leading-none tracking-tight text-[#1D1D1F] tnum">404</p>
			<h1 className="mt-4 text-[20px] font-semibold text-[#1D1D1F]">Esta página não existe ou mudou de endereço.</h1>
			<p className="mt-2 break-all text-[14px] text-[#8E8E93]">Endereço: {rota}</p>
			<div className="mt-6 flex flex-wrap items-center justify-center gap-3">
				<Link to="/inicio" className="inline-flex h-10 items-center rounded-lg bg-[#1D1D1F] px-6 text-[14px] font-semibold text-white hover:opacity-85">Ir para o Início</Link>
				<button onClick={() => window.history.back()} className="inline-flex h-10 items-center rounded-lg border border-[#D2D2D7] px-6 text-[14px] font-medium text-[#1D1D1F] hover:bg-[#F5F5F7]">Voltar</button>
			</div>
			<Link to={`/suporte/novo?assunto=Link quebrado: ${encodeURIComponent(rota)}`} className="mt-4 inline-block text-[13px] font-medium text-[#0A60D0] hover:underline">Avisar o Suporte</Link>
		</div>
	);
}
