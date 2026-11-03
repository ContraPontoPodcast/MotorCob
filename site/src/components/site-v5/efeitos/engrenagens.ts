/* Engrenagens de luz da home (as aprovadas na v3, só o modo luz em autoplay; sem titânio, sem three.js).
   14 engrenagens em árvore, giro com relação de dentes correta, desenhadas por pontos de luz em canvas 2D.
   Acendem sozinhas, uma a cada ~550 ms, na ordem do fluxo; seguram todas acesas, apagam e recomeçam, em laço.
   Personas e propensão e Orquestração ficam no centro. Contador NN/14, nome, descrição e a legenda de → o quê → para.
   Laço só com a seção visível e sem pausa; botão de pausa; prefers-reduced-motion = quadro estático, todo aceso. */
import { ICO, movimentoReduzido, quandoFontes, type Limpeza } from './comum';

type Eng = { id: string; nome: string; g: string; href: string; d: string };
/* As 14 engrenagens. g = o verbo da IA a que ela pertence. Cada uma leva à sua página. */
const ENG: Eng[] = [
	{ id: 'integracoes', nome: 'Integrações e API', g: 'Entende', href: '/solucoes/cobranca#discador', d: 'Carga, Lista do dia e retorno por API, com token de escopo.' },
	{ id: 'cargas', nome: 'Carga e mapeamento', g: 'Entende', href: '/solucoes/cobranca#discador', d: 'Arquivo ou API. O layout é lido sozinho, e você confere.' },
	{ id: 'personas', nome: 'Personas e propensão', g: 'Entende', href: '/como-decide#perfis', d: 'O canal que rende mais por perfil e a chance de pagar em 30 dias.' },
	{ id: 'enriquecimento', nome: 'Enriquecimento', g: 'Entende', href: '/solucoes/cobranca#contato', d: 'Quem mandar ao bureau, e os números novos que ele devolve.' },
	{ id: 'orquestracao', nome: 'Orquestração', g: 'Decide', href: '/como-decide#regua', d: 'Segmentos, estágios e régua, com uma raia por perfil.' },
	{ id: 'lista', nome: 'Lista do dia', g: 'Decide', href: '/solucoes/cobranca#lista-do-dia', d: 'Um contato por cliente, por canal, e o motivo de quem ficou de fora.' },
	{ id: 'mensageria', nome: 'Mensageria', g: 'Age', href: '/solucoes/cobranca#canais', d: 'SMS, RCS e e-mail, com o Radar lendo as respostas.' },
	{ id: 'voz', nome: 'Agente de voz', g: 'Age', href: '/solucoes/voz', d: 'Liga pela sua telefonia, no fluxo que você aprovou.' },
	{ id: 'discagem', nome: 'Discagem', g: 'Age', href: '/solucoes/voz#discagem', d: 'Tentativas, intervalos e renitência, para o Discador.' },
	{ id: 'speech', nome: 'Speech Analytics', g: 'Aprende', href: '/solucoes/speech-analytics', d: 'Nota, motivo e recomendação nas ligações analisadas.' },
	{ id: 'gravacoes', nome: 'Gravações', g: 'Aprende', href: '/solucoes/speech-analytics#entrada', d: 'Do agente de voz e do Discador, mascaradas antes da IA.' },
	{ id: 'roleplay', nome: 'Roleplay', g: 'Aprende', href: '/solucoes/voz#roleplay', d: 'Conversas simuladas, sem dado real, antes de aprovar.' },
	{ id: 'relatorios', nome: 'Relatórios e comitê', g: 'Aprende', href: '/solucoes/cobranca#comite', d: 'Ações, contato e custo por canal, régua e segmento.' },
	{ id: 'contato', nome: 'Contato certo', g: 'Aprende', href: '/solucoes/cobranca#contato', d: 'Quem atendeu vira contato principal. O número que falha é suspenso.' },
];
const INFO: Record<string, Eng> = {}; ENG.forEach(e => { INFO[e.id] = e; });
const nome = (id: string) => INFO[id].nome;

