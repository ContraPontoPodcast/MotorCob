// Peças da Renitência (redesign aprovado em renitencia-v2): campos, selos, gaveta, modal e "Detalhes".
// Ficam dentro da pasta da renitência até os componentes de design compartilhados chegarem (outro PR); depois a
// gente unifica. Claro e escuro pelas variáveis do tema; nada aqui tem largura fixa maior que 390 px.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ChevronDown, Lock, X } from 'lucide-react';

export { Toggle } from '../discagem-campos';

export const nf = (n: number) => Math.round(n).toLocaleString('pt-BR');
export const pc = (n: number, d = 1) => `${n.toFixed(d).replace('.', ',')}%`;

export const btn = 'inline-flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-full px-3.5 text-[12.5px] font-semibold disabled:opacity-50';
export const btnSec = `${btn} border text-[var(--base-texto)]`;
export const btnPri = `${btn} text-[var(--destaque-texto)]`;
export const corPri = { backgroundColor: 'var(--destaque)' } as const;
export const borda = { borderColor: 'var(--base-borda)' } as const;
export const cartao = { borderColor: 'var(--base-borda)', backgroundColor: 'var(--base-cartao)' } as const;

export function Num({ valor, min, max, onChange, rotulo, disabled, alterado, largura = 64 }: {
	valor: number; min: number; max: number; onChange: (v: number) => void; rotulo: string; disabled?: boolean; alterado?: boolean; largura?: number;
}) {
	const [txt, setTxt] = useState<string | null>(null);
	return (
		<input
			type="number" inputMode="numeric" aria-label={rotulo} min={min} max={max} disabled={disabled}
			value={txt ?? String(valor)}
			onChange={e => setTxt(e.target.value)}
			onBlur={() => {
				if (txt === null) return;
				const v = Number.parseInt(txt, 10);
				setTxt(null);
				if (Number.isFinite(v)) onChange(Math.min(max, Math.max(min, v)));
			}}
			onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
			className="h-8 rounded-lg border bg-[var(--base-cartao)] px-2 text-[13px] tabular-nums text-[var(--base-texto)] outline-none focus:border-[var(--area)] disabled:opacity-50"
			style={{ width: largura, borderColor: alterado ? 'var(--area)' : 'var(--base-field-border, var(--base-borda))', boxShadow: alterado ? 'inset 0 0 0 1px var(--area)' : undefined }}
		/>
	);
}

export function Hora({ valor, onChange, rotulo, disabled, vazio }: { valor: string | null; onChange: (v: string | null) => void; rotulo: string; disabled?: boolean; vazio?: boolean }) {
	return (
		<input type="time" min="08:00" max="20:00" aria-label={rotulo} disabled={disabled} value={valor ?? ''}
			onChange={e => { const v = e.target.value; if (!v && vazio) onChange(null); else if (v >= '08:00' && v <= '20:00') onChange(v); }}
			className="h-8 w-[104px] rounded-lg border bg-[var(--base-cartao)] px-2 text-[13px] tabular-nums text-[var(--base-texto)] outline-none focus:border-[var(--area)] disabled:opacity-50"
			style={{ borderColor: 'var(--base-field-border, var(--base-borda))' }} />
	);
}

export function Sel<T extends string>({ valor, opcoes, onChange, rotulo, disabled }: {
	valor: T; opcoes: Record<T, string>; onChange: (v: T) => void; rotulo: string; disabled?: boolean;
}) {
	return (
		<select aria-label={rotulo} value={valor} disabled={disabled} onChange={e => onChange(e.target.value as T)}
			className="h-8 max-w-full min-w-0 rounded-lg border bg-[var(--base-cartao)] px-2 text-[13px] text-[var(--base-texto)] outline-none focus:border-[var(--area)] disabled:opacity-50"
			style={{ borderColor: 'var(--base-field-border, var(--base-borda))' }}>
			{(Object.keys(opcoes) as T[]).map(k => <option key={k} value={k}>{opcoes[k]}</option>)}
		</select>
	);
}

export function Un({ children }: { children: ReactNode }) {
	return <span className="text-[12px] text-[var(--base-texto-2)]">{children}</span>;
}

/** Selo de regra fixa (cadeado): o que não é configurável. */
export function Travado({ children, title }: { children: ReactNode; title?: string }) {
	return <span className="inline-flex items-center gap-1 text-[12px] text-[var(--base-texto-2)]" title={title}><Lock size={12} className="shrink-0" />{children}</span>;
}

