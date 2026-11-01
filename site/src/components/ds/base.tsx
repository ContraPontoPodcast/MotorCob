// Peças básicas do design system: Pilula, Botao, BotaoLink, Cartao, Segmentos e as classes de campo.
import type { CSSProperties, ReactNode } from 'react';
import { Link } from 'react-router';
import { SOMBRA, TOM, type Tom } from './tom';

export function Pilula({ tom = 'neutro', children, title, className = '' }: { tom?: Tom; children: ReactNode; title?: string; className?: string }) {
	const t = TOM[tom];
	return <span title={title} className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[11.5px] font-semibold ${className}`} style={{ backgroundColor: t.fundo, color: t.texto }}>{children}</span>;
}

export type TipoBotao = 'primario' | 'secundario' | 'fantasma' | 'perigo';

const CLS_BOTAO: Record<TipoBotao, string> = {
	primario: 'bg-[var(--destaque)] text-[var(--destaque-texto)] hover:bg-[var(--destaque-forte)]',
	secundario: 'text-[var(--base-texto)] shadow-[inset_0_0_0_1px_var(--base-field-border)] hover:bg-[var(--base-fill)]',
	fantasma: 'text-[var(--base-texto-2)] hover:bg-[var(--base-fill)] hover:text-[var(--base-texto)]',
	perigo: 'text-[var(--estado-erro-texto)] shadow-[inset_0_0_0_1px_var(--estado-erro)] hover:bg-[var(--estado-erro-fundo)]',
};

export function clsBotao(tipo: TipoBotao = 'primario', pequeno = false) {
	return `inline-flex max-w-full shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50 aria-disabled:cursor-not-allowed aria-disabled:opacity-50 ${pequeno ? 'h-8 px-2.5 text-[12.5px]' : 'h-9 px-3.5 text-[13px]'} ${CLS_BOTAO[tipo]}`;
}

export function Botao({ children, onClick, tipo = 'primario', pequeno, disabled, type = 'button', title, className = '', expandido }: {
	children: ReactNode; onClick?: () => void; tipo?: TipoBotao; pequeno?: boolean; disabled?: boolean; type?: 'button' | 'submit'; title?: string; className?: string;
	/** Botão que mostra/esconde algo: vira aria-expanded. */
	expandido?: boolean;
}) {
	return <button type={type} title={title} onClick={onClick} disabled={disabled} aria-expanded={expandido} className={`${clsBotao(tipo, pequeno)} ${className}`}>{children}</button>;
}

/** Link com cara de botão (navegação dentro do app). */
export function BotaoLink({ to, children, tipo = 'secundario', pequeno, className = '' }: { to: string; children: ReactNode; tipo?: TipoBotao; pequeno?: boolean; className?: string }) {
	return <Link to={to} className={`${clsBotao(tipo, pequeno)} ${className}`}>{children}</Link>;
}

/** Link de texto (ação terciária). */
export function LinkTexto({ to, onClick, children }: { to?: string; onClick?: () => void; children: ReactNode }) {
	const cls = 'inline-flex items-center gap-1 text-[13px] font-semibold text-[var(--destaque)] hover:underline';
	if (to) return <Link to={to} className={cls}>{children}</Link>;
	return <button type="button" onClick={onClick} className={cls}>{children}</button>;
}

export const campoCls = 'h-9 min-w-0 max-w-full rounded-lg border bg-[var(--base-cartao)] px-3 text-[13px] text-[var(--base-texto)] outline-none focus:border-[var(--destaque)] disabled:opacity-60';
export const campoStyle: CSSProperties = { borderColor: 'var(--base-field-border, var(--base-borda))' };
export const textareaCls = 'w-full rounded-lg border bg-[var(--base-cartao)] px-3 py-2 text-[13px] text-[var(--base-texto)] outline-none focus:border-[var(--destaque)]';

/** Campo com rótulo em cima (formulários das gavetas). */
export function Rotulo({ texto, children, dica, className = '' }: { texto: ReactNode; children: ReactNode; dica?: ReactNode; className?: string }) {
	return (
		<label className={`flex min-w-0 flex-col gap-1 text-[12px] font-medium text-[var(--base-texto-2)] ${className}`}>
			{texto}
			{children}
			{dica && <small className="text-[11.5px] font-normal text-[var(--base-texto-3)]">{dica}</small>}
		</label>
	);
}

/** Cartão de seção: título, linha de apoio, ações à direita. `semPadding` para tabelas de ponta a ponta. */
export function Cartao({ titulo, linha, direita, children, semPadding, className = '', id }: { titulo?: ReactNode; linha?: ReactNode; direita?: ReactNode; children?: ReactNode; semPadding?: boolean; className?: string; id?: string }) {
	return (
		<section id={id} className={`min-w-0 rounded-2xl bg-[var(--base-cartao)] ${semPadding ? '' : 'p-4 sm:p-5'} ${className}`} style={{ boxShadow: SOMBRA }}>
			{(titulo || direita) && (
				<div className={`mb-3 flex flex-wrap items-start justify-between gap-2 ${semPadding ? 'px-4 pt-4 sm:px-5 sm:pt-5' : ''}`}>
					<div className="min-w-0 flex-[1_1_220px]">
						{titulo && <h2 className="text-[15px] font-semibold text-[var(--base-texto)]">{titulo}</h2>}
						{linha && <p className="mt-0.5 text-[12.5px] leading-relaxed text-[var(--base-texto-2)]">{linha}</p>}
					</div>
					{direita && <div className="flex min-w-0 flex-wrap items-center gap-2">{direita}</div>}
				</div>
			)}
			{children}
		</section>
	);
}

/** Alternância segmentada (aria-pressed): uma escolha entre poucas opções. */
export function Segmentos<T extends string>({ itens, valor, onTrocar, rotulo }: { itens: { v: T; n: ReactNode }[]; valor: T; onTrocar: (v: T) => void; rotulo: string }) {
	return (
		<div role="group" aria-label={rotulo} className="inline-flex max-w-full flex-wrap gap-0.5 rounded-lg bg-[var(--base-fill)] p-0.5">
			{itens.map(i => (
				<button key={i.v} type="button" aria-pressed={valor === i.v} onClick={() => onTrocar(i.v)}
					className={`rounded-md px-2.5 py-1 text-[12.5px] font-semibold ${valor === i.v ? 'bg-[var(--base-cartao)] text-[var(--base-texto)] shadow-sm' : 'text-[var(--base-texto-2)] hover:text-[var(--base-texto)]'}`}>
					{i.n}
				</button>
			))}
		</div>
	);
}

/** Pares rótulo → valor (corpo das gavetas). */
export function ListaValores({ itens }: { itens: [ReactNode, ReactNode][] }) {
	return (
		<dl className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1.5 text-[13px]">
			{itens.map(([k, v], i) => (
				<div key={i} className="contents">
					<dt className="text-[var(--base-texto-2)]">{k}</dt>
					<dd className="m-0 text-right font-semibold tnum text-[var(--base-texto)]">{v}</dd>
				</div>
			))}
		</dl>
	);
}
