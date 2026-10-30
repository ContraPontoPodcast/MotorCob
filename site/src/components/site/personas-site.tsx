import { useEffect, useMemo, useRef, useState } from 'react';
import { personasSite, CANAL_COR_SITE, type PersonaSite } from '@/data/site';
import { useAnimatedValues } from '@/hooks/use-animated-values';

const C = 2 * Math.PI * 40; // 251.3

type PersonaVals = {
	maturidade: number;
	clientes: number;
	t0: number;
	t1: number;
	t2: number;
	t3: number;
};

function parseClientes(criterio: string): number {
	const m = criterio.match(/(\d+)\s*clientes/);
	return m ? parseInt(m[1], 10) : 0;
}

function rand(max: number): number {
	return (Math.random() * 2 - 1) * max;
}

function nextPersonaVals(p: PersonaSite, baseClientes: number, prev: PersonaVals): PersonaVals {
	const maturidade = Math.round(
		Math.max(p.maturidade - 6, Math.min(p.maturidade + 6, prev.maturidade + rand(2.5))),
	);
	const clientes = Math.round(
		Math.max(
			Math.round(baseClientes * 0.96),
			Math.min(Math.round(baseClientes * 1.04), prev.clientes + rand(baseClientes * 0.012)),
		),
	);
	const prevTaxa = [prev.t0, prev.t1, prev.t2, prev.t3];
	const taxa = p.ranking.map((r, i) => {
		const base = r.taxa;
		const next = Math.max(base * 0.94, Math.min(base * 1.06, prevTaxa[i] + rand(base * 0.025)));
		return Math.round(next * 10) / 10;
	});
	return { maturidade, clientes, t0: taxa[0], t1: taxa[1], t2: taxa[2], t3: taxa[3] };
}

function MaturityRing({ m, display, cor }: { m: number; display: number; cor: string }) {
	const dash = (m / 100) * C;
	return (
		<svg width="84" height="84" viewBox="0 0 100 100" role="img" aria-label={`Maturidade ${Math.round(m)} de 100`}>
			<circle cx="50" cy="50" r="40" fill="none" stroke="#E5E5EA" strokeWidth="8" />
			<circle
				cx="50" cy="50" r="40" fill="none" stroke={cor} strokeWidth="8" strokeLinecap="round"
				strokeDasharray={`${dash} ${C}`}
				transform="rotate(-90 50 50)"
				style={{ transition: 'stroke-dasharray 0.9s ease-out' }}
			/>
			<text x="50" y="50" textAnchor="middle" dominantBaseline="central" className="tnum" style={{ fontSize: 22, fontWeight: 600, fill: '#1D1D1F' }}>{Math.round(display)}</text>
		</svg>
	);
}

function Ranking({ p, taxa, displayTaxa, max }: { p: PersonaSite; taxa: number[]; displayTaxa: number[]; max: number }) {
	return (
		<div className="mt-5 space-y-2.5">
			{p.ranking.map((r, i) => {
				const corBarra = r.pos ? (CANAL_COR_SITE[r.canal] ?? '#475569') : '#C7C7CC';
				const largura = Math.max(4, (taxa[i] / max) * 100);
				return (
					<div key={`${r.canal}-${i}`} className="grid items-center gap-3" style={{ gridTemplateColumns: '118px 1fr 84px' }}>
						<div className="flex min-w-0 items-center gap-1.5">
							<span className="truncate text-[14px] text-[#1D1D1F]">{r.canal}</span>
							{r.pos === 'melhor' && <span className="shrink-0 text-[12px] text-[#8E8E93]">★ melhor</span>}
							{r.pos === 'segundo' && <span className="shrink-0 text-[12px] text-[#8E8E93]">2º</span>}
						</div>
						<div className="h-1.5 w-full overflow-hidden rounded-full bg-[#E5E5EA]">
							<div className="h-full rounded-full" style={{ width: `${largura}%`, backgroundColor: corBarra, transition: 'width 0.9s ease-out' }} />
						</div>
						<span className="tnum whitespace-nowrap text-right text-[13px] text-[#6E6E73]">
							{displayTaxa[i].toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}% CPC
						</span>
					</div>
				);
			})}
		</div>
	);
}

