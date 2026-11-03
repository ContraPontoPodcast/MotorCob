/* O ciclo da IA na home: uma engrenagem de luz com os quatro verbos. O cometa corre o aro, para em cada verbo,
   e de Aprende volta para Entende (a retroalimentação). Clicar num verbo mostra o verbo e pausa. */
import { botaoPausa, movimentoReduzido, NS, visivel, type Limpeza } from './comum';

export function iniciarCiclo(sec: HTMLElement): Limpeza {
	const RM = movimentoReduzido();
	const svg = sec.querySelector<SVGSVGElement>('.ciclo-svg')!, vs = Array.from(sec.querySelectorAll<HTMLButtonElement>('.v'));
	const nEl = sec.querySelector<HTMLElement>('.cc-n')!, vEl = sec.querySelector<HTMLElement>('.cc-v')!;
	const dEls = Array.from(sec.querySelectorAll<HTMLElement>('.cc-d')), centro = sec.querySelector<HTMLElement>('.ciclo-centro')!;
	const volta = sec.querySelector<SVGTextElement>('.volta');
	const btn = sec.querySelector<HTMLButtonElement>('.pausa')!;
	const C = 300, R = 220, TAU = Math.PI * 2;
	const criados: Element[] = [];
	const el = (n: string, a: Record<string, string | number>, pai?: Element) => {
		const e = document.createElementNS(NS, n);
		for (const k in a) e.setAttribute(k, String(a[k]));
		if (pai) pai.appendChild(e);
		if (pai === svg) criados.push(e);
		return e;
	};
	/* Engrenagem pontilhada (dentes) que gira devagar. */
	const roda = el('g', {}, svg), N = 56, ra = R + 13, rd = R - 7;
	for (let i = 0; i < N; i++) {
		const a = i * TAU / N, p = TAU / N;
		[[rd, -0.5], [rd, -0.25], [ra, -0.12], [ra, 0.12], [rd, 0.25]].forEach(q => {
			el('circle', { cx: (C + q[0] * Math.cos(a + q[1] * p)).toFixed(1), cy: (C + q[0] * Math.sin(a + q[1] * p)).toFixed(1), r: 1.25, fill: 'rgba(255,255,255,.26)' }, roda);
		});
	}
	/* Arcos internos, como nas engrenagens de luz. */
	const arcos = el('g', { fill: 'none', 'stroke-linecap': 'round' }, svg);
	[R * 0.66].forEach((r0, j) => {
		for (let s = 0; s < 4; s++) {
			const a0 = s * TAU / 4 + 0.2, a1 = a0 + TAU / 4 - 0.4;
			el('path', { d: 'M' + (C + r0 * Math.cos(a0)).toFixed(1) + ' ' + (C + r0 * Math.sin(a0)).toFixed(1) + ' A' + r0 + ' ' + r0 + ' 0 0 1 ' + (C + r0 * Math.cos(a1)).toFixed(1) + ' ' + (C + r0 * Math.sin(a1)).toFixed(1), stroke: j ? 'rgba(255,255,255,.07)' : 'rgba(255,255,255,.1)', 'stroke-width': j ? 1.5 : 2, 'data-j': j }, arcos);
		}
	});
	/* Aro de passo, rastro do cometa e os quatro nós. */
	el('circle', { cx: C, cy: C, r: R, fill: 'none', stroke: 'rgba(201,163,90,.18)', 'stroke-width': 1 }, svg);
	const rastro = el('g', {}, svg), RASTRO = 22, gotas: Element[] = [];
	for (let g = 0; g < RASTRO; g++) gotas.push(el('circle', { r: 1, fill: '#C9A35A' }, rastro));
	const ANG = [-90, 0, 90, 180].map(d => d * Math.PI / 180);
	const nos = ANG.map(a => el('circle', { cx: C + R * Math.cos(a), cy: C + R * Math.sin(a), r: 4, fill: '#48484A' }, svg));
	const cabeca = el('circle', { r: 7, fill: '#FFF8E8', filter: 'url(#ia-brilho)' }, svg);

	const DWELL = 2.5, VIAGEM = 1.05, SEG = DWELL + VIAGEM, T = SEG * 4;
	let t = 0, ativo = -1, raf = 0, ult = 0, vis = false;
	const suave = (u: number) => u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2;
	function anguloEm(tt: number) {
		tt = ((tt % T) + T) % T;
		const i = Math.floor(tt / SEG), u = tt - i * SEG;
		const f = u < DWELL ? 0 : suave((u - DWELL) / VIAGEM);
		return { a: ANG[i] + f * TAU / 4, i, viajando: u >= DWELL };
	}
	function mostra(i: number) {
		if (i === ativo) return;
		ativo = i;
		sec.setAttribute('data-verbo', String(i));
		vs.forEach((v, j) => { v.classList.toggle('on', j === i); v.setAttribute('aria-pressed', j === i ? 'true' : 'false'); });
		nos.forEach((n, j) => { n.setAttribute('r', j === i ? '7' : '4'); n.setAttribute('fill', j === i ? '#F1DDB0' : '#48484A'); });
		const fonte = vs[i];
		centro.classList.remove('entra'); void centro.offsetWidth; centro.classList.add('entra');
		nEl.textContent = '0' + (i + 1) + ' / 04';
		vEl.textContent = fonte.querySelector('b')!.textContent;
		dEls.forEach(d => { d.textContent = fonte.getAttribute('data-d'); });
	}
	function quadro(dt: number) {
		t += dt;
		const s = anguloEm(t);
		roda.setAttribute('transform', 'rotate(' + (t * 4).toFixed(2) + ' ' + C + ' ' + C + ')');
		Array.from(arcos.children).forEach(p => { const j = +p.getAttribute('data-j')!; p.setAttribute('transform', 'rotate(' + (t * (j ? -9 : 6)).toFixed(2) + ' ' + C + ' ' + C + ')'); });
		const hx = C + R * Math.cos(s.a), hy = C + R * Math.sin(s.a);
		cabeca.setAttribute('cx', hx.toFixed(1)); cabeca.setAttribute('cy', hy.toFixed(1));
		/* rastro: um arco de luz que segue a cabeça (mais longo em viagem) */
		const comp = s.viajando ? 1.1 : 0.55;
		gotas.forEach((gt, j) => {
			const f = j / RASTRO, aa = s.a - f * comp;
			gt.setAttribute('cx', (C + R * Math.cos(aa)).toFixed(1)); gt.setAttribute('cy', (C + R * Math.sin(aa)).toFixed(1));
			gt.setAttribute('r', (3.6 * (1 - f) + 0.7).toFixed(2)); gt.setAttribute('fill-opacity', ((1 - f) * (1 - f)).toFixed(3));
		});
		mostra(s.i);   // o verbo da vez é o último nó alcançado
		if (volta) volta.classList.toggle('on', s.i === 3);
	}
	function laco(ts: number) { raf = 0; if (!vis || ctl.pausado()) return; const dt = Math.min(0.05, (ts - ult) / 1000); ult = ts; quadro(dt); raf = requestAnimationFrame(laco); }
	function liga() { if (!raf && vis && !ctl.pausado()) { ult = performance.now(); raf = requestAnimationFrame(laco); } }
	function desliga() { if (raf) cancelAnimationFrame(raf); raf = 0; }
	const ctl = botaoPausa(btn, 'o ciclo da IA', RM, p => { if (p) desliga(); else liga(); });
	/* Clicar num verbo: leva o cometa até ele e pausa. */
	const cliques = vs.map((v, i) => {
		const fn = () => { t = i * SEG + 0.01; quadro(0); if (ctl.pausa) ctl.pausa(); else mostra(i); };
		v.addEventListener('click', fn);
		return () => v.removeEventListener('click', fn);
	});
	quadro(0);
	const limpaBase = () => { desliga(); ctl.limpa(); cliques.forEach(f => f()); criados.forEach(e => e.remove()); };
	if (RM) { sec.classList.add('estatico'); if (volta) volta.classList.add('on'); return limpaBase; }
	const desligaVis = visivel(sec, v => { vis = v; if (v) liga(); else desliga(); }, '60px 0px');
	return () => { desligaVis(); limpaBase(); };
}
