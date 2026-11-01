// Gráficos do Speech Analytics em SVG próprio (sem biblioteca), com os tokens do tema para valer no claro e no escuro.
// Série 1 = agente de IA (var(--area)); série 2 = humano/discador (var(--estado-info)). Valor nulo (grupo < 30) = buraco.
import type { ReactNode } from 'react';
import { dataBR, dc } from '@/lib/speech';

export const COR_IA = 'var(--area)';
export const COR_HUMANO = 'var(--estado-info)';
export const COR_NEUTRA = 'var(--base-texto-3)';

export type Serie = { nome: string; cor: string; valores: (number | null)[] };

export function Legenda({ itens }: { itens: { nome: string; cor: string; linha?: boolean }[] }) {
	return (
		<div className="flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-[var(--base-texto-2)]">
			{itens.map(i => (
				<span key={i.nome} className="inline-flex items-center gap-1.5">
					<i className={i.linha ? 'inline-block h-[3px] w-4 rounded-full' : 'inline-block h-2.5 w-2.5 rounded-full'} style={{ backgroundColor: i.cor }} />
					{i.nome}
				</span>
			))}
		</div>
	);
}

/** Linha por semana. min/max fixos por métrica (uma escala só); `meta` desenha a linha tracejada. */
export function LinhaSemanas(p: {
	x: string[]; series: Serie[]; min: number; max: number; ticks: number[]; fmt: (v: number) => string; meta?: number; altura?: number; rotulo: string;
}) {
	// No celular, outra proporção (mais alta e estreita) para o texto dos eixos não ficar minúsculo.
	return <><div className="hidden sm:block"><LinhaSvg {...p} W={600} /></div><div className="sm:hidden"><LinhaSvg {...p} W={360} altura={220} /></div></>;
}

function LinhaSvg({ x, series, min, max, ticks, fmt, meta, altura = 190, rotulo, W }: {
	x: string[]; series: Serie[]; min: number; max: number; ticks: number[]; fmt: (v: number) => string; meta?: number; altura?: number; rotulo: string; W: number;
}) {
	const H = altura, l = 40, r = 10, t = 10, b = 24;
	const px = (i: number) => l + (x.length <= 1 ? 0 : (i * (W - l - r)) / (x.length - 1));
	const py = (v: number) => t + (1 - (Math.min(max, Math.max(min, v)) - min) / (max - min || 1)) * (H - t - b);
	const caminho = (vs: (number | null)[]) => {
		let d = '';
		let aberto = false;
		vs.forEach((v, i) => {
			if (v == null) { aberto = false; return; }
			d += `${aberto ? 'L' : 'M'}${px(i).toFixed(1)} ${py(v).toFixed(1)} `;
			aberto = true;
		});
		return d;
	};
	return (
		<svg viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full" role="img" aria-label={rotulo}>
			{ticks.map(tk => (
				<g key={tk}>
					<line x1={l} x2={W - r} y1={py(tk)} y2={py(tk)} stroke="var(--base-borda)" strokeWidth={1} />
					<text x={l - 6} y={py(tk) + 4} textAnchor="end" fontSize={11} fill="var(--base-texto-3)">{fmt(tk)}</text>
				</g>
			))}
			{meta != null && <line x1={l} x2={W - r} y1={py(meta)} y2={py(meta)} stroke="var(--base-texto-2)" strokeDasharray="4 4" strokeWidth={1.2} />}
			{x.map((s, i) => (i % Math.ceil(x.length / (W < 500 ? 3 : 6)) === 0 || i === x.length - 1) && (
				<text key={s} x={px(i)} y={H - 6} textAnchor={i === 0 ? 'start' : i === x.length - 1 ? 'end' : 'middle'} fontSize={11} fill="var(--base-texto-3)">{s}</text>
			))}
			{series.map(s => (
				<g key={s.nome}>
					<path d={caminho(s.valores)} fill="none" stroke={s.cor} strokeWidth={2.2} strokeLinejoin="round" strokeLinecap="round" />
					{s.valores.map((v, i) => v != null && <circle key={i} cx={px(i)} cy={py(v)} r={2.6} fill={s.cor}><title>{`${s.nome} · ${x[i]}: ${fmt(v)}`}</title></circle>)}
				</g>
			))}
		</svg>
	);
}

/** A mesma série em tabela (alternativa acessível ao gráfico). */
export function TabelaSemanas({ x, series, fmt }: { x: string[]; series: Serie[]; fmt: (v: number) => string }) {
	return (
		<div className="overflow-x-auto">
			<table className="w-full border-collapse text-[12.5px]">
				<thead><tr className="text-left text-[11px] uppercase tracking-wide text-[var(--base-texto-3)]"><th className="px-2 py-1.5">Semana</th>{series.map(s => <th key={s.nome} className="px-2 py-1.5 text-right">{s.nome}</th>)}</tr></thead>
				<tbody>{x.map((d, i) => <tr key={d} className="border-t" style={{ borderColor: 'var(--base-borda)' }}><td className="px-2 py-1.5">{d}</td>{series.map(s => <td key={s.nome} className="px-2 py-1.5 text-right tnum">{s.valores[i] == null ? <span className="text-[var(--base-texto-3)]">&lt;30</span> : fmt(s.valores[i] as number)}</td>)}</tr>)}</tbody>
			</table>
		</div>
	);
}

