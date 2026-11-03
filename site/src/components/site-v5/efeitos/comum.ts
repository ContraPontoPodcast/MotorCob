/* Peças comuns das animações do site público v5 (portadas de assets/mx.js e home.js do protótipo aprovado).
   Cada animação é uma função iniciarX(raiz) que devolve a limpeza (cancela rAF, timers, observers e listeners),
   chamada num useEffect. */

export type Limpeza = () => void;

/* O nome da IA do MotorCX. Trocar aqui troca nos desenhos da home (o texto das páginas está no JSX). */
export const IA = 'MotorCX Intelligence';

export const ICO = {
	pausa: '<svg viewBox="0 0 14 14" fill="currentColor" aria-hidden="true"><rect x="2" y="1" width="3.5" height="12" rx="1"/><rect x="8.5" y="1" width="3.5" height="12" rx="1"/></svg>',
	play: '<svg viewBox="0 0 14 14" fill="currentColor" aria-hidden="true"><path d="M3 1.5v11l9-5.5z"/></svg>',
};

export const NS = 'http://www.w3.org/2000/svg';

/** prefers-reduced-motion, lido uma vez ao iniciar (como no protótipo). */
export function movimentoReduzido(): boolean {
	return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export type Pausa = { pausado: () => boolean; pausa?: () => void; limpa: Limpeza };

/** Botão de pausa comum: chama aoMudar(pausado). Com movimento reduzido, o botão some e tudo fica parado. */
export function botaoPausa(btn: HTMLButtonElement, rotulo: string, rm: boolean, aoMudar: (p: boolean) => void): Pausa {
	let p = false;
	const pinta = () => {
		btn.innerHTML = p ? ICO.play : ICO.pausa;
		btn.setAttribute('aria-label', (p ? 'Retomar ' : 'Pausar ') + rotulo);
		btn.setAttribute('aria-pressed', p ? 'true' : 'false');
	};
	if (rm) { btn.hidden = true; return { pausado: () => true, limpa: () => {} }; }
	const clique = () => { p = !p; pinta(); aoMudar(p); };
	btn.addEventListener('click', clique);
	pinta();
	return {
		pausado: () => p,
		pausa: () => { if (!p) { p = true; pinta(); aoMudar(p); } },
		limpa: () => btn.removeEventListener('click', clique),
	};
}

/** Avisa quando o elemento entra ou sai da tela. Devolve o desligamento. */
export function visivel(el: Element, fn: (v: boolean) => void, margem = '0px'): Limpeza {
	if (!('IntersectionObserver' in window)) { fn(true); return () => {}; }
	const io = new IntersectionObserver(es => fn(es[es.length - 1].isIntersecting), { rootMargin: margem });
	io.observe(el);
	return () => io.disconnect();
}

/** document.fonts.ready, sem chamar fn se a página já saiu. */
export function quandoFontes(fn: () => void): Limpeza {
	let vivo = true;
	if ('fonts' in document) document.fonts.ready.then(() => { if (vivo) fn(); });
	return () => { vivo = false; };
}
