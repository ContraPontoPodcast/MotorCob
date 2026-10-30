import {
	isRouteErrorResponse,
	Links,
	Meta,
	Outlet,
	Scripts,
	ScrollRestoration,
} from 'react-router';
import type { Route } from './+types/root';
import stylesheet from '@/index.css?url';
import { Toaster } from '@/components/ui/sonner';
import { AuthProvider } from '@/components/auth-provider';
import { FrenteProvider } from '@/components/frente-provider';
import { ConsolePermsProvider } from '@/components/workspace/console/console-perms';
import { TemaProvider, AreaTheme } from '@/components/tema-provider';
import { GlossarioProvider } from '@/components/glossario/glossario-provider';
import { useEffect } from 'react';
import { useLocation } from 'react-router';

function CanonicalDomain() {
	const location = useLocation();
	useEffect(() => {
		if (window.location.hostname === 'www.motorcob.online') {
			window.location.replace(`https://motorcob.online${location.pathname}${location.search}${location.hash}`);
		}
	}, [location]);
	return null;
}

/** Normaliza o título do navegador para a marca MotorCX (seo() é read-only).
 *  Centraliza o sufixo " · MotorCX" em todas as telas, evita duplicação e
 *  troca "MotorCob" por "MotorCX" mesmo quando a marca vem no início (home). */
function TitleMotorCX() {
	useEffect(() => {
		const TRAILING = /(\s*[|·]\s*(MotorCob|MotorCX))+\s*$/;
		function normalize() {
			const t = document.title;
			if (!t) return;
			let next: string;
			if (TRAILING.test(t)) {
				const stripped = t.replace(TRAILING, '').trim();
				next = stripped ? `${stripped} · MotorCX` : 'MotorCX';
			} else {
				next = t.replace(/MotorCob/g, 'MotorCX');
			}
			if (next !== t) document.title = next;
		}
		normalize();
		const obs = new MutationObserver(normalize);
		obs.observe(document.querySelector('title') ?? document.head, { childList: true, subtree: true, characterData: true });
		return () => obs.disconnect();
	}, []);
	return null;
}

export const links: Route.LinksFunction = () => [
	{ rel: 'stylesheet', href: stylesheet },
	{ rel: 'icon', href: '/favicon.svg', type: 'image/svg+xml' },
];

export function Layout({ children }: { children: React.ReactNode }) {
	return (
		<html lang="pt-BR">
			<head>
				<meta charSet="utf-8" />
				<meta name="viewport" content="width=device-width, initial-scale=1" />
				<Meta />
				<Links />
			</head>
			<body>
				<div id="root">{children}</div>
				<ScrollRestoration />
				<Scripts />
			</body>
		</html>
	);
}

export default function App() {
	return <AuthProvider><ConsolePermsProvider><FrenteProvider><TemaProvider><GlossarioProvider><CanonicalDomain/><TitleMotorCX/><AreaTheme/><Outlet /><Toaster /></GlossarioProvider></TemaProvider></FrenteProvider></ConsolePermsProvider></AuthProvider>;
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
	let message = 'Ops!';
	let details = 'Ocorreu um erro inesperado.';
	let stack: string | undefined;

	if (isRouteErrorResponse(error)) {
		message = error.status === 404 ? '404' : 'Erro';
		details =
			error.status === 404
				? 'A página solicitada não foi encontrada.'
				: error.statusText || details;
	} else if (import.meta.env.DEV && error && error instanceof Error) {
		details = error.message;
		stack = error.stack;
	}

	return (
		<main>
			<h1>{message}</h1>
			<p>{details}</p>
			{stack ? (
				<pre>
					<code>{stack}</code>
				</pre>
			) : null}
		</main>
	);
}
