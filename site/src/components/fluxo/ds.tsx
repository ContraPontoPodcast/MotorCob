// Peças mínimas de design-system para o Fluxo do agente, no padrão do redesenho v2 (gaveta, selo de regras,
// detalhes recolhidos, segmentado, barras). Ficam aqui enquanto os componentes compartilhados de site/src/components/ds/
// (branch claude/site-redesign-v2) não chegam no main; depois é só trocar os imports. Só tokens do tema (claro e
// escuro) e nada que passe de 390 px sem rolar dentro do próprio bloco.
import type { ReactNode } from 'react';
import { ChevronRight, Lock } from 'lucide-react';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet';

/** Gaveta lateral (no celular, ocupa a largura toda). Uma ação principal no pé. */
export function Gaveta({ aberta, onFechar, titulo, sub, children, pe, largura = 560 }: { aberta: boolean; onFechar: () => void; titulo: ReactNode; sub?: ReactNode; children: ReactNode; pe?: ReactNode; largura?: number }) {
	return (
		<Sheet open={aberta} onOpenChange={v => { if (!v) onFechar(); }}>
			<SheetContent side="right" className="flex w-full flex-col gap-0 overflow-hidden border-l p-0 sm:max-w-none" style={{ maxWidth: `min(100vw, ${largura}px)`, backgroundColor: 'var(--base-cartao)', borderColor: 'var(--base-borda)', color: 'var(--base-texto)' }}>
				<div className="border-b px-5 pb-3 pt-5 pr-12" style={{ borderColor: 'var(--base-borda)' }}>
					<SheetTitle className="text-[16px] font-semibold text-[var(--base-texto)]">{titulo}</SheetTitle>
					{sub ? <SheetDescription className="mt-0.5 text-[12.5px] text-[var(--base-texto-2)]">{sub}</SheetDescription> : <SheetDescription className="sr-only">Detalhes</SheetDescription>}
				</div>
				<div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4 text-[13px]">{children}</div>
				{pe && <div className="flex flex-wrap justify-end gap-2 border-t px-5 py-3" style={{ borderColor: 'var(--base-borda)' }}>{pe}</div>}
			</SheetContent>
		</Sheet>
	);
}

/** Selo com cadeado que abre as regras fixas ou um esclarecimento ("Quem edita e aprova", "Regras fixas (7)"). */
export function Selo({ children, onClick }: { children: ReactNode; onClick: () => void }) {
	return (
		<button type="button" onClick={onClick} className="inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-[12.5px] font-semibold text-[var(--base-texto-2)] hover:text-[var(--base-texto)]" style={{ borderColor: 'var(--base-borda)' }}>
			<Lock size={13} aria-hidden /> {children}
		</button>
	);
}

/** Bloco recolhido (Detalhes). */
export function Detalhes({ titulo, qtd, aberto, children }: { titulo: ReactNode; qtd?: ReactNode; aberto?: boolean; children: ReactNode }) {
	return (
		<details open={aberto} className="group border-b last:border-b-0" style={{ borderColor: 'var(--base-borda)' }}>
			<summary className="flex cursor-pointer list-none items-center gap-2 py-3 text-[13.5px] font-semibold text-[var(--base-texto)]">
				<ChevronRight size={15} className="shrink-0 transition-transform group-open:rotate-90" aria-hidden />
				<span className="min-w-0 flex-1">{titulo}</span>
				{qtd && <span className="text-[12px] font-normal text-[var(--base-texto-3)]">{qtd}</span>}
			</summary>
			<div className="pb-4">{children}</div>
		</details>
	);
}

/** Segmentado (uma escolha). */
export function Seg<T extends string>({ itens, valor, onChange, rotulo }: { itens: { v: T; n: ReactNode }[]; valor: T; onChange: (v: T) => void; rotulo: string }) {
	return (
		<div role="radiogroup" aria-label={rotulo} className="inline-flex max-w-full flex-wrap rounded-lg p-0.5" style={{ backgroundColor: 'var(--base-fill)' }}>
			{itens.map(i => (
				<button key={i.v} type="button" role="radio" aria-checked={valor === i.v} onClick={() => onChange(i.v)}
					className="h-8 rounded-md px-3 text-[12.5px] font-semibold"
					style={valor === i.v ? { backgroundColor: 'var(--base-cartao)', color: 'var(--base-texto)', boxShadow: '0 0 0 1px var(--base-borda)' } : { color: 'var(--base-texto-2)' }}>
					{i.n}
				</button>
			))}
		</div>
	);
}

/** Lista de linhas "rótulo · valor · nota". */
export function Linhas({ itens }: { itens: { e: ReactNode; d?: ReactNode; s?: ReactNode; onClick?: () => void }[] }) {
	return (
		<ul className="divide-y" style={{ borderColor: 'var(--base-borda)' }}>
			{itens.map((l, i) => {
				const corpo = (
					<>
						<span className="min-w-0 flex-1">
							<span className="block text-[13px] text-[var(--base-texto)]">{l.e}</span>
							{l.s && <small className="mt-0.5 block text-[12px] text-[var(--base-texto-2)]">{l.s}</small>}
						</span>
						{l.d != null && <span className="shrink-0 text-right text-[13px] font-semibold text-[var(--base-texto)] tnum">{l.d}</span>}
					</>
				);
				return (
					<li key={i} className="py-2" style={{ borderColor: 'var(--base-separator, var(--base-borda))' }}>
						{l.onClick
							? <button type="button" onClick={l.onClick} className="flex w-full items-start gap-3 text-left hover:opacity-80">{corpo}</button>
							: <div className="flex items-start gap-3">{corpo}</div>}
					</li>
				);
			})}
		</ul>
	);
}

