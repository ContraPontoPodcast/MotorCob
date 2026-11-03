/* Casca do site público v5 (home, Como decide, soluções, Segurança e Demonstração): topo, menu do celular,
   rodapé, revelação na rolagem e os links internos. Portado de assets/mx.js do protótipo aprovado.
   O CSS fica todo escopado em .mxv5 (site-v5.css) e as fontes (fontes.css) só carregam nestas páginas. */
import { useEffect, useLayoutEffect, useRef, useState, type MouseEvent, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router';
import './fontes.css';
import './site-v5.css';
import { iniciarRecomendacoes, iniciarRevelacao } from './efeitos/revelar';

export type PaginaPublica = 'home' | 'como-decide' | 'cobranca' | 'voz' | 'speech' | 'seguranca' | 'demonstracao';

/** As rotas públicas do site (o app usa outras: /speech-analytics, /jornada...). */
export const ROTAS = {
	home: '/',
	comoDecide: '/como-decide',
	cobranca: '/solucoes/cobranca',
	voz: '/solucoes/voz',
	speech: '/solucoes/speech-analytics',
	seguranca: '/seguranca',
	demonstracao: '/demonstracao',
	/* O sistema (login e app) fica em motorcob.online; o site público vai para motorcx.com.br. URL absoluta de propósito. */
	login: 'https://motorcob.online/login',
	privacidade: '/privacidade',
} as const;

const LINKS: [PaginaPublica, string, string][] = [
	['como-decide', ROTAS.comoDecide, 'Como decide'],
	['cobranca', ROTAS.cobranca, 'Cobrança'],
	['voz', ROTAS.voz, 'Voz'],
	['speech', ROTAS.speech, 'Speech Analytics'],
	['seguranca', ROTAS.seguranca, 'Segurança'],
];

function Simbolo() {
	return (
		<svg viewBox="0 0 100 100" fill="none" aria-hidden="true">
			<circle cx="50" cy="50" r="38" stroke="currentColor" strokeOpacity=".35" strokeWidth="11" />
			<path d="M50 12 A38 38 0 0 1 86.1 38.3" stroke="#C9A35A" strokeWidth="11" strokeLinecap="round" />
			<path d="M83.6 70 A38 38 0 0 1 30 82.3" stroke="#8E8E93" strokeWidth="11" strokeLinecap="round" />
			<circle cx="50" cy="50" r="11" fill="#C9A35A" />
		</svg>
	);
}

function Topo({ pagina }: { pagina: PaginaPublica }) {
	const [aberta, setAberta] = useState(false);
	const btn = useRef<HTMLButtonElement>(null);
	const demo = `${ROTAS.demonstracao}?de=${pagina}`;
	useEffect(() => {
		document.documentElement.style.overflow = aberta ? 'hidden' : '';
		if (!aberta) return;
		const tecla = (e: KeyboardEvent) => { if (e.key === 'Escape') { setAberta(false); btn.current?.focus(); } };
		document.addEventListener('keydown', tecla);
		return () => { document.removeEventListener('keydown', tecla); document.documentElement.style.overflow = ''; };
	}, [aberta]);
	return (
		<>
			<header className="topo">
				<a className="marca" href={ROTAS.home} aria-label="MotorCX, início"><Simbolo />MotorCX</a>
				<nav aria-label="Principal">
					{LINKS.map(([id, href, nome]) => <a key={id} href={href} aria-current={id === pagina ? 'page' : undefined}>{nome}</a>)}
				</nav>
				<div className="dir">
					<a className="entrar" href={ROTAS.login}>Entrar</a>
					{pagina === 'demonstracao' ? null : <a className="btn cta" href={demo}>Agendar demonstração</a>}
					<button ref={btn} className="menu-btn" type="button" aria-label={aberta ? 'Fechar menu' : 'Abrir menu'} aria-expanded={aberta} aria-controls="menu-celular" onClick={() => setAberta(v => !v)}><span></span><span></span></button>
				</div>
			</header>
			<div className={aberta ? 'folha aberta' : 'folha'} id="menu-celular" onClick={e => { if ((e.target as Element).closest('a')) setAberta(false); }}>
				<a href={ROTAS.home}>Início</a>
				{LINKS.map(([id, href, nome]) => <a key={id} href={href}>{nome}</a>)}
				<a className="sec" href={ROTAS.login}>Entrar</a>
				<a className="btn" href={demo}>Agendar demonstração</a>
			</div>
		</>
	);
}

function Rodape() {
	return (
		<footer className="rodape">
			<div className="cols">
				<div><span className="marca"><Simbolo />MotorCX</span><p style={{ margin: '12px 0 0', maxWidth: '280px' }}>Um motor, muitas engrenagens e a MotorCX Intelligence, que faz tudo girar. Para assessorias e credores.</p></div>
				<div><h6>O motor</h6><a href={ROTAS.comoDecide}>Como decide</a><a href={ROTAS.cobranca}>Cobrança · MotorCob</a><a href={ROTAS.voz}>Voz</a><a href={ROTAS.speech}>Speech Analytics</a><span className="breve">Jornada · MotorCli · em breve</span></div>
				<div><h6>Empresa</h6><a href={ROTAS.seguranca}>Segurança</a><a href={ROTAS.privacidade}>Privacidade</a><a href={`${ROTAS.demonstracao}?de=rodape`}>Agendar demonstração</a></div>
				<div><h6>Acesso</h6><a href={ROTAS.login}>Entrar</a></div>
			</div>
			<div className="base"><span>© 2026 MotorCX. Ilustrações com dados fictícios.</span><span>E-mail comercial: <a href="mailto:contato@motorcx.com.br">contato@motorcx.com.br</a></span></div>
		</footer>
	);
}

export function SitePublico({ pagina, children }: { pagina: PaginaPublica; children: ReactNode }) {
	const raiz = useRef<HTMLDivElement>(null);
	const navigate = useNavigate();
	const { pathname } = useLocation();

	/* Ao trocar de página, a rolagem até o topo (ou até a âncora) é instantânea, como numa página nova: o
	   scroll-behavior: smooth do site só vale para as âncoras dentro da mesma página. Roda antes do
	   ScrollRestoration (efeito de layout do filho vem antes do pai). */
	useLayoutEffect(() => {
		const html = document.documentElement;
		html.style.scrollBehavior = 'auto';
		const raf = requestAnimationFrame(() => { html.style.scrollBehavior = ''; });
		return () => { cancelAnimationFrame(raf); html.style.scrollBehavior = ''; };
	}, [pathname]);

	useEffect(() => {
		const el = raiz.current;
		if (!el) return;
		const limpa = [iniciarRevelacao(el), iniciarRecomendacoes(el)];
		return () => limpa.forEach(f => f());
	}, [pathname]);

	/* Links internos (inclusive os que as animações criam): navegação do React Router, sem recarregar. */
	function aoClicar(e: MouseEvent<HTMLDivElement>) {
		if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
		const a = (e.target as Element).closest('a');
		if (!a || (a.target && a.target !== '_self') || a.hasAttribute('download')) return;
		const href = a.getAttribute('href');
		if (!href || !href.startsWith('/') || href.startsWith('//')) return;
		e.preventDefault();
		navigate(href);
	}

	return (
		// O clique só delega a navegação dos <a> internos; teclado e leitores de tela usam os próprios links.
		// oxlint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions
		<div className="mxv5" data-pagina={pagina} data-titulo-fixo="" ref={raiz} onClick={aoClicar}>
			<a className="pular" href="#conteudo">Pular para o conteúdo</a>
			<Topo pagina={pagina} />
			<main id="conteudo">{children}</main>
			<Rodape />
		</div>
	);
}
