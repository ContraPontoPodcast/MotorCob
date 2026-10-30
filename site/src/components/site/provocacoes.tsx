import { useEffect, useRef, useState } from 'react';
import { provocacoes } from '@/data/site';

function useActiveAt62() {
	const ref = useRef<HTMLParagraphElement>(null);
	const [active, setActive] = useState(false);
	useEffect(() => {
		const el = ref.current;
		if (!el) return;
		if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) { setActive(true); return; }
		const io = new IntersectionObserver(([entry]) => setActive(entry.isIntersecting), { rootMargin: '0px 0px -38% 0px', threshold: 0 });
		io.observe(el);
		return () => io.disconnect();
	}, []);
	return { ref, active };
}

function Frase({ main, sub }: { main: string; sub?: string }) {
	const { ref, active } = useActiveAt62();
	return (
		<p ref={ref} className="ls-tight max-w-[1000px] text-center font-bold transition-colors duration-500" style={{ fontSize: 'clamp(30px, 6vw, 84px)', lineHeight: 1.08, color: active ? '#1D1D1F' : '#C7C7CC' }}>
			{main} {sub && <span className="text-[#6E6E73]">{sub}</span>}
		</p>
	);
}

export function Provocacoes() {
	return (
		<section className="bg-[#F5F5F7] px-5 py-24 md:py-36">
			<div className="mx-auto flex max-w-[1120px] flex-col items-center gap-16 md:gap-24">
				{provocacoes.map((p, i) => <Frase key={i} main={p.main} sub={p.sub} />)}
			</div>
		</section>
	);
}
