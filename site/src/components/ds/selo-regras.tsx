// SeloRegras: chip com cadeado. Regras fixas, LGPD e "como funciona" saem do corpo da tela e ficam a um clique.
import { useState, type ReactNode } from 'react';
import { Lock } from 'lucide-react';
import { Gaveta } from './gaveta';

export type Regra = { titulo: ReactNode; texto?: ReactNode };

/** Lista de regras com cadeado (também serve dentro de uma gaveta ou de Detalhes). */
export function ListaRegras({ regras }: { regras: Regra[] }) {
	return (
		<ul className="divide-y" style={{ borderColor: 'var(--base-borda)' }}>
			{regras.map((r, i) => (
				<li key={i} className="flex gap-2.5 py-2.5 text-[13px] text-[var(--base-texto)]" style={{ borderColor: 'var(--base-borda)' }}>
					<Lock size={14} className="mt-0.5 shrink-0 text-[var(--base-texto-3)]" aria-hidden="true" />
					<span className="min-w-0">{r.titulo}{r.texto && <small className="mt-0.5 block text-[12px] text-[var(--base-texto-2)]">{r.texto}</small>}</span>
				</li>
			))}
		</ul>
	);
}

/**
 * Selo de regras: `rotulo` no chip; ao clicar abre a gaveta com `titulo`, a lista de `regras` e, opcionalmente,
 * conteúdo extra (`children`, ex.: o registro de buscas para o Admin).
 */
export function SeloRegras({ rotulo, titulo, subtitulo, regras, children }: { rotulo: string; titulo?: string; subtitulo?: ReactNode; regras: Regra[]; children?: ReactNode }) {
	const [aberto, setAberto] = useState(false);
	return (
		<>
			<button type="button" onClick={() => setAberto(true)} aria-haspopup="dialog"
				className="inline-flex max-w-full items-center gap-1.5 rounded-full bg-[var(--base-fill)] px-2.5 py-1 text-[12.5px] font-semibold text-[var(--base-texto-2)] hover:text-[var(--base-texto)]">
				<Lock size={13} aria-hidden="true" className="shrink-0" /><span className="truncate">{rotulo}</span>
			</button>
			<Gaveta aberta={aberto} onFechar={() => setAberto(false)} titulo={titulo ?? rotulo} subtitulo={subtitulo}>
				<ListaRegras regras={regras} />
				{children}
			</Gaveta>
		</>
	);
}
