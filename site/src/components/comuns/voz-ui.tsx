// Peças visuais das telas do agente de voz (Console › Agente virtual, Empresa › Privacidade e gravações,
// Empresa › Faturamento). Só tokens do tema (--base-*, --estado-*, --destaque): valem no claro e no escuro.
// Gaveta e Dialogo usam o design system ('@/components/ds'); tela nova importa de lá.
import type { ReactNode } from 'react';
import { Lock } from 'lucide-react';
import { Gaveta as GavetaDs, Modal, SOMBRA, clsBotao } from '@/components/ds';

export const sombraCartao = SOMBRA;

export function Cartao({ titulo, desc, acoes, children, className = '', semPad, id }: {
	titulo?: ReactNode; desc?: ReactNode; acoes?: ReactNode; children?: ReactNode; className?: string; semPad?: boolean; id?: string;
}) {
	return (
		<section id={id} className={`rounded-2xl bg-[var(--base-cartao)] ${semPad ? '' : 'p-5 sm:p-6'} ${className}`} style={{ boxShadow: sombraCartao }}>
			{(titulo || acoes) && (
				<div className={`flex flex-wrap items-start justify-between gap-3 ${semPad ? 'px-5 pt-5 sm:px-6' : ''} ${children ? 'mb-4' : ''}`}>
					<div className="min-w-0 flex-1 basis-full sm:basis-0">
						{titulo && <h2 className="text-[17px] font-semibold text-[var(--base-texto)]">{titulo}</h2>}
						{desc && <p className="mt-1 max-w-[760px] text-[13px] leading-relaxed text-[var(--base-texto-2)]">{desc}</p>}
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
				<h3 className="text-[15px] font-semibold text-[var(--base-texto)]">{children}</h3>
				{desc && <p className="mt-0.5 max-w-[760px] text-[13px] leading-relaxed text-[var(--base-texto-2)]">{desc}</p>}
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
		<div role={tom === 'erro' ? 'alert' : 'status'} className={`flex items-start gap-2.5 rounded-xl px-3.5 py-3 text-[13px] leading-relaxed text-[var(--base-texto)] ${className}`} style={{ backgroundColor: t.bg }}>
			<span aria-hidden className="mt-px grid h-5 w-5 shrink-0 place-items-center rounded-full text-[11px] font-extrabold" style={{ backgroundColor: t.dot, color: 'var(--base-cartao)' }}>{simbolo}</span>
			<span className="min-w-0">{titulo && <b>{titulo} </b>}{children}</span>
		</div>
	);
}

/** Bloco de destaque com ícone (a "trava" do protótipo). */
export function Trava({ icone, titulo, children, className = '' }: { icone: ReactNode; titulo: ReactNode; children?: ReactNode; className?: string }) {
	return (
		<div className={`flex items-start gap-3 rounded-xl border border-[var(--base-borda)] bg-[var(--base-fill)] px-4 py-3 ${className}`}>
			<span className="mt-0.5 shrink-0 text-[var(--base-texto-2)]">{icone}</span>
			<div className="min-w-0 text-[13px] leading-relaxed">
				<div className="font-semibold text-[var(--base-texto)]">{titulo}</div>
				{children && <div className="mt-0.5 text-[var(--base-texto-2)]">{children}</div>}
			</div>
		</div>
	);
}

/** Cadeado no lugar da ação para quem não tem a permissão (mesmo visual de "Ligar envio real"). */
export function Cadeado({ children }: { children: ReactNode }) {
	return (
		<span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--base-fill)] px-3 py-1.5 text-[12px] font-medium text-[var(--base-texto-3)]">
			<Lock size={12} /> {children}
		</span>
	);
}

/** Estado vazio claro, sem erro. */
export function Vazio({ titulo, children }: { titulo: string; children?: ReactNode }) {
	return (
		<div className="rounded-xl bg-[var(--base-fill)] px-4 py-7 text-center">
			<p className="text-[14px] font-semibold text-[var(--base-texto)]">{titulo}</p>
			{children && <p className="mx-auto mt-1 max-w-[520px] text-[13px] leading-relaxed text-[var(--base-texto-2)]">{children}</p>}
		</div>
	);
}

export const btnPrim = clsBotao('primario');
export const btnSec = clsBotao('secundario');
export const btnLink = 'text-[13px] font-semibold text-[var(--destaque)] hover:underline disabled:opacity-50';
export const campoCls = 'h-10 w-full rounded-lg border border-[var(--base-field-border)] bg-[var(--base-cartao)] px-3 text-[14px] text-[var(--base-texto)] outline-none focus:border-[var(--destaque)]';

export function Campo({ rotulo, ajuda, erro, children, htmlFor }: { rotulo: ReactNode; ajuda?: ReactNode; erro?: string; children: ReactNode; htmlFor?: string }) {
	return (
		<div className="min-w-0">
			<label htmlFor={htmlFor} className="mb-1 block text-[13px] font-semibold text-[var(--base-texto)]">{rotulo}</label>
			{children}
			{erro ? <p className="mt-1 text-[12px]" style={{ color: 'var(--estado-erro-texto)' }}>{erro}</p>
				: ajuda ? <p className="mt-1 text-[12px] leading-relaxed text-[var(--base-texto-3)]">{ajuda}</p> : null}
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
export const thCls = 'border-b border-[var(--base-borda)] py-2 pr-3 text-[12px] font-semibold text-[var(--base-texto-2)]';
export const tdCls = 'border-b border-[var(--base-borda)] py-2.5 pr-3 align-top text-[var(--base-texto)]';

/** Gaveta lateral (atalho para a Gaveta do design system, sempre aberta enquanto montada). */
export function Gaveta({ titulo, onClose, children, rodape, largura = 480, subtitulo }: {
	titulo: string; onClose: () => void; children: ReactNode; rodape: ReactNode; largura?: number; subtitulo?: ReactNode;
}) {
	return <GavetaDs aberta onFechar={onClose} titulo={titulo} subtitulo={subtitulo} rodape={rodape} largura={largura}>{children}</GavetaDs>;
}

/** Diálogo central (confirmação com campo), com o visual e o comportamento do Modal do design system. */
export function Dialogo({ titulo, texto, onClose, children, acoes }: { titulo: string; texto?: ReactNode; onClose: () => void; children?: ReactNode; acoes: ReactNode }) {
	return <ModalLivre titulo={titulo} texto={texto} onClose={onClose} acoes={acoes}>{children}</ModalLivre>;
}

function ModalLivre({ titulo, texto, onClose, children, acoes }: { titulo: string; texto?: ReactNode; onClose: () => void; children?: ReactNode; acoes: ReactNode }) {
	// O Modal do DS tem os botões Cancelar/Confirmar próprios; aqui as ações vêm prontas, então usamos só a moldura.
	return (
		<Modal titulo={titulo} texto={texto} onFechar={onClose} acoes={acoes}>{children}</Modal>
	);
}