/** Pares chave · valor. */
export function Kv({ itens }: { itens: [ReactNode, ReactNode][] }) {
	return (
		<dl className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1.5 text-[13px]">
			{itens.map(([k, v], i) => <div key={i} className="contents"><dt className="text-[var(--base-texto-2)]">{k}</dt><dd className="text-right font-semibold text-[var(--base-texto)] tnum">{v}</dd></div>)}
		</dl>
	);
}

/** Regra fixa (com cadeado) ou explicação em lista. */
export function Regras({ itens }: { itens: [ReactNode, ReactNode?][] }) {
	return (
		<div className="space-y-2">
			{itens.map(([t, s], i) => (
				<div key={i} className="flex items-start gap-2.5 rounded-xl bg-[var(--base-fill)] px-3 py-2.5">
					<Lock size={14} className="mt-0.5 shrink-0 text-[var(--base-texto-3)]" aria-hidden />
					<span className="min-w-0 text-[13px] text-[var(--base-texto)]"><b className="font-semibold">{t}</b>{s && <small className="mt-0.5 block text-[12px] text-[var(--base-texto-2)]">{s}</small>}</span>
				</div>
			))}
		</div>
	);
}

/** Barra horizontal: rótulo, barra e número (funil, intenções, personas). */
export function BarraH({ rotulo, valor, max, texto, cor = 'var(--area)', onClick }: { rotulo: ReactNode; valor: number; max: number; texto: ReactNode; cor?: string; onClick?: () => void }) {
	const w = max > 0 ? Math.max(0, Math.min(100, (100 * valor) / max)) : 0;
	const corpo = (
		<>
			<span className="min-w-0 truncate text-left text-[13px] text-[var(--base-texto)]">{rotulo}</span>
			<span className="h-2 w-full overflow-hidden rounded-full bg-[var(--base-fill)]"><span className="block h-full rounded-full" style={{ width: `${w}%`, backgroundColor: cor }} /></span>
			<b className="whitespace-nowrap text-right text-[12.5px] tnum text-[var(--base-texto)]">{texto}</b>
		</>
	);
	const cls = 'grid w-full grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)_auto] items-center gap-3 py-1.5 sm:grid-cols-[minmax(0,220px)_minmax(0,1fr)_auto]';
	return onClick ? <button type="button" onClick={onClick} className={`${cls} rounded hover:bg-[var(--base-fill)]`}>{corpo}</button> : <div className={cls}>{corpo}</div>;
}

/** Duas barras (versão nova × em uso). */
export function Barra2({ rotulo, a, b, max, texto, onClick }: { rotulo: ReactNode; a: number | null; b: number | null; max: number; texto: ReactNode; onClick?: () => void }) {
	const w = (v: number | null) => (v == null || max <= 0 ? 0 : Math.max(0, Math.min(100, (100 * v) / max)));
	return (
		<button type="button" onClick={onClick} className="grid w-full grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)_auto] items-center gap-3 rounded py-1.5 hover:bg-[var(--base-fill)] sm:grid-cols-[minmax(0,220px)_minmax(0,1fr)_auto]">
			<span className="min-w-0 truncate text-left text-[13px] text-[var(--base-texto)]">{rotulo}</span>
			<span className="space-y-1">
				<span className="block h-2 overflow-hidden rounded-full bg-[var(--base-fill)]"><span className="block h-full rounded-full" style={{ width: `${w(a)}%`, backgroundColor: 'var(--area)' }} /></span>
				<span className="block h-2 overflow-hidden rounded-full bg-[var(--base-fill)]"><span className="block h-full rounded-full" style={{ width: `${w(b)}%`, backgroundColor: 'var(--base-texto-3)' }} /></span>
			</span>
			<b className="whitespace-nowrap text-right text-[12.5px] tnum text-[var(--base-texto)]">{texto}</b>
		</button>
	);
}

/** Bolinha de cor do modo. */
export function Ponto({ cor, tam = 8 }: { cor: string; tam?: number }) {
	return <i aria-hidden className="inline-block shrink-0 rounded-full" style={{ width: tam, height: tam, backgroundColor: cor }} />;
}

/** Linha de botões de topo (ação principal + secundárias), que quebra no celular. */
export function Acoes({ children }: { children: ReactNode }) {
	return <div className="flex flex-wrap items-center gap-2">{children}</div>;
}

export function BotaoLink({ children, onClick, title }: { children: ReactNode; onClick: () => void; title?: string }) {
	return <button type="button" title={title} onClick={onClick} className="text-[12.5px] font-semibold text-[var(--destaque)] underline-offset-2 hover:underline">{children}</button>;
}

export function Campo({ rotulo, children, ajuda, inteiro }: { rotulo: ReactNode; children: ReactNode; ajuda?: ReactNode; inteiro?: boolean }) {
	return (
		<label className={`block min-w-0 ${inteiro ? 'sm:col-span-2' : ''}`}>
			<span className="mb-1 block text-[12px] font-semibold text-[var(--base-texto-2)]">{rotulo}</span>
			{children}
			{ajuda && <small className="mt-1 block text-[11.5px] text-[var(--base-texto-3)]">{ajuda}</small>}
		</label>
	);
}
