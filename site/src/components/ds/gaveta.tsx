// Gaveta (painel lateral com cabeçalho, corpo e rodapé) e Modal de confirmação.
// Esc fecha, clique fora fecha, o foco vai para o "Fechar" ao abrir, fica preso dentro (Tab) e volta para onde
// estava ao fechar. Com gavetas empilhadas, só a de cima responde ao Esc.
import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { Botao, clsBotao } from './base';
import { SOMBRA_ALTA } from './tom';

const FOCAVEIS = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"]), summary';

/** Comportamento comum de janela sobreposta (Esc, foco preso, rolagem da página travada). */
function useJanela(ref: React.RefObject<HTMLElement | null>, onFechar: () => void, focoInicial: string) {
	const fechar = useRef(onFechar);
	fechar.current = onFechar;
	useEffect(() => {
		const antes = document.activeElement as HTMLElement | null;
		ref.current?.querySelector<HTMLElement>(focoInicial)?.focus();
		const ehTopo = () => {
			const todas = document.querySelectorAll('[data-ds-janela]');
			return todas[todas.length - 1] === ref.current;
		};
		const tecla = (e: KeyboardEvent) => {
			if (!ehTopo()) return;
			if (e.key === 'Escape') { e.preventDefault(); fechar.current(); return; }
			if (e.key !== 'Tab' || !ref.current) return;
			const els = [...ref.current.querySelectorAll<HTMLElement>(FOCAVEIS)].filter(el => el.offsetParent !== null || el === document.activeElement);
			if (!els.length) return;
			const prim = els[0], ult = els[els.length - 1];
			if (e.shiftKey && document.activeElement === prim) { e.preventDefault(); ult.focus(); }
			else if (!e.shiftKey && document.activeElement === ult) { e.preventDefault(); prim.focus(); }
		};
		document.addEventListener('keydown', tecla);
		const overflow = document.body.style.overflow;
		document.body.style.overflow = 'hidden';
		return () => {
			document.removeEventListener('keydown', tecla);
			document.body.style.overflow = overflow;
			if (antes && document.contains(antes)) antes.focus();
		};
	}, [ref, focoInicial]);
}

export type GavetaProps = {
	/** Fechada, não renderiza nada. */
	aberta: boolean;
	onFechar: () => void;
	titulo: ReactNode;
	/** Linha de apoio abaixo do título (ex.: permissão exigida, preço mínimo). */
	subtitulo?: ReactNode;
	/** Ações da gaveta, alinhadas à direita. A principal por último. */
	rodape?: ReactNode;
	children?: ReactNode;
	/** Largura máxima em px (padrão 480). No celular ocupa a tela toda. */
	largura?: number;
	/** Nome acessível quando o título não é texto. */
	rotulo?: string;
};

/** Painel da gaveta sem portal nem efeitos (usado pela Gaveta e pelos testes). */
export function PainelGaveta({ titulo, subtitulo, rodape, children, onFechar, largura = 480, rotulo, refPainel }: Omit<GavetaProps, 'aberta'> & { refPainel?: React.Ref<HTMLElement> }) {
	return (
		<aside ref={refPainel} data-ds-janela="" role="dialog" aria-modal="true" aria-label={rotulo ?? (typeof titulo === 'string' ? titulo : undefined)}
			className="flex h-full w-full flex-col bg-[var(--base-cartao)] text-[var(--base-texto)]" style={{ maxWidth: largura, boxShadow: SOMBRA_ALTA }}>
			<header className="flex items-start gap-2.5 border-b px-4 py-3.5 sm:px-5" style={{ borderColor: 'var(--base-borda)' }}>
				<div className="min-w-0 flex-1">
					<h2 className="text-[16.5px] font-semibold leading-snug">{titulo}</h2>
					{subtitulo && <p className="mt-0.5 text-[12.5px] leading-relaxed text-[var(--base-texto-2)]">{subtitulo}</p>}
				</div>
				<button type="button" data-fechar="" onClick={onFechar} aria-label="Fechar" className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-[var(--base-texto-2)] hover:bg-[var(--base-fill)]"><X size={17} aria-hidden="true" /></button>
			</header>
			<div className="flex min-h-0 flex-1 flex-col gap-3.5 overflow-y-auto px-4 py-4 sm:px-5">{children}</div>
			{rodape && <footer className="flex flex-wrap justify-end gap-2 border-t px-4 py-3 sm:px-5" style={{ borderColor: 'var(--base-borda)' }}>{rodape}</footer>}
		</aside>
	);
}

function JanelaGaveta(p: Omit<GavetaProps, 'aberta'>) {
	const ref = useRef<HTMLElement>(null);
	useJanela(ref, p.onFechar, '[data-fechar]');
	return (
		<div className="fixed inset-0 z-[60] flex justify-end bg-black/40" onMouseDown={e => { if (e.target === e.currentTarget) p.onFechar(); }}>
			<PainelGaveta {...p} refPainel={ref} />
		</div>
	);
}

/** Gaveta lateral. Use para o detalhe de uma linha, formulários e listas secundárias. */
export function Gaveta({ aberta, ...p }: GavetaProps) {
	if (!aberta || typeof document === 'undefined') return null;
	return createPortal(<JanelaGaveta {...p} />, document.body);
}

export type ModalProps = {
	titulo: string;
	texto?: ReactNode;
	children?: ReactNode;
	onFechar: () => void;
	onConfirmar?: () => void;
	/** Texto do botão de confirmação (verbo da ação, nunca "OK"). */
	confirmar?: string;
	ocupado?: boolean;
	desabilitado?: boolean;
	/** Confirmação de ação destrutiva (botão em vermelho). */
	perigo?: boolean;
	/** Botões próprios no lugar de Cancelar/Confirmar (aí `confirmar`/`onConfirmar` não são usados). */
	acoes?: ReactNode;
};

function JanelaModal({ titulo, texto, children, onFechar, onConfirmar, confirmar, ocupado, desabilitado, perigo, acoes }: ModalProps) {
	const ref = useRef<HTMLDivElement>(null);
	useJanela(ref, onFechar, 'input, textarea, select, button[data-confirmar], button');
	return (
		<div className="fixed inset-0 z-[70] grid place-items-center bg-black/40 p-4" onMouseDown={e => { if (e.target === e.currentTarget) onFechar(); }}>
			<div ref={ref} data-ds-janela="" role="dialog" aria-modal="true" aria-label={titulo} className="w-full max-w-[460px] rounded-2xl bg-[var(--base-cartao)] p-5 text-[var(--base-texto)]" style={{ boxShadow: SOMBRA_ALTA }}>
				<h2 className="text-[16px] font-semibold">{titulo}</h2>
				{texto && <p className="mt-1 text-[13px] leading-relaxed text-[var(--base-texto-2)]">{texto}</p>}
				{children && <div className="mt-3 space-y-3">{children}</div>}
				<div className="mt-4 flex flex-wrap justify-end gap-2">
					{acoes ?? <>
					<Botao tipo="secundario" onClick={onFechar}>Cancelar</Botao>
					<button type="button" data-confirmar="" className={clsBotao(perigo ? 'perigo' : 'primario')} onClick={onConfirmar} disabled={ocupado || desabilitado}>{ocupado ? 'Aguarde…' : confirmar}</button>
					</>}
				</div>
			</div>
		</div>
	);
}

/** Modal de confirmação (sempre montado só quando aberto: `{x && <Modal …/>}`). */
export function Modal(p: ModalProps) {
	if (typeof document === 'undefined') return null;
	return createPortal(<JanelaModal {...p} />, document.body);
}
