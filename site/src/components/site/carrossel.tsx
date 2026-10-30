import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, Paperclip, Pause, Play } from 'lucide-react';
import { useAnimatedValues } from '@/hooks/use-animated-values';

type Slide = { num: string; titulo: string; texto: string };

const slides: Slide[] = [
	{ num: '01', titulo: 'Lista do dia', texto: 'Às 6h, a carga vira a lista de quem acionar hoje, por canal, com o motivo de quem ficou de fora.' },
	{ num: '02', titulo: 'Orquestração', texto: 'A régua de cada segmento, dia a dia: canal principal, “senão” e o telefone Hot primeiro.' },
	{ num: '03', titulo: 'Mensageria', texto: 'SMS, e-mail e RCS saem da própria plataforma. No RCS, o cliente vê o logo da sua marca, cartões, carrossel e botões.' },
	{ num: '04', titulo: 'Workspace', texto: 'Ao entrar, só o que pede atenção hoje. Produtos, membros, faturas e documentação no mesmo lugar.' },
	{ num: '05', titulo: 'Suporte', texto: 'Chamado com motivo, anexo e protocolo. A resposta chega na plataforma, com histórico.' },
	{ num: '06', titulo: 'Arquivo ou API', texto: 'Cada credor escolhe como a carga chega: arquivo, como o credor manda hoje, ou API, direto do sistema.' },
];

const cardShadow = '0 0 0 1px rgba(255,255,255,.08), 0 30px 60px -30px rgba(0,0,0,.8)';

// ---- Lista do dia (slide 01) — valores fictícios que oscilam ----
const CARTEIRA = 2600;
const ENCERRADOS = 79;

type ListaVals = {
	d5: number;
	hoje: number;
	semContato: number;
	semTelefone: number;
	comAcao: number;
	foraEsteira: number;
};

const INITIAL_LISTA: ListaVals = {
	d5: 324,
	hoje: 221,
	semContato: 107,
	semTelefone: 92,
	comAcao: 1869,
	foraEsteira: 545,
};

function stepClamp(base: number, pct: number, prev: number): number {
	const range = base * pct;
	const maxStep = range / 2.5;
	const delta = (Math.random() * 2 - 1) * maxStep;
	return Math.round(Math.max(base - range, Math.min(base + range, prev + delta)));
}

function nextLista(prev: ListaVals): ListaVals {
	const d5 = stepClamp(324, 0.08, prev.d5);
	const hoje = stepClamp(221, 0.10, prev.hoje);
	const semContato = stepClamp(107, 0.12, prev.semContato);
	const semTelefone = semContato - 15;
	const comAcao = CARTEIRA - ENCERRADOS - d5 - hoje - semContato;
	const foraEsteira = d5 + hoje;
	return { d5, hoje, semContato, semTelefone, comAcao, foraEsteira };
}