type Def = { id: string; n: number; mae?: string; a?: number };
/* Árvore (a mesma geometria aprovada): n = dentes, mae = engrenagem em que encosta, a = ângulo. */
const DEF: Def[] = [
	{ id: 'orquestracao', n: 36 },
	{ id: 'personas', n: 22, mae: 'orquestracao', a: 180 },
	{ id: 'cargas', n: 18, mae: 'personas', a: 225 },
	{ id: 'integracoes', n: 12, mae: 'cargas', a: 250 },
	{ id: 'enriquecimento', n: 14, mae: 'personas', a: 135 },
	{ id: 'lista', n: 24, mae: 'orquestracao', a: 0 },
	{ id: 'mensageria', n: 18, mae: 'lista', a: -45 },
	{ id: 'voz', n: 20, mae: 'lista', a: 40 },
	{ id: 'discagem', n: 14, mae: 'voz', a: 30 },
	{ id: 'speech', n: 24, mae: 'orquestracao', a: 100 },
	{ id: 'gravacoes', n: 14, mae: 'speech', a: 10 },
	{ id: 'roleplay', n: 14, mae: 'speech', a: 170 },
	{ id: 'relatorios', n: 18, mae: 'orquestracao', a: -80 },
	{ id: 'contato', n: 16, mae: 'relatorios', a: 200 },
];
/* Ordem do fluxo: cada uma encosta numa já acesa. */
const ORDEM = ['integracoes', 'cargas', 'personas', 'enriquecimento', 'orquestracao', 'lista', 'mensageria', 'voz', 'discagem', 'speech', 'gravacoes', 'roleplay', 'relatorios', 'contato'];
const NUM: Record<string, string> = {}; ORDEM.forEach((id, i) => { NUM[id] = (i < 9 ? '0' : '') + (i + 1); });
type Fluxo = [string, string, string];
const FLUXOS: Fluxo[] = [
	['integracoes', 'carga e retorno por API', 'cargas'],
	['cargas', 'a carteira do dia', 'personas'],
	['personas', 'melhor canal e chance de pagar, como condição de etapa', 'orquestracao'],
	['enriquecimento', 'números novos, para conferir', 'lista'],
	['orquestracao', 'a régua do dia, por segmento e estágio', 'lista'],
	['lista', 'um contato por cliente, o principal primeiro', 'mensageria'],
	['lista', 'um contato por cliente, o principal primeiro', 'voz'],
	['lista', 'o mailing, com tentativas e janela', 'discagem'],
	['voz', 'ligações gravadas', 'gravacoes'],
	['gravacoes', 'transcrição mascarada', 'speech'],
	['speech', 'recomendação com evidência, como rascunho', 'orquestracao'],
	['roleplay', 'versão testada com personas difíceis', 'voz'],
	['mensageria', 'respostas: o canal que rende por perfil', 'personas'],
	['orquestracao', 'ações, contato e custo por canal', 'relatorios'],
	['contato', 'quem atendeu vai primeiro na próxima lista', 'lista'],
];
const MAE: Record<string, string | undefined> = {}; DEF.forEach(d => { MAE[d.id] = d.mae; });
const TAU = Math.PI * 2;

type Roda = { id: string; n: number; r: number; x: number; y: number; mae?: string; m: number; fi: number; dir: number; k: number };
type Geo = { rodas: Record<string, Roda>; b: { cx: number; cy: number; w: number; h: number } };

