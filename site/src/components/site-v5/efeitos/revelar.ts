/* Interações comuns a todas as páginas (assets/mx.js e o script inline da home no protótipo):
   - revelação ao entrar na tela (.rv → .visto);
   - frases da dor da home, que acendem ao passar do meio da tela;
   - cartão de recomendação → rascunho (nada muda sozinho). */
import { movimentoReduzido, type Limpeza } from './comum';

export function iniciarRevelacao(raiz: HTMLElement): Limpeza {
	const rvs = Array.from(raiz.querySelectorAll<HTMLElement>('.rv'));
	if (movimentoReduzido() || !('IntersectionObserver' in window)) { rvs.forEach(el => el.classList.add('visto')); return () => {}; }
	const io = new IntersectionObserver(es => {
		es.forEach(e => { if (e.isIntersecting) { e.target.classList.add('visto'); io.unobserve(e.target); } });
	}, { threshold: 0.12 });
	rvs.forEach(el => io.observe(el));
	return () => io.disconnect();
}

export function iniciarFrasesDor(raiz: HTMLElement): Limpeza {
	if (movimentoReduzido() || !('IntersectionObserver' in window)) return () => {};
	const ios = Array.from(raiz.querySelectorAll<HTMLElement>('.dor .frase')).map(f => {
		const io = new IntersectionObserver(es => { f.classList.toggle('acesa', es[es.length - 1].isIntersecting); }, { rootMargin: '0px 0px -42% 0px' });
		io.observe(f);
		return io;
	});
	return () => ios.forEach(io => io.disconnect());
}

export function iniciarRecomendacoes(raiz: HTMLElement): Limpeza {
	const limpezas = Array.from(raiz.querySelectorAll<HTMLElement>('[data-rec]')).map(r => {
		const b = r.querySelector('button');
		if (!b) return () => {};
		const fn = () => { r.classList.add('aplicado'); b.textContent = 'Aplicado'; r.querySelector('.estado')?.setAttribute('aria-live', 'polite'); };
		b.addEventListener('click', fn);
		return () => b.removeEventListener('click', fn);
	});
	return () => limpezas.forEach(f => f());
}
