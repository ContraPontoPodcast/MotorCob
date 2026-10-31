// Peças visuais das telas do agente de voz (Console › Agente virtual, Empresa › Privacidade e gravações,
// Empresa › Faturamento). Seguem as cores do tema (variáveis --estado-* e a paleta Apple remapeada no index.css),
// então funcionam no claro e no escuro.
import { useEffect, type ReactNode } from 'react';
import { Lock, X } from 'lucide-react';

export const sombraCartao = '0 0 0 1px #E5E5EA, 0 2px 12px rgba(0,0,0,.04)';

export function Cartao({ titulo, desc, acoes, children, className = '', semPad, id }: {
	titulo?: ReactNode; desc?: ReactNode; acoes?: ReactNode; children?: ReactNode; className?: string; semPad?: boolean; id?: string;
}) {
	return (
		<section id={id} className={`rounded-2xl bg-white ${semPad ? '' : 'p-5 sm:p-6'} ${className}`} style={{ boxShadow: sombraCartao }}>
			{(titulo || acoes) && (
				<div className={`flex flex-wrap items-start justify-between gap-3 ${semPad ? 'px-5 pt-5 sm:px-6' : ''} ${children ? 'mb-4' : ''}`}>
					<div className="min-w-0 flex-1 basis-full sm:basis-0">
						{titulo && <h2 className="text-[17px] font-semibold text-[#1D1D1F]">{titulo}</h2>}
						{desc && <p className="mt-1 max-w-[760px] text-[13px] leading-relaxed text-[#6E6E73]">{desc}</p>}
					</div>
					{acoes && <div className="flex shrink-0 flex-wrap items-center gap-2">{acoes}</div>}
				</div>
			)}
			{children}
		</section>
	);
}

export function Subtitulo({ children, desc, acoes }: { children: ReactNode; desc?: ReactNode; acoes?: ReactNode }) {
	return (
		<div className="mb-3 flex flex-wrap items-start justify-between gap-3">
			<div className="min-w-0 flex-1 basis-full sm:basis-0">
				<h3 className="text-[15px] font-semibold text-[#1D1D1F]">{children}</h3>
				{desc && <p className="mt-0.5 max-w-[760px] text-[13px] leading-relaxed text-[#6E6E73]">{desc}</p>}
			</div>
			{acoes && <div className="flex shrink-0 flex-wrap items-center gap-2">{acoes}</div>}
		</div>
	);
}

type Tom = 'ok' | 'atencao' | 'erro' | 'info' | 'neutro';
const TOM: Record<Tom, { bg: string; fg: string; dot: string }> = {
	ok: { bg: 'var(--estado-pronto-fundo)', fg: 'var(--estado-pronto-texto)', dot: 'var(--estado-pronto)' },
	atencao: { bg: 'var(--estado-atencao-fundo)', fg: 'var(--estado-atencao-texto)', dot: 'var(--estado-atencao)' },
	erro: { bg: 'var(--estado-erro-fundo)', fg: 'var(--estado-erro-texto)', dot: 'var(--estado-erro)' },
	info: { bg: 'var(--estado-info-fundo)', fg: 'var(--estado-info)', dot: 'var(--estado-info)' },
	neutro: { bg: 'var(--base-fill)', fg: 'var(--base-texto-2)', dot: 'var(--base-texto-3)' },
};

export function Pilula({ tom = 'neutro', children, className = '' }: { tom?: Tom; children: ReactNode; className?: string }) {
	const t = TOM[tom];
	return <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-0.5 text-[12px] font-semibold ${className}`} style={{ backgroundColor: t.bg, color: t.fg }}>{children}</span>;
}

export function Ponto({ tom }: { tom: Tom }) {
	return <span aria-hidden className="inline-block h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: TOM[tom].dot }} />;
}

/** Faixa de aviso (o "notice" do protótipo). */
export function Aviso({ tom = 'atencao', titulo, children, className = '' }: { tom?: Tom; titulo?: ReactNode; children?: ReactNode; className?: string }) {
	const t = TOM[tom];
	const simbolo = tom === 'ok' ? '✓' : tom === 'info' || tom === 'neutro' ? 'i' : '!';
	return (
		<div role={tom === 'erro' ? 'alert' : 'status'} className={`flex items-start gap-2.5 rounded-xl px-3.5 py-3 text-[13px] leading-relaxed text-[#1D1D1F] ${className}`} style={{ backgroundColor: t.bg }}>
			<span aria-hidden className="mt-px grid h-5 w-5 shrink-0 place-items-center rounded-full text-[11px] font-extrabold" style={{ backgroundColor: t.dot, color: 'var(--base-cartao)' }}>{simbolo}</span>
			<span className="min-w-0">{titulo && <b>{titulo} </b>}{children}</span>
		</div>
	);
}

/** Bloco de destaque com ícone (a "trava" do protótipo). */
export function Trava({ icone, titulo, children, className = '' }: { icone: ReactNode; titulo: ReactNode; children?: ReactNode; className?: string }) {
	return (
		<div className={`flex items-start gap-3 rounded-xl border border-[#E5E5EA] bg-[#F5F5F7] px-4 py-3 ${className}`}>
			<span className="mt-0.5 shrink-0 text-[#6E6E73]">{icone}</span>
			<div className="min-w-0 text-[13px] leading-relaxed">
				<div className="font-semibold text-[#1D1D1F]">{titulo}</div>
				{children && <div className="mt-0.5 text-[#6E6E73]">{children}</div>}
			</div>
		</div>
	);
}

