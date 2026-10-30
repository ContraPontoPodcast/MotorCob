import { useState } from 'react';
import { Link } from 'react-router';
import { HelpCircle } from 'lucide-react';
import { FAIXAS, faixaStyle, isFaixa, PROPENSAO_TEXTO, SEM_FAIXA_DICA } from '@/lib/propensao';
import { useGlossario } from '@/components/glossario/glossario-provider';

/** Selo da faixa de propensão: letra colorida (A–E) ou "—" sem faixa. */
export function FaixaBadge({ faixa, propensao, size = 'md' }: { faixa: string | null | undefined; propensao?: number | null; size?: 'sm' | 'md' }) {
	const dim = size === 'sm' ? 'h-5 w-5 text-[11px]' : 'h-6 w-6 text-xs';
	if (!isFaixa(faixa)) {
		return (
			<span className="group relative inline-flex">
				<span className={`grid place-items-center rounded font-bold ${dim}`} style={{ color: 'var(--base-texto-3)' }} title={SEM_FAIXA_DICA}>—</span>
			</span>
		);
	}
	const pct = propensao != null && !Number.isNaN(Number(propensao)) ? Math.round(Number(propensao) * (Number(propensao) <= 1 ? 100 : 1)) : null;
	const title = pct != null ? `chance de pagar em 30 dias: ${pct}%` : undefined;
	return (
		<span className={`grid place-items-center rounded font-bold ${dim}`} style={faixaStyle(faixa)} title={title}>
			{faixa}
		</span>
	);
}

/** Ícone de ajuda com o texto de uma linha da propensão (igual em todo lugar).
 *  `matriz` (padrão false) liga o link "O que é a Matriz" → matriz-propensao-abordagem; passe só em Personas. */
export function PropensaoHelp({ className = '', matriz = false }: { className?: string; matriz?: boolean }) {
	const [open, setOpen] = useState(false);
	const { bySlug, loading } = useGlossario();
	const linkOk = (s: string) => loading || bySlug.has(s);
	const MARCA = 'acordo é promessa';
	const idx = PROPENSAO_TEXTO.indexOf(MARCA);
	const head = idx >= 0 ? PROPENSAO_TEXTO.slice(0, idx + MARCA.length) : PROPENSAO_TEXTO;
	const tail = idx >= 0 ? PROPENSAO_TEXTO.slice(idx + MARCA.length) : '';
	return (
		<span className={`relative inline-flex ${className}`}>
			<button
				type="button"
				onClick={() => setOpen(v => !v)}
				className="grid h-4 w-4 place-items-center rounded-full text-[var(--base-texto-3)] hover:text-[var(--base-texto)]"
				aria-label="O que é propensão a pagamento"
			>
				<HelpCircle size={14} />
			</button>
			{open && (
				<>
					<button className="fixed inset-0 z-[60] cursor-default" onClick={() => setOpen(false)} aria-hidden />
					<span className="absolute left-0 top-6 z-[70] w-[320px] rounded-lg border border-[var(--base-borda)] bg-[var(--base-cartao)] p-3 text-[12px] leading-relaxed text-[var(--base-texto-2)] shadow-lg">
						{head}
						{idx >= 0 && linkOk('pagamento-e-promessa') && (
							<Link to="/ajuda/o-que-significa#pagamento-e-promessa" onMouseDown={(e) => e.stopPropagation()} className="font-semibold text-[var(--destaque)] hover:underline">pagamento e promessa</Link>
						)}
						{tail}
						<span className="mt-2 flex items-center gap-1.5">
							{FAIXAS.map(f => (
								<span key={f} className="grid h-5 w-5 place-items-center rounded text-[11px] font-bold" style={faixaStyle(f)}>{f}</span>
							))}
							<span className="ml-1 text-[var(--base-texto-3)]">muito alta → muito baixa</span>
						</span>
						<div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
							{linkOk('propensao-a-pagamento') && (
								<Link to="/ajuda/o-que-significa#propensao-a-pagamento" onMouseDown={(e) => e.stopPropagation()} className="font-semibold text-[var(--destaque)] hover:underline">Ver no glossário</Link>
							)}
							{matriz && linkOk('matriz-propensao-abordagem') && (
								<Link to="/ajuda/o-que-significa#matriz-propensao-abordagem" onMouseDown={(e) => e.stopPropagation()} className="font-semibold text-[var(--destaque)] hover:underline">O que é a Matriz</Link>
							)}
						</div>
					</span>
				</>
			)}
		</span>
	);
}
