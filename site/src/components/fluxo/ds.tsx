// Peças do Fluxo do agente sobre o design system compartilhado (@/components/ds): Gaveta, Detalhes, Seg e Kv delegam
// para o DS (mesmo visual e comportamento: Esc, foco preso, abas e segmentos iguais às outras telas). Ficam aqui só as
// peças próprias do fluxo (barras do funil e das personas, selo que abre uma gaveta local, linhas e campos). Só
// tokens do tema (claro e escuro) e nada que passe de 390 px sem rolar dentro do próprio bloco.
import type { ReactNode } from 'react';
import { Lock } from 'lucide-react';
import { Detalhes as DetalhesDs, Gaveta as GavetaDs, ListaValores, Segmentos } from '@/components/ds';

/** Gaveta lateral (DS). No celular, ocupa a largura toda. Uma ação principal no pé. */
export function Gaveta({ aberta, onFechar, titulo, sub, children, pe, largura = 560 }: { aberta: boolean; onFechar: () => void; titulo: ReactNode; sub?: ReactNode; children: ReactNode; pe?: ReactNode; largura?: number }) {
	return <GavetaDs aberta={aberta} onFechar={onFechar} titulo={titulo} subtitulo={sub} rodape={pe} largura={largura}>{children}</GavetaDs>;
}

/** Selo com cadeado que abre as regras fixas ou um esclarecimento ("Quem edita e aprova", "Regras fixas (7)"). */
export function Selo({ children, onClick }: { children: ReactNode; onClick: () => void }) {
	return (
		<button type="button" onClick={onClick} className="inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-[12.5px] font-semibold text-[var(--base-texto-2)] hover:text-[var(--base-texto)]" style={{ borderColor: 'var(--base-borda)' }}>
			<Lock size={13} aria-hidden /> {children}
		</button>
	);
}

/** Bloco recolhido (Detalhes do DS). */
export function Detalhes({ titulo, qtd, aberto, children }: { titulo: ReactNode; qtd?: ReactNode; aberto?: boolean; children: ReactNode }) {
	return <DetalhesDs resumo={titulo} qtd={qtd} aberto={aberto}>{children}</DetalhesDs>;
}

/** Segmentado (uma escolha; Segmentos do DS). */
export function Seg<T extends string>({ itens, valor, onChange, rotulo }: { itens: { v: T; n: ReactNode }[]; valor: T; onChange: (v: T) => void; rotulo: string }) {
	return <Segmentos itens={itens} valor={valor} onTrocar={onChange} rotulo={rotulo} />;
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

/** Pares chave · valor (ListaValores do DS). */
export function Kv({ itens }: { itens: [ReactNode, ReactNode][] }) {
	return <ListaValores itens={itens} />;
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
