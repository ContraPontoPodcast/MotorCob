import { useEffect, useState } from 'react';
import { useLocation } from 'react-router';
import { X } from 'lucide-react';
import { useAssistente } from './assistente-context';
import { AVATAR_ASSISTENTE } from '@/lib/assistente';

/** Botão fixo do Assistente no canto inferior direito (só páginas do Workspace). */
export function AssistenteAvatar() {
	const { abrirGaveta, oculto, drawerOpen, balaoVisivel, balaoSaindo, esconderAssistente } = useAssistente();
	const loc = useLocation();
	const [elevado, setElevado] = useState(false);

	// Detecta um botão fixo no mesmo canto (ex.: "Salvar" da Orquestração) e sobe 64 px.
	useEffect(() => {
		if (oculto || drawerOpen) { setElevado(false); return; }
		let active = true;
		function checar() {
			if (!active) return;
			const vw = window.innerWidth;
			const vh = window.innerHeight;
			const alvo = vw - 96; // faixa direita (~96 px)
			const alvoBaixo = vh - 96; // faixa inferior (~96 px)
			let tem = false;
			const els = document.body.querySelectorAll<HTMLElement>('*');
			for (const el of els) {
				if (el.dataset && el.dataset.mcAvatar === '1') continue; // o próprio avatar/balão
				const cs = window.getComputedStyle(el);
				if (cs.position !== 'fixed') continue;
				const r = el.getBoundingClientRect();
				if (r.width === 0 || r.height === 0) continue;
				// Ignora overlays de tela cheia (modais/backdrops).
				if (r.left <= 8 && r.top <= 8 && r.right >= vw - 8 && r.bottom >= vh - 8) continue;
				if (r.right >= alvo && r.bottom >= alvoBaixo) { tem = true; break; }
			}
			setElevado(tem);
		}
		const t = setTimeout(checar, 120);
		const mo = new MutationObserver(() => { if (active) setTimeout(checar, 60); });
		mo.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'style'] });
		return () => { active = false; clearTimeout(t); mo.disconnect(); };
	}, [oculto, drawerOpen, loc.pathname]);

	// Escondido pelo usuário ou com a gaveta aberta: o avatar fixo não aparece.
	if (oculto || drawerOpen) return null;

	return (
		<div data-mc-avatar="1" className="fixed right-5 z-40 flex items-end gap-2" style={{ bottom: elevado ? 'calc(5.5rem + env(safe-area-inset-bottom))' : '1.25rem', paddingBottom: 'env(safe-area-inset-bottom)' }}>
			{balaoVisivel && (
				<div
					className="mb-1 max-w-[180px] rounded-[14px_14px_4px_14px] bg-white px-3.5 py-2.5 text-[13.5px] leading-snug text-[#1D1D1F] transition-opacity duration-[400ms] ease-out motion-reduce:transition-none"
					style={{ boxShadow: '0 4px 16px rgba(0,0,0,.12)', opacity: balaoSaindo ? 0 : 1 }}
				>
					Dúvida? Fala comigo!
				</div>
			)}
			<div className="relative">
				<button
					onClick={abrirGaveta}
					aria-label="Falar com o assistente"
					className="group grid h-16 w-16 place-items-center rounded-full bg-white transition-transform duration-200 hover:-translate-y-0.5 hover:-rotate-4"
					style={{ border: '3px solid #fff', boxShadow: '0 8px 24px rgba(0,0,0,.22)' }}
				>
					<img src={AVATAR_ASSISTENTE} alt="" className="h-full w-full rounded-full object-cover" />
				</button>
				<button
					onClick={(e) => { e.stopPropagation(); esconderAssistente(); }}
					aria-label="Esconder o assistente"
					title="Esconder o assistente"
					className="absolute -left-1 -top-1 grid h-[22px] w-[22px] place-items-center rounded-full border-2 border-white bg-[#1D1D1F] text-white"
					style={{ boxShadow: '0 2px 6px rgba(0,0,0,.25)' }}
				>
					<X size={13} strokeWidth={2.5} />
				</button>
			</div>
		</div>
	);
}