function ListaDiaWindow({ active }: { active: boolean }) {
	const [vals, setVals] = useState<ListaVals>(INITIAL_LISTA);
	const display = useAnimatedValues(vals, 900, active);

	useEffect(() => {
		if (!active) return;
		const id = setInterval(() => setVals((prev) => nextLista(prev)), 2800);
		return () => clearInterval(id);
	}, [active]);

	const kpis = [
		{ label: 'Carteira avaliada', value: CARTEIRA, pct: null as number | null, dot: null as string | null, pctColor: null as string | null, fixed: true },
		{ label: 'Com ação', value: display.comAcao, pct: (display.comAcao / CARTEIRA) * 100, dot: '#34C759', pctColor: '#248A3D', fixed: false },
		{ label: 'Fora pela esteira', value: display.foraEsteira, pct: (display.foraEsteira / CARTEIRA) * 100, dot: '#FF9500', pctColor: null, fixed: false },
		{ label: 'Sem contato', value: display.semContato, pct: (display.semContato / CARTEIRA) * 100, dot: '#FF3B30', pctColor: null, fixed: false },
	];

	const linhas = [
		{ titulo: 'Com ação hoje', legenda: 'Liberados para todos os canais', cor: '#34C759', value: display.comAcao, barValue: vals.comAcao },
		{ titulo: 'Esteira sem passo no D+5', legenda: 'Regra da esteira', cor: '#FF9500', value: display.d5, barValue: vals.d5 },
		{ titulo: 'Esteira sem passo hoje (D+2)', legenda: 'Regra da esteira', cor: '#FF9500', value: display.hoje, barValue: vals.hoje },
		{ titulo: 'Sem telefone válido', legenda: 'Agente virtual · Discador', cor: '#FF3B30', value: display.semTelefone, barValue: vals.semTelefone },
	];
	const maxQtd = vals.comAcao;

	return (
		<div className="overflow-hidden rounded-[14px] bg-white" style={{ boxShadow: cardShadow }}>
			<div className="flex items-center gap-2 border-b border-[#E5E5EA] bg-[#F5F5F7] px-4 py-3">
				<span className="h-3 w-3 rounded-full bg-[#FF5F57]" />
				<span className="h-3 w-3 rounded-full bg-[#FEBC2E]" />
				<span className="h-3 w-3 rounded-full bg-[#28C840]" />
				<span className="ml-3 text-[12px] text-[#6E6E73]">motorcob.online</span>
			</div>
			<div className="p-5 md:p-6">
				<div className="flex flex-wrap items-baseline justify-between gap-2">
					<h4 className="ls-tight text-[18px] font-bold text-[#1D1D1F]">Lista do dia</h4>
					<span className="text-[12px] text-[#6E6E73]">Banco X · Assessoria Demo · 5 de outubro</span>
				</div>
				<div className="mt-5 grid grid-cols-2 gap-2.5 md:grid-cols-4">
					{kpis.map((k) => (
						<div key={k.label} className="rounded-[12px] bg-[#F5F5F7] p-3.5">
							<div className="flex items-center gap-1.5">
								{k.dot && <span className="inline-block h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: k.dot }} />}
								<p className="text-[12px] text-[#6E6E73]">{k.label}</p>
							</div>
							<div className="mt-1 flex items-baseline gap-1.5">
								<p className="tnum ls-tight text-[22px] font-bold text-[#1D1D1F]">
									{k.fixed ? k.value.toLocaleString('pt-BR') : Math.round(k.value).toLocaleString('pt-BR')}
								</p>
								{k.pct !== null && (
									<p className="tnum text-[12px]" style={{ color: k.pctColor ?? '#6E6E73' }}>
										{k.pct.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%
									</p>
								)}
							</div>
						</div>
					))}
				</div>
				<div className="mt-5 divide-y divide-[#E5E5EA]">
					{linhas.map((l, i) => (
						<div key={i} className="grid items-center gap-2 py-2.5" style={{ gridTemplateColumns: '8px 1fr 96px 48px' }}>
							<span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: l.cor }} />
							<div className="min-w-0">
								<p className="truncate text-[14px] text-[#1D1D1F]">{l.titulo}</p>
								<p className="truncate text-[12px] text-[#6E6E73]">{l.legenda}</p>
							</div>
							<div className="h-1 w-full overflow-hidden rounded-full bg-[#E5E5EA]">
								<div className="h-full rounded-full" style={{ width: `${Math.max(3, (l.barValue / maxQtd) * 100)}%`, backgroundColor: l.cor, transition: 'width 0.9s ease-out' }} />
							</div>
							<p className="tnum text-right text-[14px] font-semibold text-[#1D1D1F]">{Math.round(l.value).toLocaleString('pt-BR')}</p>
						</div>
					))}
				</div>
			</div>
		</div>
	);
}

function Pill({ label, color }: { label: string; color: string }) {
	return (
		<span
			className="inline-flex max-w-full items-center rounded-[8px] px-2 py-1 text-[11.5px] font-semibold text-white whitespace-nowrap overflow-hidden text-ellipsis"
			style={{ backgroundColor: color }}
		>
			{label}
		</span>
	);
}