export function BadgeHoje({ muda }: { muda: boolean }) {
	return muda
		? <span title="O padrão novo muda o que a VM faz hoje" className="inline-flex shrink-0 items-center rounded-full bg-[var(--estado-atencao-fundo)] px-2 py-0.5 text-[10.5px] font-bold text-[var(--estado-atencao-texto)]">muda o hoje</span>
		: <span className="inline-flex shrink-0 items-center rounded-full bg-[var(--base-fill)] px-2 py-0.5 text-[10.5px] font-semibold text-[var(--base-texto-2)]">igual a hoje</span>;
}

export function Tag({ alterado }: { alterado: boolean }) {
	return <span className={`inline-flex shrink-0 rounded-full px-2 py-0.5 text-[10.5px] font-bold ${alterado ? 'bg-[var(--area-fundo,var(--base-fill))] text-[var(--area)]' : 'bg-[var(--base-fill)] text-[var(--base-texto-2)]'}`}>{alterado ? 'alterado' : 'padrão MotorCX'}</span>;
}

/** Ponto de "alteração não salva". */
export function Ponto() {
	return <span title="Alteração não salva" aria-label="Alteração não salva" className="inline-block h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: 'var(--area)' }} />;
}

export function SecaoTitulo({ titulo, linha, direita }: { titulo: ReactNode; linha?: ReactNode; direita?: ReactNode }) {
	return (
		<div className="mb-3 flex flex-wrap items-start gap-x-3 gap-y-2">
			<div className="min-w-[min(100%,260px)] flex-1">
				<h2 className="flex items-center gap-2 text-[16px] font-bold text-[var(--base-texto)]">{titulo}</h2>
				{linha && <p className="mt-0.5 text-[13px] text-[var(--base-texto-2)]">{linha}</p>}
			</div>
			{direita && <div className="flex flex-wrap items-center gap-2">{direita}</div>}
		</div>
	);
}

export function Nota({ tom, children }: { tom: 'info' | 'atencao' | 'ok'; children: ReactNode }) {
	const f = tom === 'info' ? 'var(--estado-info-fundo)' : tom === 'ok' ? 'var(--estado-pronto-fundo, var(--base-fill))' : 'var(--estado-atencao-fundo)';
	const c = tom === 'info' ? 'var(--estado-info)' : tom === 'ok' ? 'var(--estado-pronto)' : 'var(--estado-atencao)';
	return (
		<div className="flex gap-2.5 rounded-xl px-3.5 py-2.5 text-[13px] text-[var(--base-texto)]" style={{ backgroundColor: f }}>
			<span className="grid h-5 w-5 shrink-0 place-items-center rounded-full text-[11px] font-extrabold text-[var(--base-cartao)]" style={{ backgroundColor: c }}>{tom === 'info' ? 'i' : tom === 'ok' ? '✓' : '!'}</span>
			<div className="min-w-0">{children}</div>
		</div>
	);
}

export function Secao({ children, id }: { children: ReactNode; id?: string }) {
	return <section id={id} className="min-w-0 rounded-2xl border p-4 sm:p-5" style={cartao}>{children}</section>;
}

/** "Detalhes": texto secundário recolhido. */
export function Detalhes({ resumo, children }: { resumo: string; children: ReactNode }) {
	return (
		<details className="group text-[12.5px] text-[var(--base-texto-2)]">
			<summary className="inline-flex cursor-pointer list-none items-center gap-1 font-semibold text-[var(--estado-info)]"><ChevronDown size={13} className="transition-transform group-open:rotate-180" />{resumo}</summary>
			<div className="mt-1.5">{children}</div>
		</details>
	);
}

export function Chip({ ativo, onClick, children, travado, title }: { ativo: boolean; onClick?: () => void; children: ReactNode; travado?: boolean; title?: string }) {
	return (
		<button type="button" aria-pressed={ativo} aria-disabled={travado || undefined} title={title} onClick={travado ? undefined : onClick}
			className={`inline-flex h-8 max-w-full items-center gap-1.5 rounded-full border px-3 text-[13px] font-semibold ${travado ? 'cursor-default opacity-80' : ''}`}
			style={ativo ? { backgroundColor: 'var(--base-texto)', color: 'var(--base-cartao)', borderColor: 'var(--base-texto)' } : { borderColor: 'var(--base-borda)', color: 'var(--base-texto-2)' }}>
			{travado && <Lock size={12} className="shrink-0" />}{children}
		</button>
	);
}

