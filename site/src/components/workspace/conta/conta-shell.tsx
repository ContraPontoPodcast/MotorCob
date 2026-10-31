import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { useNavigate, useSearchParams } from 'react-router';

const TABS = [
	{ id: 'dados', label: 'Dados' },
	{ id: 'seguranca', label: 'Segurança' },
	{ id: 'notificacoes', label: 'Notificações' },
	{ id: 'preferencias', label: 'Preferências' },
	{ id: 'perfil', label: 'Meu perfil' },
];

/**
 * Minha conta: as mesmas abas segmentadas em qualquer largura (Onda 3; no celular o select saiu). A barra rola de
 * lado, um degradê na borda mostra que há mais abas, a aba ativa entra na tela e a barra fica fixa no topo.
 * role=tablist com setas, Home e End; a aba continua em ?aba=.
 */
export function ContaShell({ children }: { children: ReactNode }) {
	const [params] = useSearchParams();
	const navigate = useNavigate();
	const aba = params.get('aba') || 'dados';
	const barra = useRef<HTMLDivElement>(null);
	const [fade, setFade] = useState({ e: false, d: false });

	function medir() {
		const el = barra.current;
		if (!el) return;
		setFade({ e: el.scrollLeft > 4, d: el.scrollLeft + el.clientWidth < el.scrollWidth - 4 });
	}

	// A aba ativa entra na tela (centralizada na barra) e os degradês acompanham a rolagem e a largura.
	useEffect(() => {
		const el = barra.current;
		const at = el?.querySelector<HTMLElement>('[aria-selected="true"]');
		if (el && at) el.scrollLeft = Math.max(0, at.offsetLeft - (el.clientWidth - at.offsetWidth) / 2);
		medir();
	}, [aba]);
	useEffect(() => {
		window.addEventListener('resize', medir);
		return () => window.removeEventListener('resize', medir);
	}, []);

	function ir(id: string, foco = false) {
		navigate(`/conta?aba=${id}`);
		if (foco) window.requestAnimationFrame(() => document.getElementById(`conta-aba-${id}`)?.focus());
	}

	function teclas(e: KeyboardEvent<HTMLButtonElement>, i: number) {
		let j: number | null = null;
		if (e.key === 'ArrowRight') j = (i + 1) % TABS.length;
		else if (e.key === 'ArrowLeft') j = (i - 1 + TABS.length) % TABS.length;
		else if (e.key === 'Home') j = 0;
		else if (e.key === 'End') j = TABS.length - 1;
		if (j === null) return;
		e.preventDefault();
		ir(TABS[j].id, true);
	}

	const ativa = TABS.find(t => t.id === aba) ?? TABS[0];
	return (
		<div className="mx-auto max-w-[760px] px-4 py-8">
			<h1 className="mb-4 text-[23px] font-bold tracking-tight text-[#1D1D1F] sm:mb-5 sm:text-[26px]">Minha conta</h1>
			<div className="sticky top-11 z-20 -mx-1 mb-[18px] bg-white px-1 py-1.5">
				<div className="relative">
					<div ref={barra} onScroll={medir} role="tablist" aria-label="Minha conta"
						className="no-scrollbar flex snap-x snap-proximity gap-1 overflow-x-auto rounded-[12px] bg-[#F5F5F7] p-1">
						{TABS.map((t, i) => (
							<button
								key={t.id}
								id={`conta-aba-${t.id}`}
								type="button"
								role="tab"
								aria-selected={aba === t.id}
								aria-controls="conta-painel"
								tabIndex={aba === t.id ? 0 : -1}
								onClick={() => ir(t.id)}
								onKeyDown={e => teclas(e, i)}
								className={`shrink-0 snap-start whitespace-nowrap rounded-[9px] px-[13px] py-[7px] text-[15px] transition-colors ${aba === t.id ? 'bg-white font-semibold text-[#1D1D1F] shadow-[0_1px_3px_rgba(0,0,0,0.12)]' : 'font-medium text-[#1D1D1F] hover:bg-[#E8E8ED]'}`}
							>
								{t.label}
							</button>
						))}
					</div>
					{fade.e && <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 left-0 w-7 rounded-l-[12px]" style={{ background: 'linear-gradient(90deg, var(--base-fill), transparent)' }} />}
					{fade.d && <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 right-0 w-7 rounded-r-[12px]" style={{ background: 'linear-gradient(270deg, var(--base-fill), transparent)' }} />}
				</div>
			</div>
			<div role="tabpanel" id="conta-painel" aria-labelledby={`conta-aba-${ativa.id}`}>
				{children}
			</div>
		</div>
	);
}

export const cardShadow = '0 0 0 1px #E5E5EA, 0 2px 12px rgba(0,0,0,.04)';
