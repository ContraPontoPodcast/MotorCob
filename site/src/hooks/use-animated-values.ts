import { useEffect, useRef, useState } from 'react';

/**
 * Anima (ease-out cúbico, ~0,9 s) todos os campos numéricos de `targets` a
 * partir do último valor exibido. Um único requestAnimationFrame por instância
 * (não um por número), para manter o desempenho. Quando `enabled` é false, os
 * valores saltam para `targets` sem animação — use para prefers-reduced-motion.
 */
export function useAnimatedValues<T extends Record<string, number>>(
	targets: T,
	duration = 900,
	enabled = true,
): T {
	const [display, setDisplay] = useState<T>(targets);
	const currentRef = useRef<T>(targets);

	useEffect(() => {
		if (!enabled) {
			currentRef.current = targets;
			setDisplay(targets);
			return;
		}
		const from = { ...currentRef.current } as Record<string, number>;
		const to = targets as Record<string, number>;
		const keys = Object.keys(to);
		const start = performance.now();
		let raf = 0;
		const tick = (now: number) => {
			const t = Math.min(1, (now - start) / duration);
			const eased = 1 - Math.pow(1 - t, 3);
			const next: Record<string, number> = {};
			for (const k of keys) {
				const f = from[k] ?? to[k];
				next[k] = f + (to[k] - f) * eased;
			}
			currentRef.current = next as T;
			setDisplay(next as T);
			if (t < 1) raf = requestAnimationFrame(tick);
		};
		raf = requestAnimationFrame(tick);
		return () => cancelAnimationFrame(raf);
	}, [targets, duration, enabled]);

	return display;
}
