import { type ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * Chave liga/desliga única do Console MotorCX.
 *
 * Botão <button role="switch" aria-checked>: 44×26 px, raio total, fundo
 * #D2D2D7 (desligada) ou #34C759 (ligada); bolinha branca 22×22 a 2 px da
 * borda, sombra leve, desliza com 150 ms (sem transição se prefers-reduced-motion).
 * Rótulo à esquerda na mesma linha; texto de ajuda embaixo em 12 px cinza.
 * Desabilitada: opacidade 0,4 e cursor not-allowed. Foco visível (anel azul 2 px).
 */
export function Chave({
	label,
	desc,
	checked,
	on,
	disabled,
	readOnly,
	className,
}: {
	label?: ReactNode;
	desc?: string;
	checked: boolean;
	on: (v: boolean) => void;
	disabled?: boolean;
	readOnly?: boolean;
	className?: string;
}) {
	const bloqueado = disabled || readOnly;
	const botao = (
		<button
			type="button"
			role="switch"
			aria-checked={checked}
			disabled={bloqueado}
			onClick={() => { if (!bloqueado) on(!checked); }}
			className="relative h-[26px] w-[44px] shrink-0 rounded-full transition-colors duration-150 motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0071E5] focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-40"
			style={{ backgroundColor: checked ? '#34C759' : '#D2D2D7' }}
		>
			<span
				className="absolute left-0 top-[2px] h-[22px] w-[22px] rounded-full bg-white shadow-[0_1px_3px_rgba(0,0,0,0.2)] transition-transform duration-150 ease-out motion-reduce:transition-none"
				style={{ transform: checked ? 'translateX(20px)' : 'translateX(2px)' }}
			/>
		</button>
	);

	if (label == null && !desc) return botao;

	return (
		<div className={className}>
			<div className="flex items-center justify-between gap-3">
				{label != null && <div className="min-w-0">{label}</div>}
				{botao}
			</div>
			{desc && <p className="mt-1 text-[12px] text-[#8E8E93]">{desc}</p>}
		</div>
	);
}

/** Rótulo padrão de uma linha (título 15 px + ajuda abaixo). */
export function ChaveLinha({ label, desc, checked, on, disabled, readOnly, className }: {
	label: string; desc?: string; checked: boolean; on: (v: boolean) => void; disabled?: boolean; readOnly?: boolean; className?: string;
}) {
	return (
		<Chave
			className={cn('py-3', className)}
			label={<span className="text-[15px] font-medium text-[#1D1D1F]">{label}</span>}
			desc={desc}
			checked={checked}
			on={on}
			disabled={disabled}
			readOnly={readOnly}
		/>
	);
}
