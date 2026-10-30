// Tabela que vira cartões no celular (abaixo de 600px do contêiner).
// Usa as container queries já definidas em index.css (.mc-tabela-container,
// .mc-tabela-desktop, .mc-tabela-cards).
//
// Props:
//  - cabecalho: rótulos das colunas.
//  - linhas: cada linha é { celulas: ReactNode[]; onClick?: () => void }.
//    No celular, só as colunas em destaque aparecem; passe destaque para marcar
//    quais índices de célula mostrar como cartão (padrão: todas).

import type { ReactNode } from 'react';

export type LinhaTabela = { celulas: ReactNode[]; onClick?: () => void };

type Props = {
	cabecalho: string[];
	linhas: LinhaTabela[];
	destaque?: number[]; // índices das colunas principais no cartão do celular
	className?: string;
};

export function TabelaResponsiva({ cabecalho, linhas, destaque, className = '' }: Props) {
	const principais = destaque ?? cabecalho.map((_, i) => i);

	return (
		<div className={`mc-tabela-container ${className}`}>
			{/* Desktop */}
			<div className="mc-tabela-desktop overflow-x-auto">
				<table className="w-full border-collapse text-[14px]">
					<thead>
						<tr className="border-b border-[#E5E5EA] text-left text-[12px] font-semibold uppercase tracking-wide text-[#8E8E93]">
							{cabecalho.map((h, i) => (
								<th key={i} className={`py-2 pr-4 font-semibold ${i === cabecalho.length - 1 ? 'text-right' : ''}`}>{h}</th>
							))}
						</tr>
					</thead>
					<tbody>
						{linhas.map((l, i) => (
							<tr key={i} onClick={l.onClick} className={`border-b border-[#F0F0F2] ${l.onClick ? 'cursor-pointer hover:bg-[#F5F5F7]' : ''}`}>
								{l.celulas.map((c, j) => (
									<td key={j} className={`py-2.5 pr-4 ${j === l.celulas.length - 1 ? 'text-right' : ''}`}>{c}</td>
								))}
							</tr>
						))}
					</tbody>
				</table>
			</div>

			{/* Celular: cartões só com os campos principais */}
			<div className="mc-tabela-cards space-y-2">
				{linhas.map((l, i) => (
					<button key={i} onClick={l.onClick} className="block w-full rounded-xl border border-[#E5E5EA] bg-white p-3 text-left">
						{principais.map(idx => (
							<div key={idx} className="flex items-center justify-between gap-2 py-0.5">
								<span className="text-[12px] text-[#8E8E93]">{cabecalho[idx]}</span>
								<span className="min-w-0 text-right text-[14px] font-medium text-[#1D1D1F]">{l.celulas[idx]}</span>
							</div>
						))}
					</button>
				))}
			</div>
		</div>
	);
}
