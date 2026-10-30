import { useEffect, useState, type ReactNode } from 'react';
import { useLocation } from 'react-router';
import { supabase } from '@/lib/supabase';
import { areaTemaDeRota, type AreaTema } from '@/lib/area-rota';

const STYLE_ID = 'mc-tema-dinamico';

/** "base.menu" → "--base-menu"; "area.cobranca.ativo_texto" → "--area-cobranca-ativo-texto". */
function chaveToVar(chave: string): string {
	return '--' + String(chave).toLowerCase().replace(/\./g, '-');
}

type TokenRow = { chave: string; claro: string | null; escuro: string | null };

/** Escreve cada token como variável CSS em :root (claro) e [data-tema="escuro"] (escuro). */
function aplicarTokens(rows: TokenRow[]) {
	const light: string[] = [];
	const dark: string[] = [];
	for (const r of rows) {
		if (!r.chave) continue;
		const v = chaveToVar(r.chave);
		if (r.claro) light.push(`${v}: ${r.claro};`);
		if (r.escuro) dark.push(`${v}: ${r.escuro};`);
	}
	const css = `:root{${light.join('')}}[data-tema="escuro"]{${dark.join('')}}`;
	let el = document.getElementById(STYLE_ID) as HTMLStyleElement | null;
	if (!el) {
		el = document.createElement('style');
		el.id = STYLE_ID;
		document.head.appendChild(el);
	}
	el.textContent = css;
}

type TemaPref = 'claro' | 'escuro' | 'sistema';

/**
 * Lê a tabela tema_tokens (público, antes do login também) e o tema da pessoa
 * (rpc minha_ajuda → .tema). Se a leitura falhar, os valores de reserva do CSS valem.
 */
export function TemaProvider({ children }: { children: ReactNode }) {
	const [tema, setTema] = useState<TemaPref>('sistema');

	// 1. Tokens (público). Tenta ler a cada abertura; se falhar, mantém o CSS de reserva.
	useEffect(() => {
		const sb = supabase;
		if (!sb) return;
		let active = true;
		(async () => {
			try {
				const { data } = await sb.from('tema_tokens').select('chave,claro,escuro');
				if (!active || !data || !data.length) return;
				aplicarTokens(data as TokenRow[]);
			} catch { /* reserva do CSS */ }
		})();
		return () => { active = false; };
	}, []);

	// 2. Tema da pessoa (minha_ajuda). Sem sessão → sistema.
	useEffect(() => {
		const sb = supabase;
		if (!sb) return;
		let active = true;
		async function load() {
			const { data: s } = await sb!.auth.getSession();
			if (!s.session) { if (active) setTema('sistema'); return; }
			try {
				const { data } = await sb!.rpc('minha_ajuda');
				if (!active) return;
				const t = (data as { tema?: string } | null)?.tema;
				if (t === 'claro' || t === 'escuro' || t === 'sistema') setTema(t);
				else setTema('sistema');
			} catch {
				if (active) setTema('sistema');
			}
		}
		void load();
		const { data: listener } = sb!.auth.onAuthStateChange((event) => {
			if (event === 'SIGNED_IN' || event === 'INITIAL_SESSION') void load();
			if (event === 'SIGNED_OUT') setTema('sistema');
		});
		return () => { active = false; listener.subscription.unsubscribe(); };
	}, []);

	// 3. Aplica data-tema no <html>. "sistema" segue prefers-color-scheme.
	useEffect(() => {
		const html = document.documentElement;
		function apply(dark: boolean) {
			html.setAttribute('data-tema', dark ? 'escuro' : 'claro');
		}
		if (tema === 'sistema') {
			const mq = window.matchMedia('(prefers-color-scheme: dark)');
			apply(mq.matches);
			const handler = (e: MediaQueryListEvent) => apply(e.matches);
			mq.addEventListener('change', handler);
			return () => mq.removeEventListener('change', handler);
		}
		apply(tema === 'escuro');
	}, [tema]);

	return <>{children}</>;
}

type AreaId = AreaTema;

/** Determina a área ativa pela rota (delegado para area-rota.ts). */
function areaDaRota(pathname: string): AreaId {
	return areaTemaDeRota(pathname);
}

const AREA_LABEL: Record<AreaId, string> = {
	cobranca: 'Cobrança',
	jornada: 'Jornada do Cliente',
	mensageria: 'Mensageria',
	neutro: 'MotorCX',
};

/** Define as variáveis da área ativa (--area, --area-ativo, etc.) pela rota. */
export function AreaTheme() {
	const loc = useLocation();
	useEffect(() => {
		const area = areaDaRota(loc.pathname);
		const root = document.documentElement;
		root.style.setProperty('--area', `var(--area-${area})`);
		root.style.setProperty('--area-ativo', `var(--area-${area}-ativo)`);
		root.style.setProperty('--area-ativo-texto', `var(--area-${area}-ativo-texto)`);
		root.style.setProperty('--area-forte', `var(--area-${area}-forte)`);
		root.setAttribute('data-area', area);
	}, [loc.pathname]);
	return null;
}

export function useAreaLabel(): string {
	const loc = useLocation();
	return AREA_LABEL[areaDaRota(loc.pathname)];
}