/** Cadeado no lugar da ação para quem não tem a permissão (mesmo visual de "Ligar envio real"). */
export function Cadeado({ children }: { children: ReactNode }) {
	return (
		<span className="inline-flex items-center gap-1.5 rounded-full bg-[#F5F5F7] px-3 py-1.5 text-[12px] font-medium text-[#8E8E93]">
			<Lock size={12} /> {children}
		</span>
	);
}

/** Estado vazio claro, sem erro. */
export function Vazio({ titulo, children }: { titulo: string; children?: ReactNode }) {
	return (
		<div className="rounded-xl bg-[#F5F5F7] px-4 py-7 text-center">
			<p className="text-[14px] font-semibold text-[#1D1D1F]">{titulo}</p>
			{children && <p className="mx-auto mt-1 max-w-[520px] text-[13px] leading-relaxed text-[#6E6E73]">{children}</p>}
		</div>
	);
}

export const btnPrim = 'mc-btn-primary inline-flex h-9 items-center justify-center gap-2 rounded-full px-4 text-[13px] font-semibold disabled:cursor-not-allowed disabled:opacity-50';
export const btnSec = 'inline-flex h-9 items-center justify-center gap-1.5 rounded-full border border-[#D2D2D7] px-4 text-[13px] font-semibold text-[#1D1D1F] hover:bg-[#F5F5F7] disabled:cursor-not-allowed disabled:opacity-50';
export const btnLink = 'text-[13px] font-semibold text-[#0A60D0] hover:underline disabled:opacity-50';
export const campoCls = 'h-10 w-full rounded-lg border border-[#D2D2D7] px-3 text-[14px] outline-none focus:border-[#1D1D1F]';

export function Campo({ rotulo, ajuda, erro, children, htmlFor }: { rotulo: ReactNode; ajuda?: ReactNode; erro?: string; children: ReactNode; htmlFor?: string }) {
	return (
		<div className="min-w-0">
			<label htmlFor={htmlFor} className="mb-1 block text-[13px] font-semibold text-[#1D1D1F]">{rotulo}</label>
			{children}
			{erro ? <p className="mt-1 text-[12px]" style={{ color: 'var(--estado-erro-texto)' }}>{erro}</p>
				: ajuda ? <p className="mt-1 text-[12px] leading-relaxed text-[#8E8E93]">{ajuda}</p> : null}
		</div>
	);
}

/** Tabela com rolagem lateral só dentro do cartão (no celular, a página não rola de lado). */
export function TabelaRolavel({ children, minW = 640 }: { children: ReactNode; minW?: number }) {
	return (
		<div className="-mx-1 overflow-x-auto px-1">
			<table className="w-full text-left text-[13.5px]" style={{ minWidth: minW }}>{children}</table>
		</div>
	);
}
export const thCls = 'border-b border-[#E5E5EA] py-2 pr-3 text-[12px] font-semibold text-[#6E6E73]';
export const tdCls = 'border-b border-[#F0F0F2] py-2.5 pr-3 align-top text-[#1D1D1F]';

/** Gaveta lateral (mesmo padrão da gaveta de fornecedor). */
export function Gaveta({ titulo, onClose, children, rodape, largura = 480 }: {
	titulo: string; onClose: () => void; children: ReactNode; rodape: ReactNode; largura?: number;
}) {
	useEffect(() => {
		const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
		window.addEventListener('keydown', h);
		return () => window.removeEventListener('keydown', h);
	}, [onClose]);
	return (
		<div className="fixed inset-0 z-[100] flex justify-end bg-black/40" onClick={onClose}>
			<div role="dialog" aria-modal="true" aria-label={titulo} className="flex h-full w-full flex-col bg-white" style={{ maxWidth: largura, boxShadow: '-12px 0 40px -8px rgba(0,0,0,.3)' }} onClick={e => e.stopPropagation()}>
				<div className="flex h-[60px] shrink-0 items-center justify-between border-b border-[#E5E5EA] px-5">
					<h2 className="text-[17px] font-semibold text-[#1D1D1F]">{titulo}</h2>
					<button onClick={onClose} aria-label="Fechar" className="text-[#8E8E93] hover:text-[#1D1D1F]"><X size={20} /></button>
				</div>
				<div className="flex-1 space-y-4 overflow-y-auto px-5 py-5">{children}</div>
				<div className="flex shrink-0 flex-wrap items-center justify-end gap-3 border-t border-[#E5E5EA] px-5 py-4">{rodape}</div>
			</div>
		</div>
	);
}

/** Diálogo central simples (confirmação com campo). */
export function Dialogo({ titulo, texto, onClose, children, acoes }: { titulo: string; texto?: ReactNode; onClose: () => void; children?: ReactNode; acoes: ReactNode }) {
	useEffect(() => {
		const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
		window.addEventListener('keydown', h);
		return () => window.removeEventListener('keydown', h);
	}, [onClose]);
	return (
		<div className="fixed inset-0 z-[120] grid place-items-center overflow-y-auto bg-black/40 px-4 py-8" onClick={onClose}>
			<div role="dialog" aria-modal="true" aria-label={titulo} className="my-auto w-full max-w-[460px] rounded-2xl bg-white p-6" style={{ boxShadow: '0 0 0 1px #E5E5EA, 0 24px 60px -20px rgba(0,0,0,.4)' }} onClick={e => e.stopPropagation()}>
				<h2 className="text-[17px] font-semibold text-[#1D1D1F]">{titulo}</h2>
				{texto && <div className="mt-2 text-[14px] leading-relaxed text-[#6E6E73]">{texto}</div>}
				{children && <div className="mt-4">{children}</div>}
				<div className="mt-5 flex flex-wrap justify-end gap-3">{acoes}</div>
			</div>
		</div>
	);
}
