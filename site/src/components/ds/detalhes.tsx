// Detalhes: bloco recolhível (divulgação progressiva) com <details> nativo.
import type { ReactNode } from 'react';

/**
 * `solto`: cartão próprio (fora de um Cartao). Sem `solto`: separador no topo, para usar dentro de um cartão ou gaveta.
 * `qtd`: contagem ao lado do resumo. Com `aberto` começa aberto.
 */
export function Detalhes({ resumo, qtd, aberto, solto, children, onAlternar }: { resumo: ReactNode; qtd?: ReactNode; aberto?: boolean; solto?: boolean; children: ReactNode; onAlternar?: (aberto: boolean) => void }) {
	return (
		<details open={aberto} onToggle={onAlternar ? e => onAlternar((e.currentTarget as HTMLDetailsElement).open) : undefined}
			className={`group min-w-0 ${solto ? 'rounded-2xl bg-[var(--base-cartao)] shadow-[0_0_0_1px_var(--base-borda),0_2px_12px_rgba(0,0,0,.04)]' : 'rounded-xl border'}`} style={solto ? undefined : { borderColor: 'var(--base-borda)' }}>
			<summary className={`flex cursor-pointer list-none items-center gap-2 text-[13px] font-semibold text-[var(--base-texto-2)] hover:text-[var(--base-texto)] [&::-webkit-details-marker]:hidden ${solto ? 'px-4 py-3 sm:px-5' : 'px-3 py-2.5'}`}>
				<span aria-hidden="true" className="inline-block h-[7px] w-[7px] shrink-0 -rotate-45 border-b-[1.8px] border-r-[1.8px] border-current transition-transform group-open:rotate-45" />
				<span className="min-w-0">{resumo}</span>
				{qtd != null && <span className="font-normal text-[var(--base-texto-3)]">{qtd}</span>}
			</summary>
			<div className={solto ? 'px-4 pb-4 sm:px-5' : 'px-3 pb-3'}>{children}</div>
		</details>
	);
}
