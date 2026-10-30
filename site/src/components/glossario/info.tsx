import { useEffect, useId, useRef, useState } from 'react';
import { Link } from 'react-router';
import { useGlossario } from '@/components/glossario/glossario-provider';
import { cortarDefinicao } from '@/lib/glossario';

/**
 * O (i) que leva ao termo do glossário. Mesmo visual do InfoButton da Mensageria
 * (círculo 18 px com "i", balão ao clicar). Conteúdo: termo + definição (cortada em
 * 140 caracteres) e o link "Ver no glossário" → /ajuda/o-que-significa#slug.
 * Carrega o glossário uma vez por sessão (cache no contexto) e não mostra o (i) se o
 * slug não existir.
 */
export function Info({ slug }: { slug: string }) {
	const { bySlug, loading } = useGlossario();
	const [open, setOpen] = useState(false);
	const [pos, setPos] = useState<{ left: number; top: number; width: number } | null>(null);
	const btnRef = useRef<HTMLButtonElement>(null);
	const labelId = useId();

	const term = bySlug.get(slug);

	useEffect(() => {
		if (!open) return;
		function place() {
			const r = btnRef.current?.getBoundingClientRect();
			if (!r) return;
			const width = Math.min(320, window.innerWidth - 24);
			let left = r.left + r.width / 2 - width / 2;
			left = Math.max(12, Math.min(left, window.innerWidth - width - 12));
			const top = r.bottom + 8;
			setPos({ left, top, width });
		}
		place();
		function onKey(e: KeyboardEvent) {
			if (e.key === 'Escape') {
				setOpen(false);
				btnRef.current?.focus();
			}
		}
		function onClick(e: MouseEvent) {
			const t = e.target as Node;
			if (btnRef.current?.contains(t)) return;
			setOpen(false);
		}
		function onScroll() {
			setOpen(false);
		}
		document.addEventListener('keydown', onKey);
		document.addEventListener('mousedown', onClick);
		window.addEventListener('scroll', onScroll, true);
		window.addEventListener('resize', onScroll);
		return () => {
			document.removeEventListener('keydown', onKey);
			document.removeEventListener('mousedown', onClick);
			window.removeEventListener('scroll', onScroll, true);
			window.removeEventListener('resize', onScroll);
		};
	}, [open]);

	// Não mostra o (i) se o slug não existir (nem enquanto carrega).
	if (loading || !term) return null;

	return (
		<span className="relative inline-flex align-middle">
			<button
				ref={btnRef}
				type="button"
				onClick={() => setOpen((o) => !o)}
				aria-label={`O que é ${term.termo}`}
				aria-expanded={open}
				aria-describedby={open ? labelId : undefined}
				className="grid h-[18px] w-[18px] shrink-0 place-items-center rounded-full border border-[var(--base-field-border)] text-[11px] italic leading-none text-[var(--base-texto-2)] transition-colors hover:bg-[var(--base-texto)] hover:text-white data-[open=true]:bg-[var(--base-texto)] data-[open=true]:text-white"
				data-open={open}
			>
				i
			</button>
			{open && pos && (
				<div
					id={labelId}
					role="tooltip"
					className="fixed z-[120] rounded-[14px] p-4 text-left"
					style={{
						left: pos.left,
						top: pos.top,
						width: pos.width,
						backgroundColor: 'var(--base-cartao)',
						boxShadow: '0 0 0 1px var(--base-borda), 0 12px 40px -8px rgba(0,0,0,.2)',
					}}
				>
					<p className="text-[14px] font-semibold text-[var(--base-texto)]">{term.termo}</p>
					<p className="mt-1.5 text-[13px] leading-relaxed text-[var(--base-texto)]">{cortarDefinicao(term.definicao)}</p>
					<Link
						to={`/ajuda/o-que-significa#${slug}`}
						onMouseDown={(e) => e.stopPropagation()}
						className="mt-2.5 inline-flex items-center gap-1 text-[12.5px] font-semibold text-[var(--destaque)] hover:underline"
					>
						Ver no glossário
					</Link>
				</div>
			)}
		</span>
	);
}
