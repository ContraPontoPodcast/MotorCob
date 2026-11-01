// Peças visuais das telas do agente de voz. As genéricas (Pilula, Cartao, Kpi, Aviso, Vazio, SubAbas, Botao,
// campo e Tabela) agora vêm do design system em '@/components/ds'; aqui ficam só as próprias da voz e os
// atalhos de compatibilidade (código novo importa direto de '@/components/ds').
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { Lock } from 'lucide-react';
import type { Tom } from '@/lib/voz';
import { Aviso as AvisoDs, Botao as BotaoDs, Cartao as CartaoDs, Estado, Kpi as KpiDs, Pilula as PilulaDs } from '@/components/ds';

export { campoCls, campoStyle } from '@/components/ds';

export function Pilula({ tom = 'neutro', children, title }: { tom?: Tom; children: ReactNode; title?: string }) {
	return <PilulaDs tom={tom} title={title}>{children}</PilulaDs>;
}

export const Cartao = CartaoDs;

export function Kpi({ rotulo, valor, detalhe, alerta, children }: { rotulo: string; valor: ReactNode; detalhe?: ReactNode; alerta?: boolean; children?: ReactNode }) {
	return <KpiDs rotulo={rotulo} valor={valor} detalhe={detalhe} tom={alerta ? 'alerta' : undefined} extra={children} />;
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
	return <AvisoDs tom={tom} titulo={titulo}>{children}</AvisoDs>;
}

/** Estado vazio (atalho para Estado tipo="vazio" do design system). */
export function Vazio({ titulo, children, acao }: { titulo: string; children?: ReactNode; acao?: ReactNode }) {
	return <Estado tipo="vazio" titulo={titulo} acoes={acao}>{children}</Estado>;
}

/** Sub-abas (legado; tela nova usa Abas do design system, que vira select no celular). */
export function SubAbas({ itens, atual, onTrocar }: { itens: { id: string; nome: ReactNode; to?: string }[]; atual: string; onTrocar?: (id: string) => void }) {
	return (
		<div role="tablist" className="no-scrollbar mb-4 flex gap-1 overflow-x-auto border-b" style={{ borderColor: 'var(--base-borda)' }}>
			{itens.map(t => {
				const ativo = t.id === atual;
				const cls = `shrink-0 border-b-2 px-4 py-2 text-[13px] font-semibold transition-colors ${ativo ? '' : 'border-transparent text-[var(--base-texto-3)] hover:text-[var(--base-texto)]'}`;
				const style = ativo ? { borderColor: 'var(--destaque)', color: 'var(--base-texto)' } : undefined;
				if (t.to && !ativo) return <Link key={t.id} role="tab" aria-selected={false} to={t.to} className={cls} style={style}>{t.nome}</Link>;
				return <button key={t.id} type="button" role="tab" aria-selected={ativo} onClick={() => onTrocar?.(t.id)} className={cls} style={style}>{t.nome}</button>;
			})}
		</div>
	);
}

export function Botao({ children, onClick, secundario, disabled, type = 'button', title }: { children: ReactNode; onClick?: () => void; secundario?: boolean; disabled?: boolean; type?: 'button' | 'submit'; title?: string }) {
	return <BotaoDs tipo={secundario ? 'secundario' : 'primario'} onClick={onClick} disabled={disabled} type={type} title={title}>{children}</BotaoDs>;
}

/** Tabela legada (tela nova usa Tabela do design system: até 6 colunas, gaveta e lista no celular). */
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