function useEsc(onClose: () => void) {
	useEffect(() => {
		const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
		window.addEventListener('keydown', h);
		return () => window.removeEventListener('keydown', h);
	}, [onClose]);
}

export function Modal({ titulo, children, onClose, largo }: { titulo: string; children: ReactNode; onClose: () => void; largo?: boolean }) {
	useEsc(onClose);
	return (
		<div className="fixed inset-0 z-[120] grid place-items-center overflow-y-auto bg-black/40 px-4 py-8" onClick={onClose}>
			<div role="dialog" aria-modal="true" aria-label={titulo} className={`my-auto flex w-full ${largo ? 'max-w-[640px]' : 'max-w-[520px]'} min-w-0 flex-col gap-3 rounded-2xl border p-5 text-[var(--base-texto)]`} style={{ ...cartao, boxShadow: '0 18px 48px rgba(0,0,0,.25)' }} onClick={e => e.stopPropagation()}>
				<h2 className="text-[17px] font-bold">{titulo}</h2>
				{children}
			</div>
		</div>
	);
}

/** Gaveta lateral (no celular ocupa a tela toda). */
export function Gaveta({ titulo, children, rodape, onClose, larga }: { titulo: string; children: ReactNode; rodape?: ReactNode; onClose: () => void; larga?: boolean }) {
	useEsc(onClose);
	const ref = useRef<HTMLElement>(null);
	useEffect(() => { ref.current?.focus(); }, []);
	return (
		<div className="fixed inset-0 z-[120] bg-black/35" onClick={onClose}>
			<aside ref={ref} tabIndex={-1} role="dialog" aria-modal="true" aria-label={titulo} className={`absolute bottom-0 right-0 top-0 flex w-full ${larga ? 'sm:w-[560px]' : 'sm:w-[440px]'} max-w-full flex-col border-l outline-none`} style={cartao} onClick={e => e.stopPropagation()}>
				<div className="flex items-center gap-2 border-b px-4 py-3.5" style={borda}>
					<h2 className="min-w-0 flex-1 truncate text-[17px] font-bold text-[var(--base-texto)]">{titulo}</h2>
					<button type="button" aria-label="Fechar" onClick={onClose} className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-[var(--base-texto-2)] hover:bg-[var(--base-fill)]"><X size={16} /></button>
				</div>
				<div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto overflow-x-hidden px-4 py-4">{children}</div>
				{rodape && <div className="flex flex-wrap items-center gap-2 border-t px-4 py-3" style={borda}>{rodape}</div>}
			</aside>
		</div>
	);
}

/** Bloco de edição dentro da gaveta: título (com o interruptor), campos e uma frase. */
export function Ed({ titulo, controle, campos, texto }: { titulo: ReactNode; controle?: ReactNode; campos?: ReactNode; texto?: ReactNode }) {
	return (
		<div className="flex min-w-0 flex-col gap-2 rounded-xl border px-3.5 py-3" style={borda}>
			<div className="flex flex-wrap items-center justify-between gap-2"><b className="flex flex-wrap items-center gap-2 text-[13.5px] text-[var(--base-texto)]">{titulo}</b>{controle}</div>
			{campos && <div className="flex min-w-0 flex-wrap items-center gap-1.5">{campos}</div>}
			{texto && <p className="text-[12px] text-[var(--base-texto-2)]">{texto}</p>}
		</div>
	);
}

export function Kpi({ rotulo, valor, detalhe, alerta }: { rotulo: string; valor: ReactNode; detalhe?: ReactNode; alerta?: boolean }) {
	return (
		<div className="min-w-0 rounded-2xl border p-4" style={cartao}>
			<div className="text-[12px] text-[var(--base-texto-2)]">{rotulo}</div>
			<div className="mt-1 text-[24px] font-bold tabular-nums" style={{ color: alerta ? 'var(--estado-atencao-texto)' : 'var(--base-texto)' }}>{valor}</div>
			{detalhe && <div className="mt-0.5 text-[12px] text-[var(--base-texto-2)]">{detalhe}</div>}
		</div>
	);
}
