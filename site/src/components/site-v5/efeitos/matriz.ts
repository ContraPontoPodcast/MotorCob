/* "A carteira se organiza sozinha" (home). Canvas 2D, conduzido pela rolagem, em cinco tempos:
   0 Sua carteira (nuvem) → 1 Quem é (perfis) → 2 Quem paga (A–C para cima, D–E para baixo)
   → 3 Por onde responde (canal e maturidade) → 4 A Matriz (Acelerar, Descobrir rápido, Manter barato, Economizar).
   Regras do produto: alta = faixas A a C, baixa = D e E; abordagem definida × aprendendo (Coletando ou Prévia).
   Tudo fictício. Laço de desenho só com a cena visível; botão de pausa para o giro da nuvem;
   prefers-reduced-motion mostra só o quadro final. */
import { ICO, movimentoReduzido, quandoFontes, type Limpeza } from './comum';

type Perfil = { n: [string, string]; canal: string | null; mat: string; def: boolean; q: number; share: number; f: number[]; alta?: boolean; mq?: { x: number; y: number } };
type Ponto = { k: number; b: number; d: number; ang: number; rad: number; nx: number; ny: number; w: number; r0: number };
type Quadro = { sx: number; sy: number; sw: number; sh: number; cx: number; cy: number; dot: number; m: { x: number; y: number; w: number; h: number; qw: number; qh: number } };

