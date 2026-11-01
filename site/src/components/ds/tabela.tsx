// Tabela do design system: no máximo 6 colunas visíveis; o resto vai para a gaveta da linha (`onAbrir`).
// No celular (abaixo de md) vira lista: título e valor na 1ª linha, resumo na 2ª.
import { useEffect, type ReactNode } from 'react';
import { ChevronRight } from 'lucide-react';
import { Estado } from './aviso';
import { avisarRegra } from './tom';

export const MAX_COLUNAS = 6;

export type Coluna<T> = {
	id: string;
	titulo: ReactNode;
	/** Número: alinhado à direita, com algarismos tabulares. */
	num?: boolean;
	celula: (linha: T) => ReactNode;
};

export type LinhaCelular = { titulo: ReactNode; valor?: ReactNode; resumo?: ReactNode };

export type TabelaProps<T> = {
	colunas: Coluna<T>[];
	linhas: T[];
	chave: (linha: T) => string | number;
	/** Clique (ou Enter) na linha: abre a gaveta com o detalhe. */
	onAbrir?: (linha: T) => void;
	/** Como a linha aparece no celular. Sem isso: 1ª coluna, última coluna e as do meio no resumo. */
	celular?: (linha: T) => LinhaCelular;
	/** Linha selecionada (a gaveta aberta). */
	selecionada?: string | number | null;
	/** Rodapé (ex.: total), mostrado sob a tabela e sob a lista. */
	rodape?: ReactNode;
	/** Estado vazio (texto ou nó). */
	vazio?: ReactNode;
	/** Nome acessível da tabela. */
	rotulo?: string;
};

export function Tabela<T>({ colunas, linhas, chave, onAbrir, celular, selecionada, rodape, vazio = 'Nada por aqui.', rotulo }: TabelaProps<T>) {
	const excesso = colunas.length > MAX_COLUNAS;
	useEffect(() => { if (excesso) avisarRegra(`Tabela com ${colunas.length} colunas: o máximo é ${MAX_COLUNAS}; o resto vai para a gaveta da linha.`); }, [excesso, colunas.length]);
	const cols = colunas.slice(0, MAX_COLUNAS);
	if (linhas.length === 0) return <div className="p-4">{typeof vazio === 'string' ? <Estado tipo="vazio" titulo={vazio} compacto /> : vazio}</div>;
	const mob = (l: T): LinhaCelular => celular ? celular(l) : {
		titulo: cols[0]?.celula(l),
		valor: cols.length > 1 ? cols[cols.length - 1].celula(l) : undefined,
		resumo: cols.length > 2 ? <>{cols.slice(1, -1).map((c, i) => <span key={c.id}>{i ? ' · ' : ''}{c.celula(l)}</span>)}</> : undefined,
	};
	return (
		<div className="min-w-0" data-ds-tabela="">
			<div className="hidden md:block">
				<table className="w-full border-collapse text-[13px]" aria-label={rotulo}>
					<thead>
						<tr className="border-b text-left" style={{ borderColor: 'var(--base-borda)' }}>
							{cols.map(c => <th key={c.id} scope="col" className={`whitespace-nowrap px-4 py-2 text-[11.5px] font-semibold uppercase tracking-wide text-[var(--base-texto-3)] first:pl-5 ${c.num ? 'text-right' : ''}`}>{c.titulo}</th>)}
							{onAbrir && <th className="w-8 px-0"><span className="sr-only">Abrir</span></th>}
						</tr>
					</thead>
					<tbody>
						{linhas.map(l => {
							const k = chave(l);
							const sel = selecionada != null && selecionada === k;
							return (
								<tr key={k}
									onClick={onAbrir ? () => onAbrir(l) : undefined}
									onKeyDown={onAbrir ? e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onAbrir(l); } } : undefined}
									tabIndex={onAbrir ? 0 : undefined}
									aria-selected={onAbrir ? sel : undefined}
									className={`border-b last:border-0 ${onAbrir ? 'cursor-pointer hover:bg-[var(--base-fill)] focus-visible:bg-[var(--base-fill)] focus-visible:outline-none' : ''}`}
									style={{ borderColor: 'var(--base-borda)', backgroundColor: sel ? 'var(--base-fill)' : undefined }}>
									{cols.map(c => <td key={c.id} className={`px-4 py-2.5 align-middle text-[var(--base-texto)] first:pl-5 ${c.num ? 'whitespace-nowrap text-right tnum' : ''}`}>{c.celula(l)}</td>)}
									{onAbrir && <td className="w-8 px-0 pr-3 text-[var(--base-texto-3)]"><ChevronRight size={16} aria-hidden="true" /></td>}
								</tr>
							);
						})}
					</tbody>
				</table>
			</div>
			<ul className="flex flex-col md:hidden" aria-label={rotulo}>
				{linhas.map(l => {
					const k = chave(l);
					const m = mob(l);
					const corpo = (
						<>
							<span className="min-w-0 flex-1">
								<span className="flex items-baseline justify-between gap-2 text-[13.5px] font-semibold text-[var(--base-texto)]">
									<span className="min-w-0">{m.titulo}</span>
									{m.valor != null && <span className="max-w-[55%] shrink-0 text-right tnum">{m.valor}</span>}
								</span>
								{m.resumo != null && <span className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-[12px] text-[var(--base-texto-2)]">{m.resumo}</span>}
							</span>
							{onAbrir && <ChevronRight size={16} aria-hidden="true" className="shrink-0 text-[var(--base-texto-3)]" />}
						</>
					);
					return (
						<li key={k} className="border-b last:border-0" style={{ borderColor: 'var(--base-borda)' }}>
							{onAbrir
								? <button type="button" onClick={() => onAbrir(l)} className="flex w-full min-w-0 items-center gap-2.5 px-4 py-2.5 text-left hover:bg-[var(--base-fill)]">{corpo}</button>
								: <div className="flex min-w-0 items-center gap-2.5 px-4 py-2.5">{corpo}</div>}
						</li>
					);
				})}
			</ul>
			{rodape && <div className="flex flex-wrap items-center justify-between gap-2 border-t px-4 py-2.5 text-[12.5px] text-[var(--base-texto-2)] md:px-5" style={{ borderColor: 'var(--base-borda)' }}>{rodape}</div>}
		</div>
	);
}
