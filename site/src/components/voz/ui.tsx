// Peças visuais das telas do agente de voz. Só tokens do tema (var(--base-*), var(--estado-*),
// var(--area), var(--destaque)), para valer no claro e no escuro.
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { Lock } from 'lucide-react';
import type { Tom } from '@/lib/voz';

const TOM: Record<Tom, { bg: string; fg: string }> = {
	ok: { bg: 'var(--estado-pronto-fundo)', fg: 'var(--estado-pronto-texto)' },
	info: { bg: 'var(--estado-info-fundo)', fg: 'var(--estado-info)' },
	atencao: { bg: 'var(--estado-atencao-fundo)', fg: 'var(--estado-atencao-texto)' },
	erro: { bg: 'var(--estado-erro-fundo)', fg: 'var(--estado-erro-texto)' },
	neutro: { bg: 'var(--base-fill)', fg: 'var(--base-texto-2)' },
};

export function Pilula({ tom = 'neutro', children, title }: { tom?: Tom; children: ReactNode; title?: string }) {
	const t = TOM[tom];
	return <span title={title} className="inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[11.5px] font-semibold" style={{ backgroundColor: t.bg, color: t.fg }}>{children}</span>;
}

export function Cartao({ titulo, linha, direita, children, semPadding, className = '', id }: { titulo?: ReactNode; linha?: ReactNode; direita?: ReactNode; children?: ReactNode; semPadding?: boolean; className?: string; id?: string }) {
	return (
		<section id={id} className={`min-w-0 rounded-2xl bg-[var(--base-cartao)] ${semPadding ? '' : 'p-4 sm:p-5'} ${className}`} style={{ boxShadow: '0 0 0 1px var(--base-borda), 0 2px 12px rgba(0,0,0,.04)' }}>
			{(titulo || direita) && (
				<div className={`mb-3 flex flex-wrap items-start justify-between gap-2 ${semPadding ? 'px-4 pt-4 sm:px-5 sm:pt-5' : ''}`}>
					<div className="min-w-0">
						{titulo && <h2 className="text-[15px] font-semibold text-[var(--base-texto)]">{titulo}</h2>}
						{linha && <p className="mt-0.5 text-[12.5px] leading-relaxed text-[var(--base-texto-2)]">{linha}</p>}
					</div>
					{direita && <div className="flex shrink-0 flex-wrap items-center gap-2">{direita}</div>}
				</div>
			)}
			{children}
		</section>
	);
}

export function Kpi({ rotulo, valor, detalhe, alerta, children }: { rotulo: string; valor: ReactNode; detalhe?: ReactNode; alerta?: boolean; children?: ReactNode }) {
	return (
		<div className="min-w-0 rounded-2xl bg-[var(--base-cartao)] p-4" style={{ boxShadow: `0 0 0 1px ${alerta ? 'var(--estado-erro)' : 'var(--base-borda)'}, 0 2px 12px rgba(0,0,0,.04)` }}>
			<p className="text-[12px] font-medium text-[var(--base-texto-3)]">{rotulo}</p>
			<p className="mt-1 text-[22px] font-bold leading-tight tnum" style={{ color: alerta ? 'var(--estado-erro-texto)' : 'var(--base-texto)' }}>{valor}</p>
			{children}
			{detalhe && <div className="mt-1 text-[12px] leading-relaxed text-[var(--base-texto-2)]">{detalhe}</div>}
		</div>
	);
}