function OrquestracaoWindow() {
	type Item = { t?: string; c?: string; senao?: boolean; reserva?: boolean };
	const cols: { dia: string; semAcao?: boolean; itens?: Item[] }[] = [
		{ dia: 'D+1', itens: [{ t: 'WhatsApp', c: '#1F8A4C' }, { senao: true }, { t: 'SMS', c: '#7A4FB0' }] },
		{ dia: 'D+2', semAcao: true },
		{ dia: 'D+3', itens: [{ t: 'RCS', c: '#3B5BA9' }, { senao: true }, { t: 'SMS', c: '#7A4FB0' }] },
		{ dia: 'D+5', itens: [{ t: 'Agente virtual', c: '#0E7C86' }, { reserva: true }, { t: 'Discador', c: '#475569' }] },
	];
	return (
		<div className="overflow-hidden rounded-[14px] bg-white" style={{ boxShadow: cardShadow }}>
			<div className="border-b border-[#E5E5EA] bg-[#F5F5F7] px-4 py-3">
				<span className="text-[12px] text-[#6E6E73]">Orquestração · Atraso recente</span>
			</div>
			<div className="p-5">
				<p className="text-[14px] font-semibold text-[#1D1D1F]">Cliente novo · ainda não deu CPC</p>
				<div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
					{cols.map((col) => (
						<div key={col.dia} className="rounded-[10px] bg-[#F5F5F7] p-3">
							<p className="text-[12px] font-semibold text-[#6E6E73]">{col.dia}</p>
							<div className="mt-2 space-y-1.5">
								{col.semAcao ? (
									<span className="inline-block rounded-[8px] bg-[#C7C7CC] px-2 py-1 text-[11.5px] font-semibold text-white">sem ação</span>
								) : col.itens?.map((it, i) => (
									it.senao ? <p key={i} className="text-[11px] text-[#8E8E93]">senão</p>
									: it.reserva ? <p key={i} className="text-[11px] text-[#8E8E93]">reserva</p>
									: <Pill key={i} label={it.t!} color={it.c!} />
								))}
							</div>
						</div>
					))}
				</div>
			</div>
		</div>
	);
}

function PhoneMockup() {
	return (
		<div className="mx-auto" style={{ width: 230 }}>
			<div className="rounded-[28px] p-2" style={{ backgroundColor: '#3A3A3C' }}>
				<div className="overflow-hidden rounded-[20px]" style={{ backgroundColor: '#F2F2F7' }}>
					<div className="flex items-center gap-2 px-3 py-3">
						<span className="flex h-[26px] w-[26px] items-center justify-center rounded-full text-[11px] font-bold text-white" style={{ backgroundColor: '#3B5BA9' }}>AD</span>
						<p className="min-w-0 flex-1 truncate text-[13px] font-semibold text-[#1D1D1F]">Assessoria Demo</p>
						<span className="flex h-5 w-5 items-center justify-center rounded-full text-white" style={{ backgroundColor: '#0A84FF' }}>
							<Check className="h-3 w-3" strokeWidth={3} />
						</span>
					</div>
					<div className="mx-3 mb-4 rounded-[14px] bg-white p-3" style={{ boxShadow: cardShadow }}>
						<div className="h-[96px] w-full rounded-[10px]" style={{ background: 'linear-gradient(135deg, #3B5BA9, #9DB4E0)' }} />
						<p className="mt-3 text-[13px] font-semibold text-[#1D1D1F]">Condição especial para o seu contrato</p>
						<p className="mt-1 text-[12px] text-[#6E6E73]">Quite com desconto até sexta.</p>
						<div className="mt-3 space-y-2">
							<button className="block w-full rounded-[9px] py-2 text-[12px] font-semibold text-white" style={{ backgroundColor: '#0A60D0' }}>Negociar agora</button>
							<button className="block w-full rounded-[9px] py-2 text-[12px] font-semibold text-white" style={{ backgroundColor: '#0A60D0' }}>Ligar</button>
							<button className="block w-full rounded-[9px] py-2 text-[12px] font-semibold text-white" style={{ backgroundColor: '#0A60D0' }}>Lembrar no vencimento</button>
						</div>
					</div>
				</div>
			</div>
		</div>
	);
}

function WorkspaceCard() {
	const rows = [
		{ dot: '#34C759', text: '1.869 clientes entram em ação hoje' },
		{ dot: '#FF9500', text: 'O suporte respondeu o chamado MC-2026-000142' },
		{ dot: '#AEAEB2', text: 'Fatura de outubro vence em 10 de novembro' },
	];
	return (
		<div className="mx-auto max-w-[420px] rounded-[16px] bg-white p-6" style={{ boxShadow: cardShadow }}>
			<p className="text-[24px] font-bold text-[#1D1D1F]">Bom dia, Marcos.</p>
			<div className="mt-4 rounded-[12px] border border-[#E5E5EA] px-4 py-3 text-[15px] text-[#8E8E93]">O que você quer fazer?</div>
			<div className="mt-5 space-y-4">
				{rows.map((r) => (
					<div key={r.text} className="flex items-center gap-3">
						<span className="block h-[7px] w-[7px] shrink-0 rounded-full" style={{ backgroundColor: r.dot }} />
						<p className="text-[15px] text-[#1D1D1F]">{r.text}</p>
					</div>
				))}
			</div>
		</div>
	);
}