function Panel({ p, active }: { p: PersonaSite; active: boolean }) {
	const baseClientes = useMemo(() => parseClientes(p.criterio), [p]);
	const [vals, setVals] = useState<PersonaVals>(() => ({
		maturidade: p.maturidade,
		clientes: baseClientes,
		t0: p.ranking[0].taxa,
		t1: p.ranking[1].taxa,
		t2: p.ranking[2].taxa,
		t3: p.ranking[3].taxa,
	}));
	const display = useAnimatedValues(vals, 900, active);

	useEffect(() => {
		if (!active) return;
		const id = setInterval(() => setVals((prev) => nextPersonaVals(p, baseClientes, prev)), 2600);
		return () => clearInterval(id);
	}, [active, p, baseClientes]);

	const taxaArr = [vals.t0, vals.t1, vals.t2, vals.t3];
	const displayTaxa = [display.t0, display.t1, display.t2, display.t3];
	const max = Math.max(...taxaArr) || 1;

	const criterioParts = useMemo(() => p.criterio.match(/^(.*?)(\d+)(\s*clientes)$/), [p]);

	return (
		<div className="rounded-2xl bg-white p-5" style={{ boxShadow: '0 0 0 1px #E5E5EA, 0 2px 12px rgba(0,0,0,.04)' }}>
			<div className="flex items-start gap-4">
				<MaturityRing m={vals.maturidade} display={display.maturidade} cor={p.cor} />
				<div className="min-w-0 flex-1">
					<div className="flex items-center gap-2">
						<span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: p.cor }} />
						<span className="text-[17px] font-semibold text-[#1D1D1F]">{p.nome}</span>
					</div>
					<p className="mt-1 text-[13px] text-[#6E6E73]">
						{criterioParts ? (
							<>{criterioParts[1]}{Math.round(display.clientes).toLocaleString('pt-BR')}{criterioParts[3]}</>
						) : p.criterio}
					</p>
					<span className="mt-2 inline-block rounded-full bg-[#F5F5F7] px-2.5 py-0.5 text-[12px] text-[#6E6E73]">{p.selo}</span>
				</div>
			</div>
			<Ranking p={p} taxa={taxaArr} displayTaxa={displayTaxa} max={max} />
		</div>
	);
}

export function PersonasSite() {
	const sectionRef = useRef<HTMLElement>(null);
	const [visible, setVisible] = useState(false);
	const [paused, setPaused] = useState(false);
	const [reduceMotion, setReduceMotion] = useState(false);

	useEffect(() => {
		const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
		setReduceMotion(mq.matches);
		const onChange = () => setReduceMotion(mq.matches);
		mq.addEventListener('change', onChange);
		return () => mq.removeEventListener('change', onChange);
	}, []);

	useEffect(() => {
		const el = sectionRef.current;
		if (!el) return;
		const io = new IntersectionObserver(([e]) => setVisible(e.isIntersecting), { threshold: 0 });
		io.observe(el);
		return () => io.disconnect();
	}, []);

	const active = visible && !paused && !reduceMotion;

	return (
		<section ref={sectionRef} id="personas-site" aria-live="off" className="scroll-mt-[92px] bg-white px-5 py-20 md:scroll-mt-[64px] md:py-28">
			<div className="mx-auto max-w-[1120px]">
				<p className="text-center text-[17px] font-semibold text-[#6E6E73]">Personas</p>
				<h2 className="ls-tight mt-3 text-center font-bold text-[#1D1D1F]" style={{ fontSize: 'clamp(32px, 5vw, 56px)' }}>Cada perfil tem o seu canal.</h2>
				<p className="mx-auto mt-4 max-w-[720px] text-center text-[17px] leading-relaxed text-[#6E6E73]">O Analista mede o CPC por real gasto em cada canal. Com evidência firme, o Estrategista sugere a mudança na régua.</p>

				{!reduceMotion && (
					<div className="mt-8 flex items-center justify-center gap-2">
						<span className="relative flex h-[7px] w-[7px] items-center justify-center">
							{paused ? (
								<span className="block h-[7px] w-[7px] rounded-full bg-[#AEAEB2]" />
							) : (
								<span className="mc-pulse-dot block h-[7px] w-[7px] rounded-full bg-[#34C759]" />
							)}
						</span>
						<span className="text-[13px] text-[#6E6E73]">{paused ? 'Pausado · dados fictícios' : 'Atualizando · dados fictícios'}</span>
						<button
							type="button"
							onClick={() => setPaused((p) => !p)}
							aria-pressed={paused}
							className="rounded-full bg-[#F2F2F7] px-3 text-[12px] font-medium text-[#1D1D1F]"
							style={{ height: 26 }}
						>
							{paused ? 'Continuar' : 'Pausar'}
						</button>
					</div>
				)}

				<div className="mt-12 grid gap-5 md:grid-cols-3">
					{personasSite.map((p) => <Panel key={p.nome} p={p} active={active} />)}
				</div>
				<p className="mt-8 text-center text-[13px] text-[#8E8E93]">Dados fictícios.</p>
			</div>
		</section>
	);
}
