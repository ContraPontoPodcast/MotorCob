// Peças comuns das telas do Speech Analytics: filtros (período e carteira à vista; origem e persona em
// "Mais filtros"), selo de privacidade, bloqueio (sem permissão / grupo pequeno), modal e trecho mascarado.
// As peças genéricas vêm do design system ('@/components/ds').
import type { ReactNode } from 'react';
import { ORIGENS, PERIODOS } from '@/lib/speech';
import { BarraFiltros as BarraDs, Estado, SeloRegras, campoCls, campoStyle, type Regra } from '@/components/ds';

export { Modal, Segmentos, textareaCls } from '@/components/ds';

export type Filtros = { empresaId: number; credorId: number | null; credorNome: string | null; dias: number; de: string; ate: string; origem: string };

/** Regras de privacidade comuns a todas as abas (o que antes ficava escrito ao lado dos filtros). */
export const REGRAS_PRIVACIDADE_SA: Regra[] = [
	{ titulo: 'Grupos com menos de 30 ligações não aparecem', texto: 'O servidor devolve vazio para o grupo pequeno: o número poderia apontar para uma pessoa.' },
	{ titulo: 'Nunca CPF, telefone ou nome de devedor', texto: 'Os trechos de conversa são mascarados antes de chegar aqui.' },
	{ titulo: 'Só dentro do prazo de retenção', texto: 'Quando a gravação é apagada, o trecho some junto.' },
];

export function SeloPrivacidade({ extra }: { extra?: Regra[] }) {
	return <SeloRegras rotulo="Privacidade" titulo="Privacidade no Speech Analytics" regras={[...REGRAS_PRIVACIDADE_SA, ...(extra ?? [])]} />;
}

export function BarraFiltros({ dias, setDias, origem, setOrigem, credorNome, extra, semOrigem, direita }: {
	dias: number; setDias: (d: number) => void; origem: string; setOrigem: (o: string) => void; credorNome: string | null;
	/** Filtros secundários além da origem (ex.: persona): vão para "Mais filtros". */
	extra?: ReactNode; semOrigem?: boolean;
	/** À direita (padrão: selo Privacidade). */
	direita?: ReactNode;
}) {
	const mais = (!semOrigem || extra) ? (
		<>
			{!semOrigem && <select aria-label="Origem" value={origem} onChange={e => setOrigem(e.target.value)} className={campoCls} style={campoStyle}>{ORIGENS.map(o => <option key={o.v} value={o.v}>{o.n}</option>)}</select>}
			{extra}
		</>
	) : undefined;
	return (
		<BarraDs mais={mais} maisAtivos={origem ? 1 : 0} onLimparMais={semOrigem ? undefined : () => setOrigem('')}
			nota={credorNome ? `Carteira ${credorNome}` : 'Todas as carteiras'}
			direita={direita ?? <SeloPrivacidade />}>
			<select aria-label="Período" value={dias} onChange={e => setDias(Number(e.target.value))} className={campoCls} style={campoStyle}>{PERIODOS.map(p => <option key={p.d} value={p.d}>{p.n}</option>)}</select>
		</BarraDs>
	);
}

/** Bloqueio: sem permissão ou recorte pequeno demais. */
export function Bloqueio({ titulo, children, acao, tipo = 'semPermissao' }: { titulo: string; children?: ReactNode; acao?: ReactNode; tipo?: 'semPermissao' | 'vazio' }) {
	return <Estado tipo={tipo} titulo={titulo} acoes={acao}>{children}</Estado>;
}

/** Trecho mascarado (nunca HTML do banco: texto puro). */
export function Trecho({ children }: { children: ReactNode }) {
	return <div className="mt-1.5 rounded-lg border-l-[3px] bg-[var(--base-fill)] px-3 py-2 text-[13px] leading-relaxed text-[var(--base-texto)]" style={{ borderColor: 'var(--base-borda)' }}>{children}</div>;
}
