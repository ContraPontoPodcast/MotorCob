// KPIs: no máximo 4 por tela. `tom` pinta o valor (alerta = vermelho com borda; atencao = amarelo).
import { useEffect, type ReactNode } from 'react';
import { avisarRegra, SOMBRA } from './tom';

export const MAX_KPIS = 4;

export type ItemKpi = { rotulo: ReactNode; valor: ReactNode; detalhe?: ReactNode; tom?: 'alerta' | 'atencao' | 'ok'; extra?: ReactNode };

export function Kpi({ rotulo, valor, detalhe, tom, extra }: ItemKpi) {
	const cor = tom === 'alerta' ? 'var(--estado-erro-texto)' : tom === 'atencao' ? 'var(--estado-atencao-texto)' : tom === 'ok' ? 'var(--estado-pronto-texto)' : 'var(--base-texto)';
	return (
		<div className="min-w-0 rounded-2xl bg-[var(--base-cartao)] p-3 sm:px-4 sm:py-3.5" style={{ boxShadow: tom === 'alerta' ? '0 0 0 1px var(--estado-erro)' : SOMBRA }} data-tom={tom}>
			<p className="text-[12px] font-medium text-[var(--base-texto-2)]">{rotulo}</p>
			<p className="mt-0.5 text-[20px] font-bold leading-tight tnum sm:text-[24px]" style={{ color: cor }}>{valor}</p>
			{extra}
			{detalhe && <div className="mt-1 text-[12px] leading-relaxed text-[var(--base-texto-2)]">{detalhe}</div>}
		</div>
	);
}

/** Linha de KPIs (2 colunas no celular; 2, 3 ou 4 no desktop conforme a quantidade). Mais de 4: só os 4 primeiros. */
export function Kpis({ itens }: { itens: (ItemKpi | null | false | undefined)[] }) {
	const lista = itens.filter((x): x is ItemKpi => !!x);
	const excesso = lista.length > MAX_KPIS;
	useEffect(() => { if (excesso) avisarRegra(`${lista.length} KPIs: o máximo é ${MAX_KPIS}.`); }, [excesso, lista.length]);
	const vis = lista.slice(0, MAX_KPIS);
	const cols = vis.length >= 4 ? 'lg:grid-cols-4' : vis.length === 3 ? 'sm:grid-cols-3' : '';
	return <div className={`grid grid-cols-2 gap-3 ${cols}`} data-ds-kpis={vis.length}>{vis.map((k, i) => <Kpi key={i} {...k} />)}</div>;
}
