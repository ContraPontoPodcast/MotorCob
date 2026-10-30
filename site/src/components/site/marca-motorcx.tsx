/** Símbolo do MotorCX — anel em 3 segmentos com ponto central.
 *  Cores fixas: anel #3A3A3C, arco dourado #C9A35A, arco cinza #8E8E93, centro #C9A35A. */
export function MotorCXMark({ className }: { className?: string }) {
	return (
		<svg viewBox="0 0 100 100" className={className} fill="none" aria-hidden="true">
			<circle cx="50" cy="50" r="38" stroke="#3A3A3C" strokeWidth={11} />
			<path d="M50 12 A38 38 0 0 1 86.1 38.3" stroke="#C9A35A" strokeWidth={11} strokeLinecap="round" />
			<path d="M83.6 70 A38 38 0 0 1 30 82.3" stroke="#8E8E93" strokeWidth={11} strokeLinecap="round" />
			<circle cx="50" cy="50" r="11" fill="#C9A35A" />
		</svg>
	);
}

type MarcaProps = {
	/** Nome da frente atual (ex.: "MotorCob"). Se ausente, mostra só "MotorCX" (login pré-frente). */
	frente?: string | null;
	/** Cor do texto: onLight (#1D1D1F) ou onDark (#FFFFFF). */
	tone?: 'onLight' | 'onDark';
	className?: string;
	markClass?: string;
};

/** Marca completa: símbolo + nome da frente (17px/700) + "por MotorCX" (11px #8E8E93).
 *  No login (sem frente) mostra apenas "MotorCX". */
export function MarcaMotorCX({ frente, tone = 'onLight', className, markClass = 'h-7 w-7' }: MarcaProps) {
	const text = tone === 'onDark' ? '#FFFFFF' : '#1D1D1F';
	const sub = tone === 'onDark' ? 'rgba(255,255,255,0.55)' : '#8E8E93';
	return (
		<span className={`inline-flex items-center gap-2 ${className ?? ''}`}>
			<MotorCXMark className={markClass} />
			{frente ? (
				<span className="flex flex-col leading-none">
					<span className="text-[17px] font-bold tracking-tight" style={{ color: text }}>{frente}</span>
					<span className="mt-0.5 text-[11px]" style={{ color: sub }}>por MotorCX</span>
				</span>
			) : (
				<span className="text-[17px] font-bold tracking-tight" style={{ color: text }}>MotorCX</span>
			)}
		</span>
	);
}