function SuporteCard() {
	return (
		<div className="mx-auto max-w-[460px] rounded-[16px] bg-white p-6" style={{ boxShadow: cardShadow }}>
			<p className="text-[17px] font-semibold text-[#1D1D1F]">Carga do Banco X rejeitada</p>
			<p className="mt-1 text-[13px] text-[#6E6E73]">MC-2026-000142 · Envio de arquivos</p>
			<div className="mt-4 space-y-3">
				<div className="rounded-[12px] px-4 py-3" style={{ backgroundColor: '#F5F5F7' }}>
					<p className="text-[12px] font-semibold text-[#6E6E73]">Ana Ribeiro</p>
					<p className="mt-0.5 text-[14px] text-[#1D1D1F]">A carga de segunda voltou como rejeitada.</p>
					<div className="mt-2 inline-flex items-center gap-1.5 rounded-[8px] bg-white px-2.5 py-1.5 text-[12px] text-[#1D1D1F]" style={{ boxShadow: '0 0 0 1px #E5E5EA' }}>
						<Paperclip className="h-3.5 w-3.5 text-[#6E6E73]" />
						carga_banco_x.csv
					</div>
				</div>
				<div className="rounded-[12px] bg-white px-4 py-3" style={{ boxShadow: '0 1px 4px rgba(0,0,0,.08)' }}>
					<p className="text-[12px] font-semibold text-[#6E6E73]">Suporte MotorCX</p>
					<p className="mt-0.5 text-[14px] text-[#1D1D1F]">Ajustamos o mapeamento. Pode reenviar?</p>
				</div>
			</div>
		</div>
	);
}

function CargaOpcoes() {
	return (
		<div>
			<div className="grid gap-4 sm:grid-cols-2">
				<div className="rounded-[16px] bg-white p-5" style={{ border: '1.5px solid #1D1D1F', boxShadow: cardShadow }}>
					<p className="text-[17px] font-semibold text-[#1D1D1F]">Arquivo</p>
					<p className="mt-1.5 text-[14px] leading-relaxed text-[#6E6E73]">CSV, TXT ou XLSX, do jeito que o credor manda</p>
				</div>
				<div className="rounded-[16px] p-5" style={{ backgroundColor: '#F5F5F7' }}>
					<p className="text-[17px] font-semibold text-[#1D1D1F]">API</p>
					<p className="mt-1.5 font-mono text-[13px] text-[#6E6E73]">POST /v1/credores/102/cargas</p>
				</div>
			</div>
			<p className="mt-4 text-center text-[14px] text-[#6E6E73]">Mesmo relatório nos dois: linhas aceitas, rejeitadas e o motivo.</p>
		</div>
	);
}

// Visuais dos slides 02–06 (o slide 01 é a ListaDiaWindow, que recebe `active`).
const visuals = [
	null,
	<OrquestracaoWindow key="02" />,
	<PhoneMockup key="03" />,
	<WorkspaceCard key="04" />,
	<SuporteCard key="05" />,
	<CargaOpcoes key="06" />,
];

