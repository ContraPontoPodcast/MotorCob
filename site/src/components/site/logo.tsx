/** Símbolo Rotor do MotorCob — anel em 3 segmentos com ponto no centro.
 *  `tone` define as cores para fundo escuro (cabeçalho do site e menu lateral)
 *  ou fundo branco (login, "Apresentamos MotorCob", favicon). */
export function RotorMark({ tone = 'onLight', className }: { tone?: 'onLight' | 'onDark'; className?: string }) {
	const dark = tone === 'onDark';
	const ring = dark ? '#3A3A3C' : '#D2D2D7';
	const arc1 = '#C9A35A';
	const arc2 = dark ? '#EEEAE2' : '#1D1D1F';
	const arc3Opacity = dark ? 0.55 : 0.35;
	const sw = dark ? 11 : 8;
	return (
		<svg viewBox="0 0 100 100" className={className} fill="none" aria-hidden="true">
			<circle cx="50" cy="50" r="38" stroke={ring} strokeWidth={sw} />
			<path d="M50 12 A38 38 0 0 1 86.1 38.3" stroke={arc1} strokeWidth={sw} strokeLinecap="round" />
			<path d="M83.6 70 A38 38 0 0 1 30 82.3" stroke={arc2} strokeWidth={sw} strokeLinecap="round" />
			<path d="M16.4 67.6 A38 38 0 0 1 22 23.5" stroke={arc2} strokeWidth={sw} strokeLinecap="round" opacity={arc3Opacity} />
			<circle cx="50" cy="50" r="11" fill={arc1} />
		</svg>
	);
}

export function Logo({ tone = 'onLight', className, markClass = 'h-7 w-7' }: { tone?: 'onLight' | 'onDark'; className?: string; markClass?: string }) {
	const text = tone === 'onDark' ? '#FFFFFF' : '#1D1D1F';
	return (
		<span className={`inline-flex items-center gap-2 ${className ?? ''}`}>
			<RotorMark tone={tone} className={markClass} />
			<span style={{ color: text, fontWeight: 600, letterSpacing: '-0.02em' }} className="text-[19px]">MotorCX</span>
		</span>
	);
}
