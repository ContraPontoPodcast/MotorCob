// Abas: barra de abas no desktop; no celular vira um <select> (nada some para fora da tela).
// `fim`: um link no fim da barra (ex.: "Buscar nas conversas"), que no celular entra como última opção.
import type { ReactNode } from 'react';
import { Link, useNavigate } from 'react-router';

export type ItemAba = {
	id: string;
	nome: string;
	/** Com `to`, a aba é um link (rota própria). Sem `to`, chama `onTrocar`. */
	to?: string;
	/** Contagem ao lado do nome (ex.: alertas abertos). */
	cont?: number | string | null;
	icone?: ReactNode;
};

export function Abas({ itens, atual, onTrocar, rotulo, fim }: { itens: ItemAba[]; atual: string; onTrocar?: (id: string) => void; rotulo: string; fim?: ItemAba & { to: string } }) {
	const navegar = useNavigate();
	const todos = fim ? [...itens, fim] : itens;
	const escolher = (id: string) => {
		const it = todos.find(x => x.id === id);
		if (!it || id === atual) return;
		if (it.to) navegar(it.to);
		else onTrocar?.(id);
	};
	const cls = (ativo: boolean) => `inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2 text-[13.5px] font-semibold transition-colors ${ativo ? 'text-[var(--base-texto)]' : 'border-transparent text-[var(--base-texto-2)] hover:text-[var(--base-texto)]'}`;
	const estilo = (ativo: boolean) => (ativo ? { borderColor: 'var(--destaque)' } : undefined);
	const conteudo = (t: ItemAba) => <>{t.icone}{t.nome}{t.cont != null && t.cont !== '' && t.cont !== 0 && <span className="rounded-full bg-[var(--estado-erro-fundo)] px-1.5 text-[11px] font-bold text-[var(--estado-erro-texto)]">{t.cont}</span>}</>;
	return (
		<div className="mb-4 min-w-0" data-ds-abas="">
			<div role="tablist" aria-label={rotulo} className="no-scrollbar hidden gap-0.5 overflow-x-auto border-b md:flex" style={{ borderColor: 'var(--base-borda)' }}>
				{itens.map(t => {
					const ativo = t.id === atual;
					if (t.to && !ativo) return <Link key={t.id} role="tab" aria-selected={false} to={t.to} className={cls(false)}>{conteudo(t)}</Link>;
					return <button key={t.id} type="button" role="tab" aria-selected={ativo} onClick={() => !ativo && escolher(t.id)} className={cls(ativo)} style={estilo(ativo)}>{conteudo(t)}</button>;
				})}
				{fim && (fim.id === atual
					? <span role="tab" aria-selected className={`ml-auto ${cls(true)}`} style={estilo(true)}>{conteudo(fim)}</span>
					: <Link to={fim.to} className={`ml-auto ${cls(false)}`}>{conteudo(fim)}</Link>)}
			</div>
			<select aria-label={rotulo} value={atual} onChange={e => escolher(e.target.value)}
				className="h-10 w-full rounded-lg border bg-[var(--base-cartao)] px-3 text-[14px] font-semibold text-[var(--base-texto)] md:hidden" style={{ borderColor: 'var(--base-field-border, var(--base-borda))' }}>
				{todos.map(t => <option key={t.id} value={t.id}>{t.nome}{t.cont != null && t.cont !== '' && t.cont !== 0 ? ` (${t.cont})` : ''}</option>)}
			</select>
		</div>
	);
}
