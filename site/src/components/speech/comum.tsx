// Peças comuns das telas do Speech Analytics: filtros, bloqueio (sem permissão / grupo pequeno), modal e alternância.
import { useEffect, useRef, type ReactNode } from 'react';
import { Lock } from 'lucide-react';
import { ORIGENS, PERIODOS } from '@/lib/speech';
import { Botao, campoCls, campoStyle } from '@/components/voz/ui';

export type Filtros = { empresaId: number; credorId: number | null; credorNome: string | null; dias: number; de: string; ate: string; origem: string };

export function BarraFiltros({ dias, setDias, origem, setOrigem, credorNome, extra, semOrigem }: {
	dias: number; setDias: (d: number) => void; origem: string; setOrigem: (o: string) => void; credorNome: string | null; extra?: ReactNode; semOrigem?: boolean;
}) {
	return (
		<div className="mb-4 flex flex-wrap items-center gap-2">
			<select aria-label="Período" value={dias} onChange={e => setDias(Number(e.target.value))} className={`${campoCls} max-w-full`} style={campoStyle}>{PERIODOS.map(p => <option key={p.d} value={p.d}>{p.n}</option>)}</select>
			{!semOrigem && <select aria-label="Origem" value={origem} onChange={e => setOrigem(e.target.value)} className={`${campoCls} max-w-full`} style={campoStyle}>{ORIGENS.map(o => <option key={o.v} value={o.v}>{o.n}</option>)}</select>}
			{extra}
			<span className="text-[12px] text-[var(--base-texto-3)]">{credorNome ? `Carteira ${credorNome}` : 'Todas as carteiras'} · grupos com menos de 30 ligações não aparecem</span>
		</div>
	);
}

/** Página de bloqueio: sem permissão ou recorte pequeno demais. */
export function Bloqueio({ titulo, children, acao }: { titulo: string; children?: ReactNode; acao?: ReactNode }) {
	return (
		<div className="rounded-2xl bg-[var(--base-cartao)] px-6 py-10 text-center" style={{ boxShadow: '0 0 0 1px var(--base-borda)' }}>
			<span className="mx-auto grid h-11 w-11 place-items-center rounded-full bg-[var(--base-fill)] text-[var(--base-texto-2)]"><Lock size={18} aria-hidden="true" /></span>
			<h2 className="mt-3 text-[16px] font-semibold text-[var(--base-texto)]">{titulo}</h2>
			{children && <p className="mx-auto mt-1.5 max-w-[560px] text-[13px] leading-relaxed text-[var(--base-texto-2)]">{children}</p>}
			{acao && <div className="mt-4 flex flex-wrap justify-center gap-2">{acao}</div>}
		</div>
	);
}

/** Alternância segmentada (aria-pressed). */
export function Segmentos<T extends string>({ itens, valor, onTrocar, rotulo }: { itens: { v: T; n: ReactNode }[]; valor: T; onTrocar: (v: T) => void; rotulo: string }) {
	return (
		<div role="group" aria-label={rotulo} className="inline-flex max-w-full flex-wrap gap-1 rounded-lg bg-[var(--base-fill)] p-1">
			{itens.map(i => (
				<button key={i.v} type="button" aria-pressed={valor === i.v} onClick={() => onTrocar(i.v)}
					className={`rounded-md px-2.5 py-1 text-[12.5px] font-semibold ${valor === i.v ? 'bg-[var(--base-cartao)] text-[var(--base-texto)] shadow-sm' : 'text-[var(--base-texto-3)] hover:text-[var(--base-texto)]'}`}>
					{i.n}
				</button>
			))}
		</div>
	);
}

/** Modal simples com foco no primeiro campo e Esc para fechar. */
export function Modal({ titulo, texto, children, onFechar, onConfirmar, confirmar, ocupado, desabilitado }: {
	titulo: string; texto?: ReactNode; children?: ReactNode; onFechar: () => void; onConfirmar: () => void; confirmar: string; ocupado?: boolean; desabilitado?: boolean;
}) {
	const caixa = useRef<HTMLDivElement>(null);
	useEffect(() => {
		const el = caixa.current?.querySelector<HTMLElement>('input, textarea, select, button');
		el?.focus();
		const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onFechar(); };
		document.addEventListener('keydown', esc);
		return () => document.removeEventListener('keydown', esc);
	}, [onFechar]);
	return (
		<div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-label={titulo} onClick={e => { if (e.target === e.currentTarget) onFechar(); }}>
			<div ref={caixa} className="w-full max-w-[460px] rounded-2xl bg-[var(--base-cartao)] p-5" style={{ boxShadow: '0 18px 48px rgba(0,0,0,.25)' }}>
				<h2 className="text-[16px] font-semibold text-[var(--base-texto)]">{titulo}</h2>
				{texto && <p className="mt-1 text-[13px] leading-relaxed text-[var(--base-texto-2)]">{texto}</p>}
				{children && <div className="mt-3 space-y-3">{children}</div>}
				<div className="mt-4 flex flex-wrap justify-end gap-2">
					<Botao secundario onClick={onFechar}>Cancelar</Botao>
					<Botao onClick={onConfirmar} disabled={ocupado || desabilitado}>{ocupado ? 'Aguarde…' : confirmar}</Botao>
				</div>
			</div>
		</div>
	);
}

/** Trecho mascarado (nunca HTML do banco: texto puro). */
export function Trecho({ children }: { children: ReactNode }) {
	return <div className="mt-1.5 rounded-lg border-l-[3px] bg-[var(--base-fill)] px-3 py-2 text-[13px] leading-relaxed text-[var(--base-texto)]" style={{ borderColor: 'var(--base-borda)' }}>{children}</div>;
}

export const textareaCls = 'w-full rounded-lg border bg-[var(--base-cartao)] px-3 py-2 text-[13px] text-[var(--base-texto)] outline-none focus:border-[var(--destaque)]';
