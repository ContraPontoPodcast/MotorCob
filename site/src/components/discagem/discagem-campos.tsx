import { type ReactNode } from 'react';
import { RotateCcw } from 'lucide-react';

export function SectionCard({ title, children, onReverter, ajustado, info }: {
	title: string; children: ReactNode; onReverter?: () => void; ajustado?: boolean; info?: ReactNode; canEdit?: boolean;
}) {
	return (
		<section className="rounded-xl border p-5" style={{ borderColor: 'var(--base-borda)', backgroundColor: 'var(--base-cartao)' }}>
			<div className="mb-4 flex flex-wrap items-center justify-between gap-2">
				<div className="flex items-center gap-2">
					<h3 className="text-[15px] font-semibold text-[var(--base-texto)]">{title}</h3>
					{ajustado && <span className="rounded-full bg-[var(--estado-atencao-fundo)] px-2 py-0.5 text-[10px] font-bold text-[var(--estado-atencao-texto)]">ajustado</span>}
					{info}
				</div>
				{onReverter && ajustado && (
					<button type="button" onClick={onReverter} className="flex items-center gap-1 text-[12px] font-medium text-[var(--base-texto-3)] hover:text-[var(--base-texto)]"><RotateCcw size={12} /> Voltar à sugestão</button>
				)}
			</div>
			{children}
		</section>
	);
}

export function NumberField({ label, value, onChange, min, max, suffix, disabled, sugestao, hint }: {
	label: string; value: number | '' | null; onChange: (v: number | '') => void;
	min?: number; max?: number; suffix?: string; disabled?: boolean; sugestao?: string; hint?: string;
}) {
	return (
		<label className="flex flex-col gap-1.5">
			<span className="flex items-center gap-1.5 text-[12px] font-semibold text-[var(--base-texto-2)]">
				{label}
				{sugestao && <span className="font-normal italic text-[var(--base-texto-3)]">sugestão: {sugestao}</span>}
			</span>
			<div className="flex items-center gap-1.5">
				<input
					type="number"
					value={value ?? ''}
					min={min}
					max={max}
					disabled={disabled}
					onChange={e => onChange(e.target.value === '' ? '' : Number(e.target.value))}
					className="h-9 w-24 rounded-lg border bg-[var(--base-cartao)] px-2.5 text-[13px] text-[var(--base-texto)] outline-none focus:border-[var(--area)] disabled:opacity-50"
					style={{ borderColor: 'var(--base-field-border)' }}
				/>
				{suffix && <span className="text-[12px] text-[var(--base-texto-3)]">{suffix}</span>}
			</div>
			{hint && <span className="text-[11px] text-[var(--base-texto-3)]">{hint}</span>}
		</label>
	);
}

export function PercentField({ label, value, onChange, disabled, sugestao, hint }: {
	label: string; value: number; onChange: (frac: number) => void; disabled?: boolean; sugestao?: string; hint?: string;
}) {
	return (
		<NumberField
			label={label}
			value={Math.round(value * 100)}
			min={1}
			max={100}
			suffix="%"
			sugestao={sugestao}
			hint={hint}
			disabled={disabled}
			onChange={v => onChange(v === '' ? 0 : Math.min(1, Math.max(0.01, Number(v) / 100)))}
		/>
	);
}

export function Toggle({ checked, onChange, disabled, label }: {
	checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; label?: string;
}) {
	return (
		<button
			type="button"
			role="switch"
			aria-checked={checked}
			aria-label={label}
			disabled={disabled}
			onClick={() => onChange(!checked)}
			className={`relative h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-50 ${checked ? 'bg-[var(--estado-pronto)]' : 'bg-[var(--base-field-border)]'}`}
		>
			<span className={`absolute top-1 h-4 w-4 rounded-full bg-white shadow transition-transform ${checked ? 'left-6' : 'left-1'}`} />
		</button>
	);
}

export function TravaAviso({ children }: { children: ReactNode }) {
	return (
		<p className="mt-1.5 flex items-start gap-1.5 text-[11px] text-[var(--estado-atencao-texto)]">
			<span className="mt-0.5 inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--estado-atencao)]" />
			<span>{children}</span>
		</p>
	);
}

export function CaixaInfo({ tone, children }: { tone: 'azul' | 'amber'; children: ReactNode }) {
	const bg = tone === 'azul' ? 'var(--estado-info-fundo)' : 'var(--estado-atencao-fundo)';
	const fg = tone === 'azul' ? 'var(--estado-info)' : 'var(--estado-atencao-texto)';
	return <div className="rounded-lg px-4 py-3 text-[13px] leading-relaxed" style={{ backgroundColor: bg, color: fg }}>{children}</div>;
}
