// Aviso (no máximo um por seção) e Estado (vazio, carregando, erro, sem permissão).
import type { ReactNode } from 'react';
import { Inbox, Lock, TriangleAlert, Clock } from 'lucide-react';
import { TOM, type Tom } from './tom';

export function Aviso({ tom = 'atencao', titulo, children, acao }: { tom?: Tom; titulo?: ReactNode; children?: ReactNode; acao?: ReactNode }) {
	const t = TOM[tom];
	return (
		<div role="status" className="flex flex-wrap items-start gap-2.5 rounded-xl px-3.5 py-2.5 text-[13px] text-[var(--base-texto)] md:flex-nowrap" style={{ backgroundColor: t.fundo }}>
			<span aria-hidden="true" className="mt-[4px] inline-block h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: t.ponto }} />
			<span className="min-w-0 flex-1">{titulo && <b className="font-semibold">{titulo} </b>}{children}</span>
			{acao && <span className="w-full pl-5 md:w-auto md:self-center md:pl-0">{acao}</span>}
		</div>
	);
}

export type TipoEstado = 'vazio' | 'carregando' | 'erro' | 'semPermissao';

const ICONE: Record<TipoEstado, ReactNode> = {
	vazio: <Inbox size={18} aria-hidden="true" />,
	carregando: <Clock size={18} aria-hidden="true" />,
	erro: <TriangleAlert size={18} aria-hidden="true" />,
	semPermissao: <Lock size={18} aria-hidden="true" />,
};

/**
 * Estado de uma tela ou seção. `carregando` sem título mostra o esqueleto (KPIs + blocos).
 * `semPermissao` diz quem dá o acesso; nunca mostra o código técnico da permissão no título.
 */
export function Estado({ tipo, titulo, children, acoes, compacto }: { tipo: TipoEstado; titulo?: ReactNode; children?: ReactNode; acoes?: ReactNode; compacto?: boolean }) {
	if (tipo === 'carregando' && !titulo) return <Esqueleto />;
	return (
		<div role={tipo === 'erro' ? 'alert' : 'status'} className={`flex flex-col items-center gap-1.5 rounded-2xl bg-[var(--base-fill)] text-center ${compacto ? 'px-4 py-6' : 'px-5 py-10'}`} data-estado={tipo}>
			<span className="mb-1 grid h-11 w-11 place-items-center rounded-full bg-[var(--base-cartao)]" style={{ color: tipo === 'erro' ? 'var(--estado-erro-texto)' : 'var(--base-texto-2)' }}>{ICONE[tipo]}</span>
			{titulo && <h3 className="text-[15px] font-semibold text-[var(--base-texto)]">{titulo}</h3>}
			{children && <p className="max-w-[520px] text-[13px] leading-relaxed text-[var(--base-texto-2)]">{children}</p>}
			{acoes && <div className="mt-2 flex flex-wrap justify-center gap-2">{acoes}</div>}
		</div>
	);
}

/** Esqueleto de carregamento: 4 KPIs e dois blocos. */
export function Esqueleto({ blocos = 2 }: { blocos?: number }) {
	const cls = 'animate-pulse rounded-xl bg-[var(--base-fill)] motion-reduce:animate-none';
	return (
		<div role="status" aria-label="Carregando" className="space-y-3">
			<div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{[0, 1, 2, 3].map(i => <div key={i} className={`${cls} h-[86px]`} />)}</div>
			{Array.from({ length: blocos }, (_, i) => <div key={i} className={`${cls} ${i ? 'h-[160px]' : 'h-[240px]'}`} />)}
		</div>
	);
}