export function Faisca({ valores, cor = COR_IA, altura = 34 }: { valores: (number | null)[]; cor?: string; altura?: number }) {
	const vs = valores.filter((v): v is number => v != null);
	if (vs.length < 2) return null;
	const mn = Math.min(...vs), mx = Math.max(...vs);
	const W = 120;
	const pts = valores.map((v, i) => (v == null ? null : `${((i * W) / (valores.length - 1)).toFixed(1)},${(altura - 2 - ((v - mn) / (mx - mn || 1)) * (altura - 4)).toFixed(1)}`)).filter(Boolean);
	return <svg viewBox={`0 0 ${W} ${altura}`} className="block h-[34px] w-full" preserveAspectRatio="none" aria-hidden="true"><polyline points={pts.join(' ')} fill="none" stroke={cor} strokeWidth={2} vectorEffect="non-scaling-stroke" /></svg>;
}

/** Barra horizontal com rótulo, valor e detalhe; valor nulo = "menos de 30". */
export function BarraH({ nome, valor, max, cor = COR_IA, detalhe, fmt = v => `${dc(v)}%` }: { nome: ReactNode; valor: number | null; max: number; cor?: string; detalhe?: ReactNode; fmt?: (v: number) => string }) {
	const w = valor == null || max <= 0 ? 0 : Math.min(100, (100 * valor) / max);
	return (
		<div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)_auto] items-center gap-3 py-1 text-[13px]">
			<span className="min-w-0 truncate text-[var(--base-texto)]">{nome}</span>
			<span className="h-2 w-full overflow-hidden rounded-full bg-[var(--base-fill)]"><span className="block h-full rounded-full" style={{ width: `${w}%`, backgroundColor: cor }} /></span>
			<b className="whitespace-nowrap text-right tnum text-[var(--base-texto)]">{valor == null ? <span className="font-normal text-[var(--base-texto-3)]">menos de 30</span> : fmt(valor)}{detalhe && <small className="ml-1 font-normal text-[var(--base-texto-3)]">{detalhe}</small>}</b>
		</div>
	);
}

/** Dois pontos na mesma escala de 0 a 100 (IA × humano; com acordo × sem acordo). */
export function Halter({ nome, sub, a, b, corA = COR_IA, corB = COR_HUMANO, texto }: { nome: ReactNode; sub?: ReactNode; a: number | null; b: number | null; corA?: string; corB?: string; texto?: ReactNode }) {
	const lo = a != null && b != null ? Math.min(a, b) : null, hi = a != null && b != null ? Math.max(a, b) : null;
	return (
		<div className="grid grid-cols-1 gap-1 py-1.5 text-[13px] sm:grid-cols-[minmax(0,1.1fr)_minmax(0,1.4fr)_auto] sm:items-center sm:gap-3">
			<span className="min-w-0 text-[var(--base-texto)]">{nome}{sub && <small className="block text-[11.5px] text-[var(--base-texto-3)]">{sub}</small>}</span>
			<span className="relative h-3 w-full">
				<span className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-[var(--base-borda)]" />
				{lo != null && hi != null && <span className="absolute top-1/2 h-[3px] -translate-y-1/2 rounded-full bg-[var(--base-texto-3)] opacity-50" style={{ left: `${lo}%`, width: `${hi - lo}%` }} />}
				{a != null && <span className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full" style={{ left: `${Math.min(100, a)}%`, backgroundColor: corA }} title={dc(a)} />}
				{b != null && <span className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full" style={{ left: `${Math.min(100, b)}%`, backgroundColor: corB }} title={dc(b)} />}
			</span>
			<span className="whitespace-nowrap text-right tnum text-[12.5px] text-[var(--base-texto-2)]">{texto ?? <><b className="text-[var(--base-texto)]">{a == null ? '<30' : dc(a)}</b> × <b className="text-[var(--base-texto)]">{b == null ? '<30' : dc(b)}</b></>}</span>
		</div>
	);
}

/** Faixa de estimativa (mínimo–máximo) com marca no centro. */
export function FaixaEstimativa({ min, centro, max }: { min: number; centro: number; max: number }) {
	const teto = Math.max(1, max * 1.25);
	return (
		<div className="relative mt-2 h-2 w-full rounded-full bg-[var(--base-fill)]" title={`faixa de ${min} a ${max}`}>
			<i className="absolute inset-y-0 rounded-full opacity-40" style={{ left: `${(100 * min) / teto}%`, width: `${(100 * (max - min)) / teto}%`, backgroundColor: COR_IA }} />
			<u className="absolute -top-1 h-4 w-[2px]" style={{ left: `${(100 * centro) / teto}%`, backgroundColor: 'var(--base-texto)' }} />
		</div>
	);
}

export const semanaRotulo = (iso: string) => dataBR(iso);