function montarGeo(vertical: boolean): Geo {
	const g: Record<string, Roda> = {}, rad = Math.PI / 180, m = 8;
	DEF.forEach(d => {
		const r = m * d.n / 2; let x = 0, y = 0;
		if (d.mae) { const p = g[d.mae], dist = p.r + r; x = p.x + dist * Math.cos(d.a! * rad); y = p.y + dist * Math.sin(d.a! * rad); }
		g[d.id] = { id: d.id, n: d.n, r, x, y, mae: d.mae, m, fi: 0, dir: 1, k: 1 };
	});
	if (vertical) Object.keys(g).forEach(k => { const o = g[k], x = o.x; o.x = -o.y; o.y = x; });
	DEF.forEach(d => {
		const o = g[d.id];
		if (!o.mae) { o.fi = 0; o.dir = 1; o.k = 1; return; }
		const p = g[o.mae], th = Math.atan2(o.y - p.y, o.x - p.x), pa = TAU / p.n, pb = TAU / o.n;
		const u = (((th - p.fi) / pa) % 1 + 1) % 1;
		o.fi = th + Math.PI - pb * (0.5 - u); o.dir = -p.dir; o.k = p.n / o.n * p.k;
	});
	let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
	Object.keys(g).forEach(k => { const o = g[k], R = o.r + m; x0 = Math.min(x0, o.x - R); x1 = Math.max(x1, o.x + R); y0 = Math.min(y0, o.y - R); y1 = Math.max(y1, o.y + R); });
	return { rodas: g, b: { cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, w: x1 - x0, h: y1 - y0 } };
}
const angulo = (o: Roda, t: number) => o.fi + o.dir * t * o.k;
function caminho(a: string, b: string): string[] {
	const pa: string[] = []; let x: string | undefined = a; while (x) { pa.push(x); x = MAE[x]; }
	const pb: string[] = []; let y: string | undefined = b; while (y && pa.indexOf(y) < 0) { pb.push(y); y = MAE[y]; }
	return pa.slice(0, pa.indexOf(y!) + 1).concat(pb.reverse());
}

type Seg = { o: Roda; a0: number; da: number; L: number };
type Pulso = { segs: Seg[]; L: number; s: number };