export function iniciarMatriz(sec: HTMLElement): Limpeza {
	const RM = movimentoReduzido();
	const cv = sec.querySelector('canvas')!, ctx = cv.getContext('2d')!;
	const trilho = sec.querySelector<HTMLElement>('.mz-trilho')!, txt = sec.querySelector<HTMLElement>('.mz-txt')!;
	const beats = Array.from(sec.querySelectorAll<HTMLElement>('.mz-beat')), marcas = Array.from(sec.querySelectorAll<HTMLElement>('.mz-prog li'));
	const btn = sec.querySelector<HTMLButtonElement>('.pausa');
	const FONTE = 'Geist, "Helvetica Neue", Arial, sans-serif', MONO = '"Geist Mono", Menlo, monospace';

	/* Perfis aprendidos pelo motor: duas características da carga cada (fictícios). */
	const P: Perfil[] = [
		{ n: ['Atraso curto', 'com WhatsApp'], canal: 'WhatsApp', mat: 'definida', def: true, q: 0, share: 0.30, f: [0.34, 0.30, 0.18, 0.12, 0.06] },
		{ n: ['Saldo alto', 'atraso curto'], canal: 'Agente de voz', mat: 'prévia', def: false, q: 1, share: 0.20, f: [0.22, 0.26, 0.22, 0.18, 0.12] },
		{ n: ['Saldo baixo', 'atraso longo'], canal: 'SMS', mat: 'definida', def: true, q: 2, share: 0.28, f: [0.06, 0.10, 0.18, 0.32, 0.34] },
		{ n: ['Atraso longo', 'sem WhatsApp'], canal: null, mat: 'coletando', def: false, q: 3, share: 0.22, f: [0.04, 0.08, 0.16, 0.30, 0.42] },
	];
	P.forEach(p => { p.alta = (p.f[0] + p.f[1] + p.f[2]) >= (p.f[3] + p.f[4]); });
	/* Quadrantes como no produto: linha de cima = alta; coluna da direita = definida. */
	const Q = [
		{ nome: 'Descobrir rápido', sub: 'alta chance · aprendendo', alta: true, def: false },
		{ nome: 'Acelerar', sub: 'alta chance · definida', alta: true, def: true },
		{ nome: 'Economizar', sub: 'baixa chance · aprendendo', alta: false, def: false },
		{ nome: 'Manter barato', sub: 'baixa chance · definida', alta: false, def: true },
	];
	const quadDe = (p: Perfil) => { for (let i = 0; i < 4; i++) if (Q[i].alta === p.alta && Q[i].def === p.def) return i; return 0; };
	const COR = ['#FFE8B0', '#F0C66E', '#D9A443', '#8E8E93', '#636366'];   // A → E (alta em ouro vivo, baixa em cinza legível)
	const CINZA = '#A1A1A6';

	/* Pseudoaleatório com semente: a carteira é sempre a mesma. */
	let semente = 7;
	const rnd = () => { semente = (semente * 16807) % 2147483647; return (semente - 1) / 2147483646; };

	let W = 0, H = 0, DPR = 1, desk = true, N = 0, st: Quadro | null = null;
	let pts: Ponto[] | null = null;   // por ponto: k, b, d (atraso), ang, rad, nx, ny
	let S: [Float32Array, Float32Array][] = [];   // alvos por estado: [x[], y[]]
	let X = new Float32Array(0), Y = new Float32Array(0);
	let rotulos: { colX: (k: number) => number; y1: number; y2: number; base: number; g: number; cols: number } | null = null;

	function gerar(n: number) {
		semente = 7; N = n; pts = [];
		P.forEach((p, k) => {
			const m = Math.round(p.share * n);
			for (let j = 0; j < m; j++) {
				const u = rnd(); let acc = 0, b = 0;
				for (b = 0; b < 5; b++) { acc += p.f[b]; if (u <= acc) break; }
				if (b > 4) b = 4;
				pts!.push({ k, b, d: rnd() * 0.42, ang: rnd() * Math.PI * 2, rad: Math.sqrt(rnd()), nx: rnd() * 2 - 1, ny: rnd() * 2 - 1, w: 0.6 + rnd() * 0.8, r0: 0 });
			}
		});
		N = pts.length;
	}

	function sunflower(cx: number, cy: number, c: number, ordem: number[], XX: Float32Array, YY: Float32Array) {
		ordem.forEach((i, m) => { const r = c * Math.sqrt(m + 0.5), t = m * 2.399963; XX[i] = cx + r * Math.cos(t); YY[i] = cy + r * Math.sin(t); });
	}

	function layout() {
		const r = cv.getBoundingClientRect();
		W = r.width; H = r.height; DPR = Math.min(2, window.devicePixelRatio || 1);
		cv.width = Math.round(W * DPR); cv.height = Math.round(H * DPR);
		const novoDesk = W >= 900;
		if (!pts || novoDesk !== desk) { desk = novoDesk; gerar(desk ? 2400 : 1300); }
		desk = novoDesk;
		const ps = pts!;
		const gut = Math.max(16, W * 0.05);
		let sx: number, sy: number, sw: number, sh: number;
		if (desk) { sx = W * 0.43; sw = W - gut - sx; sy = 52 + 48; sh = H - sy - 64; }
		else {
			let tb = 0; beats.forEach(b => { tb = Math.max(tb, b.getBoundingClientRect().height); });
			const top = txt.getBoundingClientRect().top - sec.querySelector('.mz-fixo')!.getBoundingClientRect().top;
			sy = top + tb + 64; sx = gut; sw = W - 2 * gut; sh = H - sy - 48;
		}
		const q: Quadro = { sx, sy, sw, sh, cx: sx + sw / 2, cy: sy + sh / 2, dot: desk ? 1.75 : 1.35, m: { x: 0, y: 0, w: 0, h: 0, qw: 0, qh: 0 } };
		st = q;

		const porK: number[][] = [[], [], [], []]; ps.forEach((p, i) => { porK[p.k].push(i); });
		S = []; for (let s = 0; s < 5; s++) S.push([new Float32Array(N), new Float32Array(N)]);

		/* 0 · nuvem (posição de base; o giro é aplicado no desenho) */
		const R0 = Math.min(sw, sh) * 0.42;
		ps.forEach((p, i) => { p.r0 = R0 * Math.pow(p.rad, 0.85); S[0][0][i] = q.cx + p.r0 * Math.cos(p.ang); S[0][1][i] = q.cy + p.r0 * 0.78 * Math.sin(p.ang); });

		/* 1 · perfis: quatro aglomerados lado a lado */
		const colX = (k: number) => sx + sw * (k + 0.5) / 4;
		const nMax = Math.max(...porK.map(a => a.length));
		const c1 = Math.min(sw / 8 * 0.86, sh * 0.26) / Math.sqrt(nMax);
		porK.forEach((ids, k) => { sunflower(colX(k), sy + sh * 0.44, c1, ids, S[1][0], S[1][1]); });

		/* 2 · quem paga: A–C sobe da linha de base, D–E desce */
		const cols = desk ? 20 : 12, colW = sw / 4 * (desk ? 0.62 : 0.74);
		let upMax = 0, dnMax = 0;
		const ups: number[][] = [], dns: number[][] = [];
		porK.forEach((ids, k) => {
			const up = ids.filter(i => ps[i].b <= 2).sort((a, b) => ps[b].b - ps[a].b);
			const dn = ids.filter(i => ps[i].b > 2).sort((a, b) => ps[a].b - ps[b].b);
			ups[k] = up; dns[k] = dn; upMax = Math.max(upMax, Math.ceil(up.length / cols)); dnMax = Math.max(dnMax, Math.ceil(dn.length / cols));
		});
		const g = Math.min(colW / cols, (sh * 0.70) / (upMax + dnMax + 2));
		const bloco = (upMax + dnMax) * g + 8 + (desk ? 96 : 76);
		const base = sy + Math.max(0, (sh - bloco) / 2) + upMax * g + 4;
		porK.forEach((_, k) => {
			const x0 = colX(k) - cols * g / 2;
			ups[k].forEach((i, j) => { S[2][0][i] = x0 + (j % cols + 0.5) * g; S[2][1][i] = base - 4 - (Math.floor(j / cols) + 0.5) * g; });
			dns[k].forEach((i, j) => { S[2][0][i] = x0 + (j % cols + 0.5) * g; S[2][1][i] = base + 4 + (Math.floor(j / cols) + 0.5) * g; });
		});
		/* 3 · por onde responde: o perfil definido fica nítido; o que ainda aprende se solta */
		ps.forEach((p, i) => { const solto = P[p.k].def ? 0 : g * 1.25; S[3][0][i] = S[2][0][i] + p.nx * solto; S[3][1][i] = S[2][1][i] + p.ny * solto; });

		/* 4 · a Matriz */
		const padL = desk ? 30 : 22, padB = desk ? 34 : 30;
		const mx = sx + padL, my = sy, mw = sw - padL, mh = sh - padB;
		const qw = mw / 2, qh = mh / 2;
		q.m = { x: mx, y: my, w: mw, h: mh, qw, qh };
		porK.forEach((ids, k) => {
			const qd = quadDe(P[k]), qx = mx + (qd % 2) * qw + qw / 2, qy = my + Math.floor(qd / 2) * qh + qh * 0.53;
			const ordem = ids.slice().sort((a, b) => ps[a].b - ps[b].b || ps[a].rad - ps[b].rad);
			const c4 = Math.min(qw, qh) * 0.27 / Math.sqrt(nMax);
			sunflower(qx, qy, c4, ordem, S[4][0], S[4][1]);
			P[k].mq = { x: qx, y: qy + c4 * Math.sqrt(ids.length) + (desk ? 26 : 18) };
		});

		rotulos = { colX, y1: sy + sh * 0.44 + c1 * Math.sqrt(nMax) + (desk ? 30 : 22), y2: base + 4 + dnMax * g + (desk ? 30 : 24), base, g, cols };
		desenha();
	}

	/* ---------- progresso ---------- */
	const cl = (v: number, a: number, b: number) => v < a ? a : v > b ? b : v;
	const ease = (t: number) => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
	const sm = (t: number) => { t = cl(t, 0, 1); return t * t * (3 - 2 * t); };
	function progresso() {
		if (RM) return 1;
		const r = trilho.getBoundingClientRect(), tot = r.height - window.innerHeight;
		return tot > 0 ? cl(-r.top / tot, 0, 1) : 1;
	}
	let tempo = 0, beatAtual = -1;

	function desenha() {
		if (!st || !pts) return;
		const ps = pts, q = st;
		const u = progresso() * 4.5, T: number[] = [];
		for (let k = 0; k < 4; k++) T[k] = cl((u - k - 0.25) / 0.6, 0, 1);
		let beat = 0; T.forEach(t => { if (t > 0.5) beat++; });
		if (beat !== beatAtual) {
			beatAtual = beat;
			beats.forEach((b, i) => { b.classList.toggle('on', i === beat); b.setAttribute('aria-hidden', i === beat ? 'false' : 'true'); });
			marcas.forEach((m, i) => { m.classList.toggle('on', i <= beat); });
			sec.setAttribute('data-tempo', String(beat));
		}

		ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
		ctx.clearRect(0, 0, W, H);

		/* posições: encadeia os quatro tempos com atraso por ponto */
		if (X.length !== N) { X = new Float32Array(N); Y = new Float32Array(N); }
		const giro = tempo * 0.05;
		for (let i = 0; i < N; i++) {
			const p = ps[i], a = p.ang + giro * p.w * (1.4 - p.rad);
			let x = q.cx + p.r0 * Math.cos(a), y = q.cy + p.r0 * 0.78 * Math.sin(a);
			for (let s = 0; s < 4; s++) {
				if (T[s] <= 0) break;
				const t = ease(cl((T[s] - p.d) / 0.58, 0, 1));
				x += (S[s + 1][0][i] - x) * t; y += (S[s + 1][1][i] - y) * t;
			}
			X[i] = x; Y[i] = y;
		}

		const cor = sm(T[1] * 1.3), solto = T[2] * (1 - T[3]), r = q.dot;
		const dim = (k: number) => P[k].def ? 1 : 1 - 0.28 * solto;
		/* camada cinza */
		if (cor < 1) {
			ctx.globalAlpha = 0.62 * (1 - cor); ctx.fillStyle = CINZA; ctx.beginPath();
			for (let i = 0; i < N; i++) { ctx.moveTo(X[i] + r, Y[i]); ctx.arc(X[i], Y[i], r, 0, 6.2832); }
			ctx.fill();
		}
		/* camada por faixa A–E, por perfil (para o "aprendendo" esmaecer) */
		if (cor > 0) {
			for (let k2 = 0; k2 < 4; k2++) for (let b = 0; b < 5; b++) {
				ctx.globalAlpha = cor * dim(k2); ctx.fillStyle = COR[b]; ctx.beginPath();
				for (let i = 0; i < N; i++) { const p = ps[i]; if (p.k !== k2 || p.b !== b) continue; ctx.moveTo(X[i] + r, Y[i]); ctx.arc(X[i], Y[i], r, 0, 6.2832); }
				ctx.fill();
			}
		}
		ctx.globalAlpha = 1;
		rotulosDesenha(T);
	}

	function texto(s: string, x: number, y: number, tam: number, peso: number, cor: string, alinha: CanvasTextAlign, alfa: number, fonte?: string) {
		if (alfa <= 0.01) return;
		ctx.globalAlpha = alfa; ctx.fillStyle = cor; ctx.textAlign = alinha || 'center'; ctx.textBaseline = 'alphabetic';
		ctx.font = peso + ' ' + tam + 'px ' + (fonte || FONTE); ctx.fillText(s, x, y); ctx.globalAlpha = 1;
	}

	function rotulosDesenha(T: number[]) {
		const L = rotulos!, q = st!, f = desk ? 14 : 11, lh = desk ? 18 : 14;
		/* nomes dos perfis */
		const aNome = sm(T[0] * 1.6) * (1 - sm(T[3] * 2));
		if (aNome > 0) P.forEach((p, k) => {
			const x = L.colX(k), y = L.y1 + (L.y2 - L.y1) * ease(T[1]);
			texto(p.n[0], x, y, f, 600, '#F5F5F7', 'center', aNome);
			texto(p.n[1], x, y + lh, f, 450, '#A1A1A6', 'center', aNome);
			/* canal aprendido e maturidade */
			const aC = sm(T[2] * 1.5) * (1 - sm(T[3] * 2));
			if (aC > 0) {
				const c = p.canal ? p.canal : 'canal: aprendendo';
				texto(c, x, y + lh * 2 + (desk ? 12 : 9), f, 600, p.def ? '#E3C98F' : '#86868B', 'center', aC);
				texto(p.mat, x, y + lh * 3 + (desk ? 12 : 9), desk ? 12 : 10, 450, p.def ? '#C9A35A' : '#6E6E73', 'center', aC, MONO);
			}
		});
		/* linha de base e legenda de faixas */
		const aB = sm(T[1] * 1.4) * (1 - sm(T[3] * 2));
		if (aB > 0) {
			ctx.globalAlpha = aB * 0.5; ctx.strokeStyle = '#48484A'; ctx.lineWidth = 1;
			ctx.beginPath(); ctx.moveTo(q.sx, L.base + 0.5); ctx.lineTo(q.sx + q.sw, L.base + 0.5); ctx.stroke(); ctx.globalAlpha = 1;
			const fs = desk ? 12 : 10;
			const fl = desk ? 14 : 11;
			if (desk) {
				texto('A–C', q.sx - 10, L.base - 8, fl, 600, '#F0C66E', 'right', aB, MONO);
				texto('D–E', q.sx - 10, L.base + 20, fl, 600, '#AEAEB2', 'right', aB, MONO);
			}
			/* legenda */
			const lx = q.sx + q.sw, ly = q.sy - (desk ? 14 : 18), passo = desk ? 26 : 22;
			for (let b = 4; b >= 0; b--) {
				const cx = lx - (4 - b) * passo - 6;
				ctx.globalAlpha = aB; ctx.fillStyle = COR[b]; ctx.beginPath(); ctx.arc(cx - 12, ly - 4, 3.2, 0, 6.2832); ctx.fill();
				texto('ABCDE'[b], cx - 4, ly, fs, 500, '#A1A1A6', 'left', aB, MONO);
			}
			texto('chance de pagar em 30 dias', lx - 5 * passo - 14, ly, fs, 450, '#86868B', 'right', aB);
		}
		/* Matriz */
		const aM = sm((T[3] - 0.15) * 1.6);
		if (aM > 0) {
			const m = q.m;
			ctx.globalAlpha = aM * 0.9; ctx.strokeStyle = '#2C2C2E'; ctx.lineWidth = 1; ctx.beginPath();
			ctx.moveTo(m.x + m.qw + 0.5, m.y); ctx.lineTo(m.x + m.qw + 0.5, m.y + m.h);
			ctx.moveTo(m.x, m.y + m.qh + 0.5); ctx.lineTo(m.x + m.w, m.y + m.qh + 0.5);
			ctx.stroke(); ctx.globalAlpha = 1;
			const tN = desk ? 26 : 15, tS = desk ? 13 : 10, pad = desk ? 22 : 10;
			Q.forEach((qd, i) => {
				const x = m.x + (i % 2) * m.qw + pad, y = m.y + Math.floor(i / 2) * m.qh + pad + tN;
				texto(qd.nome, x, y, tN, 650, i === 1 ? '#E3C98F' : '#F5F5F7', 'left', aM);
				texto(qd.sub, x, y + (desk ? 22 : 15), tS, 450, '#86868B', 'left', aM);
			});
			/* em cada caixa: o perfil e o canal que ele aprendeu */
			const fp = desk ? 13 : 10, fl = desk ? 17 : 13;
			P.forEach(p => {
				const mq = p.mq!;
				texto(p.n[0] + ', ' + p.n[1], mq.x, mq.y, fp, 500, '#D2D2D7', 'center', aM);
				texto(p.canal ? p.canal + ' · ' + p.mat : 'canal: ' + p.mat, mq.x, mq.y + fl, desk ? 12 : 9.5, 500, p.def ? '#C9A35A' : '#6E6E73', 'center', aM, MONO);
			});
			/* eixos */
			const fe = desk ? 12 : 10;
			texto('aprendendo', m.x, m.y + m.h + (desk ? 24 : 20), fe, 500, '#86868B', 'left', aM, MONO);
			texto('abordagem', m.x + m.w / 2, m.y + m.h + (desk ? 24 : 20), fe, 500, '#6E6E73', 'center', aM, MONO);
			texto('definida', m.x + m.w, m.y + m.h + (desk ? 24 : 20), fe, 500, '#C9A35A', 'right', aM, MONO);
			ctx.save(); ctx.translate(m.x - (desk ? 14 : 10), m.y + m.h / 2); ctx.rotate(-Math.PI / 2);
			texto('baixa', -m.h / 2, 0, fe, 500, '#86868B', 'left', aM, MONO);
			texto('chance de pagar', 0, 0, fe, 500, '#6E6E73', 'center', aM, MONO);
			texto('alta', m.h / 2, 0, fe, 500, '#C9A35A', 'right', aM, MONO);
			ctx.restore();
		}
	}

	/* ---------- laço ---------- */
	let vis = false, pausado = false, raf = 0, ult = 0;
	function laco(ts: number) {
		raf = 0; if (!vis) return;
		if (!pausado) tempo += Math.min(0.05, (ts - ult) / 1000);
		ult = ts; desenha();
		raf = requestAnimationFrame(laco);
	}
	const liga = () => { if (!raf && vis) { ult = performance.now(); raf = requestAnimationFrame(laco); } };
	function rotuloBtn() {
		if (!btn) return;
		btn.innerHTML = pausado ? ICO.play : ICO.pausa;
		btn.setAttribute('aria-label', pausado ? 'Retomar o movimento da carteira' : 'Pausar o movimento da carteira');
		btn.setAttribute('aria-pressed', pausado ? 'true' : 'false');
	}

	let io: IntersectionObserver | null = null, rt = 0;
	const aoClicar = () => { pausado = !pausado; rotuloBtn(); };
	const aoRedimensionar = () => { clearTimeout(rt); rt = window.setTimeout(layout, 120); };
	function inicia() {
		layout();
		if (RM) { sec.classList.add('parado'); if (btn) btn.hidden = true; desenha(); window.addEventListener('resize', layout); return; }
		rotuloBtn();
		if (btn) btn.addEventListener('click', aoClicar);
		io = new IntersectionObserver(es => {
			vis = es[es.length - 1].isIntersecting;
			if (vis) liga(); else if (raf) { cancelAnimationFrame(raf); raf = 0; }
		}, { rootMargin: '100px 0px' });
		io.observe(sec);
		window.addEventListener('resize', aoRedimensionar);
	}
	/* Começa depois das fontes (os rótulos do canvas usam a Geist), como no protótipo. */
	let limpaFontes: Limpeza = () => {};
	if ('fonts' in document) limpaFontes = quandoFontes(inicia); else inicia();
	return () => {
		limpaFontes();
		if (raf) cancelAnimationFrame(raf); raf = 0; vis = false;
		io?.disconnect(); clearTimeout(rt);
		window.removeEventListener('resize', aoRedimensionar); window.removeEventListener('resize', layout);
		btn?.removeEventListener('click', aoClicar);
	};
}