/** Barra de progresso com marca opcional (ex.: previsto dentro do orçamento). */
export function Trilho({ valor, marca, cor = 'var(--area)' }: { valor: number; marca?: number; cor?: string }) {
	const v = Math.max(0, Math.min(100, valor));
	return (
		<div className="relative mt-2 h-1.5 w-full overflow-hidden rounded-full bg-[var(--base-fill)]" role="presentation">
			<span className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${v}%`, backgroundColor: cor }} />
			{marca != null && <span className="absolute inset-y-[-2px] w-[2px] bg-[var(--base-texto)]" style={{ left: `${Math.max(0, Math.min(100, marca))}%` }} />}
		</div>
	);
}

export function Trava({ titulo, texto, icone }: { titulo: ReactNode; texto?: ReactNode; icone?: ReactNode }) {
	return (
		<div className="flex items-start gap-2.5 rounded-xl bg-[var(--base-fill)] px-3 py-2.5">
			<span className="mt-0.5 shrink-0 text-[var(--base-texto-3)]">{icone ?? <Lock size={15} aria-label="Regra fixa" />}</span>
			<span className="min-w-0 text-[13px] text-[var(--base-texto)]">
				<b className="font-semibold">{titulo}</b>
				{texto && <small className="mt-0.5 block text-[12px] text-[var(--base-texto-2)]">{texto}</small>}
			</span>
		</div>
	);
}

export function Aviso({ tom = 'atencao', titulo, children }: { tom?: Tom; titulo?: ReactNode; children?: ReactNode }) {
	const t = TOM[tom];
	return (
		<div role="status" className="flex items-start gap-2.5 rounded-xl px-3.5 py-2.5 text-[13px]" style={{ backgroundColor: t.bg, color: 'var(--base-texto)' }}>
			<span className="mt-[3px] inline-block h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: t.fg }} />
			<span className="min-w-0">{titulo && <b className="font-semibold">{titulo} </b>}{children}</span>
		</div>
	);
}

/** Estado vazio de cada tela: título, explicação e um próximo passo. */
export function Vazio({ titulo, children, acao }: { titulo: string; children?: ReactNode; acao?: ReactNode }) {
	return (
		<div className="rounded-2xl bg-[var(--base-fill)] px-6 py-10 text-center" style={{ boxShadow: '0 0 0 1px var(--base-borda)' }}>
			<p className="text-[15px] font-semibold text-[var(--base-texto)]">{titulo}</p>
			{children && <p className="mx-auto mt-1.5 max-w-[520px] text-[13px] leading-relaxed text-[var(--base-texto-2)]">{children}</p>}
			{acao && <div className="mt-4 flex flex-wrap justify-center gap-2">{acao}</div>}
		</div>
	);
}

/** Sub-abas da tela (role tablist), como em Discagem. Com `to`, vira link. */
export function SubAbas({ itens, atual, onTrocar }: { itens: { id: string; nome: ReactNode; to?: string }[]; atual: string; onTrocar?: (id: string) => void }) {
	return (
		<div role="tablist" className="no-scrollbar mb-4 flex gap-1 overflow-x-auto border-b" style={{ borderColor: 'var(--base-borda)' }}>
			{itens.map(t => {
				const ativo = t.id === atual;
				const cls = `shrink-0 border-b-2 px-4 py-2 text-[13px] font-semibold transition-colors ${ativo ? '' : 'border-transparent text-[var(--base-texto-3)] hover:text-[var(--base-texto)]'}`;
				const style = ativo ? { borderColor: 'var(--area)', color: 'var(--base-texto)' } : undefined;
				if (t.to && !ativo) return <Link key={t.id} role="tab" aria-selected={false} to={t.to} className={cls} style={style}>{t.nome}</Link>;
				return <button key={t.id} type="button" role="tab" aria-selected={ativo} onClick={() => onTrocar?.(t.id)} className={cls} style={style}>{t.nome}</button>;
			})}
		</div>
	);
}

export function Botao({ children, onClick, secundario, disabled, type = 'button', title }: { children: ReactNode; onClick?: () => void; secundario?: boolean; disabled?: boolean; type?: 'button' | 'submit'; title?: string }) {
	return (
		<button
			type={type}
			title={title}
			onClick={onClick}
			disabled={disabled}
			className={`inline-flex h-9 items-center justify-center gap-1.5 rounded-lg px-4 text-[13px] font-semibold transition-opacity disabled:cursor-not-allowed disabled:opacity-50 ${secundario ? 'border text-[var(--base-texto)] hover:bg-[var(--base-fill)]' : 'text-[var(--destaque-texto)] hover:opacity-90'}`}
			style={secundario ? { borderColor: 'var(--base-borda)' } : { backgroundColor: 'var(--destaque)' }}
		>
			{children}
		</button>
	);
}

export const campoCls = 'h-9 rounded-lg border bg-[var(--base-cartao)] px-3 text-[13px] text-[var(--base-texto)] outline-none focus:border-[var(--destaque)] disabled:opacity-60';
export const campoStyle = { borderColor: 'var(--base-field-border, var(--base-borda))' };

/** Tabela simples com rolagem horizontal própria (nunca a página). No celular, use `cartoes`. */
export function Tabela({ cabecalho, linhas, numericas = [], cartoes, vazio, onLinha, selecionada }: {
	cabecalho: string[];
	linhas: ReactNode[][];
	numericas?: number[];
	cartoes?: ReactNode[];
	vazio?: ReactNode;
	onLinha?: (i: number) => void;
	selecionada?: number;
}) {
	if (linhas.length === 0 && vazio) return <>{vazio}</>;
	return (
		<>
			<div className={`overflow-x-auto ${cartoes ? 'hidden md:block' : ''}`}>
				<table className="w-full border-collapse text-[13px]">
					<thead>
						<tr className="border-b text-left text-[11.5px] font-semibold uppercase tracking-wide text-[var(--base-texto-3)]" style={{ borderColor: 'var(--base-borda)' }}>
							{cabecalho.map((h, i) => <th key={h} className={`whitespace-nowrap px-4 py-2 font-semibold ${numericas.includes(i) ? 'text-right' : ''}`}>{h}</th>)}
						</tr>
					</thead>
					<tbody>
						{linhas.map((l, i) => (
							<tr
								key={i}
								onClick={onLinha ? () => onLinha(i) : undefined}
								onKeyDown={onLinha ? e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onLinha(i); } } : undefined}
								tabIndex={onLinha ? 0 : undefined}
								aria-selected={onLinha ? selecionada === i : undefined}
								className={`border-b ${onLinha ? 'cursor-pointer hover:bg-[var(--base-fill)]' : ''}`}
								style={{ borderColor: 'var(--base-separator, var(--base-borda))', backgroundColor: selecionada === i ? 'var(--base-fill)' : undefined }}
							>
								{l.map((c, j) => <td key={j} className={`whitespace-nowrap px-4 py-2.5 text-[var(--base-texto)] ${numericas.includes(j) ? 'text-right tnum' : ''}`}>{c}</td>)}
							</tr>
						))}
					</tbody>
				</table>
			</div>
			{cartoes && <div className="space-y-2 p-3 md:hidden">{cartoes}</div>}
		</>
	);
}

/** Cartão de linha no celular. */
export function CartaoLinha({ children, onClick, ativo }: { children: ReactNode; onClick?: () => void; ativo?: boolean }) {
	const cls = 'block w-full rounded-xl border p-3 text-left text-[13px] text-[var(--base-texto)]';
	const style = { borderColor: ativo ? 'var(--destaque)' : 'var(--base-borda)', backgroundColor: ativo ? 'var(--base-fill)' : 'var(--base-cartao)' };
	if (onClick) return <button type="button" onClick={onClick} className={cls} style={style}>{children}</button>;
	return <div className={cls} style={style}>{children}</div>;
}

/** Etapas em linha (Rascunho → Aprovado → Em uso). */
export function Passos({ passos, atual }: { passos: { id: string; nome: string; desc?: string }[]; atual: number }) {
	return (
		<ol className="grid gap-2 sm:grid-cols-3">
			{passos.map((p, i) => {
				const feito = i < atual;
				const agora = i === atual;
				return (
					<li key={p.id} className="rounded-xl border px-3 py-2" style={{ borderColor: agora ? 'var(--destaque)' : 'var(--base-borda)', backgroundColor: feito ? 'var(--base-fill)' : 'var(--base-cartao)' }}>
						<b className="flex items-center gap-1.5 text-[13px] font-semibold" style={{ color: feito || agora ? 'var(--base-texto)' : 'var(--base-texto-3)' }}>
							<span className="grid h-4 w-4 place-items-center rounded-full text-[10px] font-bold" style={{ backgroundColor: feito ? 'var(--estado-pronto)' : agora ? 'var(--destaque)' : 'var(--base-fill)', color: feito || agora ? 'var(--destaque-texto)' : 'var(--base-texto-3)' }}>{feito ? '✓' : i + 1}</span>
							{p.nome}{agora ? ' · agora' : ''}
						</b>
						{p.desc && <small className="mt-0.5 block text-[11.5px] text-[var(--base-texto-2)]">{p.desc}</small>}
					</li>
				);
			})}
		</ol>
	);
}

/** Barra horizontal de agregado (Insights). Sem percentual, mostra "menos de 30". */
export function BarraAgregado({ nome, pct, qtd, max, cor = 'var(--area)' }: { nome: string; pct: number | null; qtd: number | null; max: number; cor?: string }) {
	const w = pct == null || max <= 0 ? 0 : (100 * pct) / max;
	return (
		<div className="grid grid-cols-[minmax(0,140px)_minmax(0,1fr)_auto] items-center gap-3 py-1 text-[13px] sm:grid-cols-[minmax(0,180px)_minmax(0,1fr)_auto]">
			<span className="truncate text-[var(--base-texto)]" title={nome}>{nome}</span>
			<span className="h-2 w-full overflow-hidden rounded-full bg-[var(--base-fill)]"><span className="block h-full rounded-full" style={{ width: `${w}%`, backgroundColor: cor }} /></span>
			<b className="whitespace-nowrap text-right tnum text-[var(--base-texto)]">{pct == null ? <span className="font-normal text-[var(--base-texto-3)]">menos de 30</span> : <>{pct.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}% <small className="font-normal text-[var(--base-texto-3)]">{(qtd ?? 0).toLocaleString('pt-BR')}</small></>}</b>
		</div>
	);
}
