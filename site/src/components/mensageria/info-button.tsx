import { useEffect, useId, useRef, useState } from 'react';
import { Link } from 'react-router';
import type { InfoDef } from '@/lib/mensageria-info';
import { INFO_DEFS } from '@/lib/mensageria-info';
import { useGlossario } from '@/components/glossario/glossario-provider';

/** Mapa da chave do InfoDef → slug do glossário. Chave sem mapa: sem link. */
const SLUG_MAP: Record<string, string> = {
	fallback: 'fallback',
	bounce_permanente: 'bounce',
	bounce_temporario: 'bounce',
	score_entrega: 'score-de-entrega',
	disparados_sms: 'disparado-enviado-e-entregue',
	disparados_rcs: 'disparado-enviado-e-entregue',
	disparados_email: 'disparado-enviado-e-entregue',
	enviados: 'disparado-enviado-e-entregue',
	entregues_sms: 'disparado-enviado-e-entregue',
	entregues_email: 'disparado-enviado-e-entregue',
};

/** entregues_sms também ganha um 2º link "DLR". */
const SLUG_EXTRA: Record<string, { label: string; slug: string }> = {
	entregues_sms: { label: 'DLR', slug: 'dlr-delivery-report' },
};

/** Mapa reverso InfoDef → chave (para não mudar os pontos de uso). */
const DEF_KEY = new Map<InfoDef, string>(Object.entries(INFO_DEFS).map(([k, v]) => [v, k]));

/**
 * Botão "i" com balão explicativo. Posiciona-se com `position: fixed` a partir
 * do retângulo do botão, garantindo que fique sempre dentro da tela. Fecha com
 * Esc, clique fora ou rolagem. Mantém o texto da Mensageria e acrescenta o link
 * "Ver no glossário" quando a chave tem slug mapeado (e o termo existe).
 */
export function InfoButton({ def }: { def: InfoDef }) {
	const { bySlug, loading } = useGlossario();
	const [open, setOpen] = useState(false);
	const [pos, setPos] = useState<{ left: number; top: number; width: number } | null>(null);
	const btnRef = useRef<HTMLButtonElement>(null);
	const labelId = useId();

	const chave = DEF_KEY.get(def);
	const slug = chave ? SLUG_MAP[chave] : undefined;
	const extra = chave ? SLUG_EXTRA[chave] : undefined;
	const linkOk = (s: string) => loading || bySlug.has(s);

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
		function onKey(e: KeyboardEvent) { if (e.key === 'Escape') { setOpen(false); btnRef.current?.focus(); } }
		function onClick(e: MouseEvent) {
			const t = e.target as Node;
			if (btnRef.current?.contains(t)) return;
			setOpen(false);
		}
		function onScroll() { setOpen(false); }
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

	return (
		<span className="relative inline-flex align-middle">
			<button
				ref={btnRef}
				type="button"
				onClick={() => setOpen(o => !o)}
				aria-label={`O que é ${def.titulo}`}
				aria-expanded={open}
				aria-describedby={open ? labelId : undefined}
				className="grid h-[18px] w-[18px] shrink-0 place-items-center rounded-full border border-[#D2D2D7] text-[11px] italic leading-none text-[#6E6E73] transition-colors hover:bg-[#1D1D1F] hover:text-white data-[open=true]:bg-[#1D1D1F] data-[open=true]:text-white"
				data-open={open}
			>i</button>
			{open && pos && (
				<div
					id={labelId}
					role="tooltip"
					className="fixed z-[120] rounded-[14px] bg-white p-4 text-left"
					style={{ left: pos.left, top: pos.top, width: pos.width, boxShadow: '0 0 0 1px #E5E5EA, 0 12px 40px -8px rgba(0,0,0,.2)' }}
				>
					<p className="text-[14px] font-semibold text-[#1D1D1F]">{def.titulo}</p>
					<p className="mt-1.5 text-[13px] leading-relaxed text-[#1D1D1F]">{def.texto}</p>
					{def.calculo && <div className="mt-2.5 rounded-lg bg-[#F5F5F7] px-3 py-2 text-[12.5px] text-[#1D1D1F]">{def.calculo}</div>}
					{def.referencia && <p className="mt-2 text-[12.5px] text-[#6E6E73]">{def.referencia}</p>}
					{slug && linkOk(slug) && (
						<div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1">
							<Link to={`/ajuda/o-que-significa#${slug}`} onMouseDown={(e) => e.stopPropagation()} className="text-[12.5px] font-semibold text-[#0A60D0] hover:underline">Ver no glossário</Link>
							{extra && linkOk(extra.slug) && (
								<Link to={`/ajuda/o-que-significa#${extra.slug}`} onMouseDown={(e) => e.stopPropagation()} className="text-[12.5px] font-semibold text-[#0A60D0] hover:underline">{extra.label}</Link>
							)}
						</div>
					)}
				</div>
			)}
		</span>
	);
}
