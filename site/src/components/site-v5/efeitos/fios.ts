/* As seis funcionalidades da home: fios de luz de cada uma até a IA, no centro. */
import { botaoPausa, movimentoReduzido, NS, quandoFontes, visivel, type Limpeza } from './comum';

export function iniciarFios(sec: HTMLElement): Limpeza {
	const RM = movimentoReduzido();
	const palco = sec.querySelector<HTMLElement>('.func-palco')!, svg = sec.querySelector<SVGSVGElement>('.func-fios')!, nucleo = sec.querySelector<HTMLElement>('.nucleo-pt')!;
	const itens = Array.from(sec.querySelectorAll<HTMLElement>('.fn')), btn = sec.querySelector<HTMLButtonElement>('.pausa')!;
	/* Posição relativa ao palco, sem as translações das revelações (offset ignora transform). */
	function caixa(e0: HTMLElement) {
		let e: HTMLElement | null = e0, x = 0, y = 0;
		const w = e0.offsetWidth, h = e0.offsetHeight;
		while (e && e !== palco) { x += e.offsetLeft; y += e.offsetTop; e = e.offsetParent as HTMLElement | null; }
		return { left: x, top: y, width: w, height: h, right: x + w };
	}
	function desenha() {
		const pr = palco.getBoundingClientRect(), nr = caixa(nucleo);
		const cx = nr.left + nr.width / 2, cy = nr.top + nr.height / 2;
		const cel = window.matchMedia('(max-width: 900px)').matches;
		svg.setAttribute('viewBox', '0 0 ' + Math.round(pr.width) + ' ' + Math.round(pr.height));
		svg.innerHTML = '';
		itens.forEach((it, i) => {
			const ic = caixa(it.querySelector<HTMLElement>('.fn-ico')!);
			let d: string;
			if (cel) {
				/* celular: espinha à esquerda, no recuo da lista (à esquerda dos ícones), que sobe até a altura do
				   núcleo e entra nele pela lateral; um ramo curto para cada ícone. Assim o fio nunca cruza o texto. */
				const ey = ic.top + ic.height / 2, ex = ic.left - 6, sx = Math.max(8, ic.left / 2), nx = cx - nr.width * 0.3;
				d = 'M' + ex + ' ' + ey + ' L' + (sx + 12) + ' ' + ey + ' Q' + sx + ' ' + ey + ' ' + sx + ' ' + (ey - 12) + ' L' + sx + ' ' + (cy + 12) + ' Q' + sx + ' ' + cy + ' ' + (sx + 12) + ' ' + cy + ' L' + nx + ' ' + cy;
			} else {
				const esq = ic.left + ic.width / 2 < cx;
				const x0 = esq ? ic.right + 10 : ic.left - 10, y0 = ic.top + ic.height / 2;
				const x1 = cx + (esq ? -12 : 12), mx = (x0 + x1) / 2;
				d = 'M' + x0 + ' ' + y0 + ' C' + mx + ' ' + y0 + ' ' + mx + ' ' + cy + ' ' + x1 + ' ' + cy;
			}
			const base = document.createElementNS(NS, 'path'); base.setAttribute('d', d); base.setAttribute('class', 'fio'); svg.appendChild(base);
			const luz = document.createElementNS(NS, 'path'); luz.setAttribute('d', d); luz.setAttribute('class', 'fio-luz'); luz.setAttribute('pathLength', '100');
			luz.style.animationDelay = (-i * 0.53) + 's'; svg.appendChild(luz);
		});
	}
	let tmr = 0;
	const aoRedimensionar = () => { clearTimeout(tmr); tmr = window.setTimeout(desenha, 120); };
	window.addEventListener('resize', aoRedimensionar);
	const limpaFontes = quandoFontes(desenha);
	desenha();
	const ctl = botaoPausa(btn, 'os fios de luz', RM, p => { sec.classList.toggle('parado', p); });
	if (RM) sec.classList.add('parado');
	const desligaVis = visivel(sec, v => { sec.classList.toggle('fora', !v); }, '80px 0px');
	return () => {
		window.removeEventListener('resize', aoRedimensionar); clearTimeout(tmr); limpaFontes(); desligaVis(); ctl.limpa();
		svg.innerHTML = '';
	};
}