export function iniciarEngrenagens(sec: HTMLElement): Limpeza {
	const RM = movimentoReduzido();
	const DPR = Math.min(2, window.devicePixelRatio || 1);
	const fixo = sec.querySelector<HTMLElement>('.ou-fixo')!, cv = sec.querySelector<HTMLCanvasElement>('.ou-luz-cv')!, x = cv.getContext('2d')!;
	const contEl = sec.querySelector<HTMLElement>('.ou-cont b')!, nomeEl = sec.querySelector<HTMLElement>('.ou-luz-nome')!, descEl = sec.querySelector<HTMLElement>('.ou-luz-desc')!, flxEl = sec.querySelector<HTMLElement>('.ou-luz-flx');
	const btn = sec.querySelector<HTMLButtonElement>('.ou-pausa')!, navEl = sec.querySelector<HTMLElement>('.ou-leg')!;

	/* Legenda: 14 links numerados na ordem do fluxo, com o verbo da IA. Passar o mouse destaca a engrenagem. */
	let foco: string | null = null;
	const links: Record<string, HTMLAnchorElement> = {};
	navEl.innerHTML = '<ol>' + ORDEM.map(id =>
		'<li><a href="' + INFO[id].href + '" data-id="' + id + '"><span class="n">' + NUM[id] + '</span><span class="t">' + nome(id) + '</span><span class="g">' + INFO[id].g + '</span></a></li>',
	).join('') + '</ol>';
	navEl.querySelectorAll<HTMLAnchorElement>('a[data-id]').forEach(a => { links[a.getAttribute('data-id')!] = a; });
	const aoFoco = (e: Event) => { const a = e.target instanceof Element ? e.target.closest('a[data-id]') : null; foco = a ? a.getAttribute('data-id') : null; redesenha(); };
	const semFoco = () => { foco = null; redesenha(); };
	navEl.addEventListener('mouseover', aoFoco); navEl.addEventListener('focusin', aoFoco);
	navEl.addEventListener('mouseleave', semFoco); navEl.addEventListener('focusout', semFoco);

	const conexao = (f?: Fluxo) => { if (flxEl && f) flxEl.innerHTML = '<b>' + nome(f[0]) + '</b><i aria-hidden="true">→</i><span>' + f[1] + '</span><i aria-hidden="true">→</i><b>' + nome(f[2]) + '</b>'; };

	let G: Record<string, Roda> = {}, b = { cx: 0, cy: 0, w: 1, h: 1 }, perf: Record<string, { pts: [number, number][] }> = {};
	const bloom1 = document.createElement('canvas'), bx1 = bloom1.getContext('2d')!, bloom2 = document.createElement('canvas'), bx2 = bloom2.getContext('2d')!;
	let W = 0, H = 0, k = 1, ox = 0, oy = 0, t = 0, alvoN = 1, mostrado = -1, proxPulso = 0;
	let pulsos: Pulso[] = [];
	const aceso: Record<string, number> = {};
	DEF.forEach(d => { aceso[d.id] = 0; });
	const PASSO = 0.55, SEGURA = 2.2, APAGA = 1.1;
	let fase: 'acende' | 'segura' | 'apaga' = 'acende', relogio = 0, nAuto = 1;
	const DESTAQUE: Record<string, boolean> = {};

	function monta() {
		const cel = window.matchMedia('(max-width: 734px)').matches;
		const geo = montarGeo(cel); G = geo.rodas; b = geo.b; perf = {};
		DEF.forEach(d => {
			const o = G[d.id], p = TAU / o.n, ra = o.r + o.m * 0.9, rd = o.r - o.m * 1.0, pts: [number, number][] = [];
			for (let i = 0; i < o.n; i++) {
				const a = i * p;
				([[rd, -0.5], [rd, -0.25], [ra, -0.12], [ra, 0.12], [rd, 0.25]] as const).forEach(q => { pts.push([q[0], a + q[1] * p]); });
			}
			perf[d.id] = { pts };
		});
	}
	function medir() {
		monta();
		const r = fixo.getBoundingClientRect(); W = Math.round(r.width); H = Math.round(r.height);
		cv.width = Math.round(W * DPR); cv.height = Math.round(H * DPR);
		bloom1.width = Math.max(1, Math.round(W / 4)); bloom1.height = Math.max(1, Math.round(H / 4));
		bloom2.width = Math.max(1, Math.round(W / 12)); bloom2.height = Math.max(1, Math.round(H / 12));
		/* Área da máquina: à direita no desktop, embaixo no celular. */
		let ax: number, ay: number, aw: number, ah: number;
		const txt = sec.querySelector('.ou-luz-txt')!.getBoundingClientRect(), fr = fixo.getBoundingClientRect();
		if (W > 900) {
			/* Na mesma caixa central do texto (até 1920 px, como o CSS); a máquina começa depois da coluna de texto,
			   nunca embaixo dela (em 1024 px a coluna chega a 43% da largura). */
			const F = Math.min(W, 1920), L0 = (W - F) / 2;
			ax = Math.max(L0 + F * 0.43, txt.right - fr.left + 24); ay = 36; aw = L0 + F * 0.98 - ax; ah = H - 72;
		} else { ax = 12; ay = Math.max(H * 0.36, txt.bottom - fr.top + 16); aw = W - 24; ah = H - ay - 64; }
		k = Math.min(aw / b.w, ah / b.h); ox = ax + aw / 2 - b.cx * k; oy = ay + ah / 2 - b.cy * k;
	}
	const X = (v: number) => ox + v * k, Y = (v: number) => oy + v * k;

	/* Pulso: cometa que corre pela cabeça dos dentes e passa de uma roda à outra no ponto de contato. */
	function pulsar(f: Fluxo) {
		const ids = caminho(f[0], f[2]), segs: Seg[] = [];
		ids.forEach((id, i) => {
			const o = G[id], prev = ids[i - 1] && G[ids[i - 1]], next = ids[i + 1] && G[ids[i + 1]];
			const a0 = prev ? Math.atan2(prev.y - o.y, prev.x - o.x) : Math.random() * TAU;
			const a1 = next ? Math.atan2(next.y - o.y, next.x - o.x) : a0 + o.dir * Math.PI;
			let da = ((a1 - a0) * o.dir % TAU + TAU) % TAU; if (da < 0.4) da += TAU;
			segs.push({ o, a0, da: da * o.dir, L: da * o.r });
		});
		pulsos.push({ segs, L: segs.reduce((s, g) => s + g.L, 0), s: 0 });
	}

	function desenha(dt: number) {
		if (!W) medir();
		t += dt;
		if (RM) alvoN = 14;
		else {
			if (dt) {
				relogio += dt;
				if (fase === 'acende' && relogio >= PASSO) { relogio = 0; if (nAuto < 14) nAuto++; else fase = 'segura'; }
				else if (fase === 'segura' && relogio >= SEGURA) { relogio = 0; fase = 'apaga'; }
				else if (fase === 'apaga' && relogio >= APAGA) { relogio = 0; fase = 'acende'; nAuto = 1; }
			}
			alvoN = fase === 'apaga' ? 0 : nAuto;
		}
		sec.setAttribute('data-acesas', String(alvoN));
		ORDEM.forEach((id, i) => { const alvo = i < alvoN ? 1 : 0; aceso[id] += (alvo - aceso[id]) * (dt ? Math.min(1, dt * 5) : 1); });
		if (mostrado !== alvoN && alvoN === 0) { mostrado = 0; ORDEM.forEach(j => links[j].classList.remove('acesa')); }
		if (mostrado !== alvoN) {
			mostrado = alvoN; const id = ORDEM[alvoN - 1];
			contEl.textContent = NUM[id]; nomeEl.textContent = nome(id); descEl.textContent = INFO[id].d;
			const aces = (j: string) => ORDEM.indexOf(j) < alvoN;
			conexao(FLUXOS.filter(f => f[2] === id && aces(f[0]))[0] || FLUXOS.filter(f => f[0] === id)[0]);
			ORDEM.forEach((j, i) => links[j].classList.toggle('acesa', i < alvoN));
			if (dt) { const mae = MAE[id] && ORDEM.indexOf(MAE[id]!) < alvoN ? MAE[id] : ORDEM.filter(j => MAE[j] === id)[0]; if (mae) pulsar([mae, '', id]); }
		}
		if (dt) {
			proxPulso -= dt;
			if (proxPulso <= 0) {
				const ok = FLUXOS.filter(f => caminho(f[0], f[2]).every(j => ORDEM.indexOf(j) < alvoN));
				if (ok.length) pulsar(ok[Math.floor(Math.random() * ok.length)]);
				proxPulso = 0.9 + Math.random() * 0.8;
			}
		}
		const ang = t * 0.09;
		x.setTransform(DPR, 0, 0, DPR, 0, 0);
		x.globalCompositeOperation = 'source-over';
		x.fillStyle = '#000'; x.fillRect(0, 0, W, H);
		x.globalCompositeOperation = 'lighter';
		DEF.forEach(d => {
			const o = G[d.id], pf = perf[d.id], A = angulo(o, ang), cx = X(o.x), cy = Y(o.y), L = aceso[d.id], f = foco === d.id, dst = DESTAQUE[d.id];
			x.fillStyle = dst ? 'rgba(232,200,140,' + (0.34 + L * 0.1) + ')' : 'rgba(255,255,255,' + (0.2 + L * 0.06) + ')';
			const dot = Math.max(1, k * 1.1);
			for (let i = 0; i < pf.pts.length; i++) { const q = pf.pts[i], px = cx + q[0] * k * Math.cos(q[1] + A), py = cy + q[0] * k * Math.sin(q[1] + A); x.fillRect(px - dot / 2, py - dot / 2, dot, dot); }
			if (L > 0.01 || f) {
				const LL = Math.max(L, f ? 0.6 : 0);
				x.beginPath();
				pf.pts.forEach((q, i) => { const px = cx + q[0] * k * Math.cos(q[1] + A), py = cy + q[0] * k * Math.sin(q[1] + A); if (i) x.lineTo(px, py); else x.moveTo(px, py); });
				x.closePath(); x.lineJoin = 'round';
				x.strokeStyle = dst ? 'rgba(244,204,128,' + (0.95 * LL) + ')' : 'rgba(232,206,150,' + (0.55 * LL) + ')'; x.lineWidth = Math.max(1, k * (dst ? 2.2 : 1.3)); x.stroke();
				const rr = [o.r * 0.62, o.r * 0.34], nseg = o.r > 100 ? 6 : o.r > 70 ? 4 : 3;
				rr.forEach((R0, j) => {
					if (R0 * k < 6) return;
					x.lineWidth = Math.max(1.2, k * (j ? 2.2 : 3)); x.lineCap = 'round';
					x.strokeStyle = 'rgba(255,243,220,' + ((j ? 0.5 : 0.75) * LL) + ')';
					for (let q2 = 0; q2 < nseg; q2++) { const a0 = A * (j ? -1 : 1) + q2 * TAU / nseg + 0.18; x.beginPath(); x.arc(cx, cy, R0 * k, a0, a0 + TAU / nseg - 0.36); x.stroke(); }
				});
				x.fillStyle = 'rgba(255,214,150,' + (0.9 * LL) + ')'; x.beginPath(); x.arc(cx, cy, Math.max(2, o.r * k * (dst ? 0.1 : 0.07)), 0, TAU); x.fill();
			} else {
				x.strokeStyle = dst ? 'rgba(201,163,90,.22)' : 'rgba(255,255,255,.06)'; x.lineWidth = 1; x.beginPath(); x.arc(cx, cy, o.r * 0.62 * k, 0, TAU); x.stroke();
			}
		});
		/* Nome das duas engrenagens centrais, sob o eixo. */
		x.globalCompositeOperation = 'source-over'; x.textAlign = 'center'; x.textBaseline = 'top';
		const fs = Math.max(13, Math.round(k * 14)); x.font = '600 ' + fs + 'px Geist, system-ui, sans-serif';
		Object.keys(DESTAQUE).forEach(id => {
			const o = G[id], linhas = id === 'personas' ? ['Personas e', 'propensão'] : [nome(id)], y0 = Y(o.y) + o.r * k * 0.4;
			const larg = Math.max(...linhas.map(l => x.measureText(l).width));
			x.fillStyle = 'rgba(0,0,0,.62)'; x.fillRect(X(o.x) - larg / 2 - 6, y0 - 3, larg + 12, linhas.length * fs * 1.15 + 6);
			x.fillStyle = 'rgba(244,214,160,' + (0.55 + 0.45 * aceso[id]) + ')';
			linhas.forEach((l, i) => x.fillText(l, X(o.x), y0 + i * fs * 1.15));
		});
		x.globalCompositeOperation = 'lighter';
		const vel = 360;
		pulsos = pulsos.filter(pu => {
			if (dt) pu.s += dt * vel;
			if (pu.s > pu.L + 200) return false;
			const CAU = 26;
			for (let j = 0; j < CAU; j++) {
				const sp = pu.s - j * 7; if (sp < 0 || sp > pu.L) continue;
				let acc = 0, sg: Seg | null = null;
				for (let m = 0; m < pu.segs.length; m++) { if (sp <= acc + pu.segs[m].L || m === pu.segs.length - 1) { sg = pu.segs[m]; break; } acc += pu.segs[m].L; }
				if (!sg) continue;
				const fr = sg.L ? (sp - acc) / sg.L : 0, a = sg.a0 + sg.da * fr, rr = (sg.o.r + sg.o.m * 0.9) * k;
				const px = X(sg.o.x) + rr * Math.cos(a), py = Y(sg.o.y) + rr * Math.sin(a), al = (1 - j / CAU), raio = Math.max(1.4, k * (j ? 2.6 : 4.2)) * (0.5 + al * 0.5);
				x.fillStyle = j ? 'rgba(201,163,90,' + (al * al * 0.85) + ')' : 'rgba(255,248,232,1)';
				x.beginPath(); x.arc(px, py, raio, 0, TAU); x.fill();
			}
			return true;
		});
		/* Bloom barato: reduz, borra pela escala e soma de volta. */
		x.setTransform(1, 0, 0, 1, 0, 0);
		bx1.globalCompositeOperation = 'copy'; bx1.drawImage(cv, 0, 0, bloom1.width, bloom1.height);
		bx2.globalCompositeOperation = 'copy'; bx2.drawImage(bloom1, 0, 0, bloom2.width, bloom2.height);
		x.globalCompositeOperation = 'lighter'; x.imageSmoothingEnabled = true;
		x.globalAlpha = 0.55; x.drawImage(bloom1, 0, 0, cv.width, cv.height);
		x.globalAlpha = 0.8; x.drawImage(bloom2, 0, 0, cv.width, cv.height);
		x.globalAlpha = 1; x.globalCompositeOperation = 'source-over';
	}

	/* Laço: rAF só com a seção visível e sem pausa. */
	let vis = false, pausado = RM, raf = 0, ult = 0;
	function laco(ts: number) { raf = 0; if (!vis || pausado) return; const dt = Math.min(0.05, (ts - ult) / 1000); ult = ts; desenha(dt); raf = requestAnimationFrame(laco); }
	function liga() { if (!raf && vis && !pausado) { ult = performance.now(); raf = requestAnimationFrame(laco); } }
	function desliga() { if (raf) cancelAnimationFrame(raf); raf = 0; }
	function redesenha() { if (!raf) desenha(0); }
	function rotulo() { btn.innerHTML = pausado ? ICO.play : ICO.pausa; btn.setAttribute('aria-label', pausado ? 'Retomar as engrenagens' : 'Pausar as engrenagens'); btn.setAttribute('aria-pressed', pausado ? 'true' : 'false'); }
	if (RM) btn.hidden = true;
	const aoClicar = () => { pausado = !pausado; rotulo(); if (pausado) { desliga(); redesenha(); } else liga(); };
	btn.addEventListener('click', aoClicar);
	rotulo();
	const io1 = new IntersectionObserver(es => { vis = es[es.length - 1].isIntersecting; if (vis) liga(); else desliga(); }, { rootMargin: '80px 0px' });
	io1.observe(sec);
	/* Ao entrar na tela, recomeça do começo (a primeira engrenagem). */
	let io2: IntersectionObserver | null = null;
	if (!RM) { io2 = new IntersectionObserver(es => { if (es[es.length - 1].isIntersecting) { fase = 'acende'; nAuto = 1; relogio = 0; } }, { threshold: 0.2 }); io2.observe(sec); }
	let tmr = 0;
	const aoRedimensionar = () => { clearTimeout(tmr); tmr = window.setTimeout(() => { medir(); redesenha(); }, 120); };
	window.addEventListener('resize', aoRedimensionar);
	const limpaFontes = quandoFontes(() => { medir(); redesenha(); });
	medir(); desenha(0);
	if (RM) sec.classList.add('estatico');
	return () => {
		desliga(); io1.disconnect(); io2?.disconnect(); clearTimeout(tmr); limpaFontes();
		window.removeEventListener('resize', aoRedimensionar);
		btn.removeEventListener('click', aoClicar);
		navEl.removeEventListener('mouseover', aoFoco); navEl.removeEventListener('focusin', aoFoco);
		navEl.removeEventListener('mouseleave', semFoco); navEl.removeEventListener('focusout', semFoco);
		navEl.innerHTML = '';
	};
}