export function Carrossel() {
	const railRef = useRef<HTMLDivElement>(null);
	const blockRef = useRef<HTMLDivElement>(null);
	const fillRef = useRef<HTMLSpanElement>(null);
	const [active, setActive] = useState(0);
	const [manualPause, setManualPause] = useState(false);
	const [visible, setVisible] = useState(true);
	const [reduceMotion, setReduceMotion] = useState(false);

	const activeRef = useRef(0);
	const elapsedRef = useRef(0);
	const manualPauseRef = useRef(false);
	const hoverRef = useRef(false);
	const focusRef = useRef(false);
	const intersectRef = useRef(true);
	const tabRef = useRef(true);
	const reduceRef = useRef(false);
	const goToRef = useRef<(i: number) => void>(() => {});

	useEffect(() => {
		manualPauseRef.current = manualPause;
	}, [manualPause]);
	useEffect(() => {
		intersectRef.current = visible;
	}, [visible]);
	useEffect(() => {
		reduceRef.current = reduceMotion;
	}, [reduceMotion]);

	// prefers-reduced-motion
	useEffect(() => {
		const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
		setReduceMotion(mq.matches);
		const onChange = () => setReduceMotion(mq.matches);
		mq.addEventListener('change', onChange);
		return () => mq.removeEventListener('change', onChange);
	}, []);

	const goTo = useCallback((i: number) => {
		const rail = railRef.current;
		if (!rail) return;
		const clamped = Math.max(0, Math.min(slides.length - 1, i));
		const behavior = reduceRef.current ? 'auto' : 'smooth';
		rail.scrollTo({ left: clamped * rail.clientWidth, behavior });
		elapsedRef.current = 0;
		if (fillRef.current) fillRef.current.style.transform = 'scaleX(0)';
		activeRef.current = clamped;
		setActive(clamped);
	}, []);
	useEffect(() => {
		goToRef.current = goTo;
	}, [goTo]);

	// Passagem automática (6 s) com preenchimento do ponto atual.
	useEffect(() => {
		if (reduceMotion) return;
		let last = performance.now();
		let raf = 0;
		const tick = (now: number) => {
			const dt = now - last;
			last = now;
			const paused =
				manualPauseRef.current ||
				hoverRef.current ||
				focusRef.current ||
				!intersectRef.current ||
				!tabRef.current;
			if (!paused) {
				elapsedRef.current += dt;
				if (elapsedRef.current >= 6000) {
					elapsedRef.current = 0;
					goToRef.current((activeRef.current + 1) % slides.length);
				}
				const p = Math.min(1, elapsedRef.current / 6000);
				if (fillRef.current) fillRef.current.style.transform = `scaleX(${p})`;
			}
			raf = requestAnimationFrame(tick);
		};
		raf = requestAnimationFrame(tick);
		return () => cancelAnimationFrame(raf);
	}, [reduceMotion]);

	// Arraste: ao mudar de slide, o tempo recomeça do zero.
	useEffect(() => {
		const rail = railRef.current;
		if (!rail) return;
		let t: ReturnType<typeof setTimeout>;
		const onScroll = () => {
			clearTimeout(t);
			t = setTimeout(() => {
				const idx = Math.round(rail.scrollLeft / rail.clientWidth);
				const clamped = Math.max(0, Math.min(slides.length - 1, idx));
				if (clamped !== activeRef.current) {
					elapsedRef.current = 0;
					if (fillRef.current) fillRef.current.style.transform = 'scaleX(0)';
					activeRef.current = clamped;
					setActive(clamped);
				}
			}, 90);
		};
		rail.addEventListener('scroll', onScroll, { passive: true });
		return () => {
			rail.removeEventListener('scroll', onScroll);
			clearTimeout(t);
		};
	}, []);

	// Redimensionamento: mantém o slide atual.
	useEffect(() => {
		const onResize = () => {
			const rail = railRef.current;
			if (!rail) return;
			rail.scrollTo({ left: activeRef.current * rail.clientWidth, behavior: 'auto' });
		};
		window.addEventListener('resize', onResize);
		return () => window.removeEventListener('resize', onResize);
	}, []);

	// Aba escondida pausa a passagem.
	useEffect(() => {
		const onVis = () => {
			tabRef.current = !document.hidden;
		};
		document.addEventListener('visibilitychange', onVis);
		return () => document.removeEventListener('visibilitychange', onVis);
	}, []);

	// < 40% visível pausa a passagem.
	useEffect(() => {
		const block = blockRef.current;
		if (!block) return;
		const io = new IntersectionObserver(
			(entries) => {
				const e = entries[0];
				const vis = e.intersectionRatio >= 0.4;
				intersectRef.current = vis;
				setVisible(vis);
			},
			{ threshold: [0, 0.4, 1] },
		);
		io.observe(block);
		return () => io.disconnect();
	}, []);

	// Foco do teclado dentro do carrossel pausa a passagem.
	useEffect(() => {
		const block = blockRef.current;
		if (!block) return;
		const onFocusIn = () => {
			focusRef.current = true;
		};
		const onFocusOut = () => {
			focusRef.current = false;
		};
		block.addEventListener('focusin', onFocusIn);
		block.addEventListener('focusout', onFocusOut);
		return () => {
			block.removeEventListener('focusin', onFocusIn);
			block.removeEventListener('focusout', onFocusOut);
		};
	}, []);

	const onKeyDown = (e: React.KeyboardEvent) => {
		if (e.key === 'ArrowLeft') {
			e.preventDefault();
			goTo(activeRef.current - 1);
		} else if (e.key === 'ArrowRight') {
			e.preventDefault();
			goTo(activeRef.current + 1);
		}
	};

	const listaActive = visible && !manualPause && !reduceMotion;

	return (
		<div id="plataforma" className="scroll-mt-[92px] md:scroll-mt-[64px]">
			<div
				ref={blockRef}
				className="mx-auto rounded-[20px] bg-black pt-9 pb-10 md:rounded-[28px] md:pt-14"
				style={{ width: 'min(1180px, 100vw - 32px)' }}
				onMouseEnter={() => {
					hoverRef.current = true;
				}}
				onMouseLeave={() => {
					hoverRef.current = false;
				}}
			>
				<h2 className="ls-tight mb-7 text-center text-[26px] font-bold md:text-[40px]" style={{ letterSpacing: '-0.03em' }}>
					<span style={{ color: '#F5F5F7' }}>Uma plataforma.</span>
					<span style={{ color: '#86868B' }}> Seis funções.</span>
				</h2>
				<div
					ref={railRef}
					tabIndex={0}
					onKeyDown={onKeyDown}
					role="group"
					aria-label="Plataforma MotorCX — slides"
					className="no-scrollbar flex snap-x snap-mandatory overflow-x-auto rounded-[18px] outline-none focus-visible:ring-2 focus-visible:ring-[#C9A35A]"
					style={{ scrollbarWidth: 'none' }}
				>
					{slides.map((s, i) => (
						<div key={s.num} className="w-full shrink-0 snap-start px-0.5">
							<div className="grid h-full items-start gap-8 rounded-[18px] bg-[#1C1C1E] p-5 md:grid-cols-[0.8fr_1.2fr] md:gap-8 md:p-10">
								<div>
									<p className="text-[13px] font-semibold text-[#C9A35A]">{s.num}</p>
									<h3 className="ls-tight mt-2 font-bold text-[#F5F5F7]" style={{ fontSize: '36px', letterSpacing: '-0.03em', lineHeight: 1.1 }}>{s.titulo}</h3>
									<p className="mt-3 text-[17px] leading-relaxed text-[#A1A1A6]">{s.texto}</p>
								</div>
								<div className="min-w-0">{i === 0 ? <ListaDiaWindow active={listaActive} /> : visuals[i]}</div>
							</div>
						</div>
					))}
				</div>

				<div className="mt-6 flex items-center justify-center gap-3">
					<button
						type="button"
						aria-label="Anterior"
						disabled={active === 0}
						onClick={() => goTo(active - 1)}
						className="flex h-9 w-9 items-center justify-center rounded-full bg-[rgba(255,255,255,0.12)] text-[#F5F5F7] transition-colors hover:bg-[rgba(255,255,255,0.22)] disabled:opacity-35"
					>
						‹
					</button>
					<div className="flex items-center gap-2">
						{slides.map((_, i) => (
							<button
								key={i}
								type="button"
								aria-label={`Slide ${i + 1}`}
								aria-selected={i === active}
								onClick={() => goTo(i)}
								className="flex h-4 items-center justify-center"
							>
								<span
									className="relative block overflow-hidden rounded-full"
									style={{ width: i === active ? 24 : 8, height: 8, backgroundColor: i === active ? '#F5F5F7' : '#48484A' }}
								>
									{i === active && (
										<span
											ref={fillRef}
											className="absolute inset-0 block rounded-full"
											style={{ backgroundColor: '#C9A35A', transformOrigin: 'left center', transform: 'scaleX(0)' }}
										/>
									)}
								</span>
							</button>
						))}
					</div>
					<button
						type="button"
						aria-label="Próximo"
						disabled={active === slides.length - 1}
						onClick={() => goTo(active + 1)}
						className="flex h-9 w-9 items-center justify-center rounded-full bg-[rgba(255,255,255,0.12)] text-[#F5F5F7] transition-colors hover:bg-[rgba(255,255,255,0.22)] disabled:opacity-35"
					>
						›
					</button>
					{!reduceMotion && (
						<button
							type="button"
							aria-label={manualPause ? 'Continuar a passagem automática' : 'Pausar a passagem automática'}
							aria-pressed={manualPause}
							onClick={() => setManualPause((p) => !p)}
							className="flex h-9 w-9 items-center justify-center rounded-full bg-[rgba(255,255,255,0.12)] text-[#F5F5F7] transition-colors hover:bg-[rgba(255,255,255,0.22)]"
						>
							{manualPause ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />}
						</button>
					)}
				</div>
			</div>
		</div>
	);
}
