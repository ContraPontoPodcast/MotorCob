import { Link } from 'react-router';

export function SiteFooter() {
	return (
		<footer className="bg-[#F5F5F7] px-5 py-10 text-[12px] text-[#6E6E73]">
			<div className="mx-auto flex max-w-[1120px] flex-wrap items-center justify-between gap-3">
				<span>© {new Date().getFullYear()} MotorCX</span>
				<nav className="flex flex-wrap items-center gap-5">
					<Link to="/login" className="hover:text-[#1D1D1F]">Entrar</Link>
					<a href="#contato" className="hover:text-[#1D1D1F]">Contato</a>
					<Link to="/privacidade" className="hover:text-[#1D1D1F]">Privacidade</Link>
					<Link to="/email/sair" className="hover:text-[#1D1D1F]">Não quero mais estes e-mails</Link>
				</nav>
			</div>
		</footer>
	);
}
