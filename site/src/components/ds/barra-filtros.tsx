// BarraFiltros: os filtros principais numa linha; os secundários em "Mais filtros" (gaveta).
// No celular, tudo recolhido atrás de um botão "Filtros" (só `direita` continua visível, ex.: o SeloRegras).
import { useState, type ReactNode } from 'react';
import { SlidersHorizontal } from 'lucide-react';
import { Botao } from './base';
import { Gaveta } from './gaveta';

export function BarraFiltros({ children, mais, maisAtivos = 0, nota, direita, onLimparMais }: {
	/** Filtros principais (selects, busca). */
	children?: ReactNode;
	/** Filtros secundários: aparecem na gaveta "Mais filtros". */
	mais?: ReactNode;
	/** Quantos filtros secundários estão em uso (aparece no botão). */
	maisAtivos?: number;
	/** Nota curta depois dos filtros (ex.: "Todas as carteiras"). */
	nota?: ReactNode;
	/** Fica à direita e sempre visível (ex.: SeloRegras de privacidade). */
	direita?: ReactNode;
	/** Botão "Limpar" na gaveta de mais filtros. */
	onLimparMais?: () => void;
}) {
	const [aberto, setAberto] = useState(false);
	const [gaveta, setGaveta] = useState(false);
	const sufixo = maisAtivos > 0 ? ` (${maisAtivos})` : '';
	return (
		<div className="mb-4 flex min-w-0 flex-wrap items-center gap-2" data-ds-filtros="">
			<Botao tipo="secundario" pequeno className="md:!hidden" expandido={aberto} onClick={() => setAberto(a => !a)}>
				<SlidersHorizontal size={14} aria-hidden="true" />Filtros{sufixo}
			</Botao>
			<div className={`${aberto ? 'flex w-full' : 'hidden'} min-w-0 flex-wrap items-center gap-2 md:flex md:w-auto [&>select]:flex-[1_1_140px] md:[&>select]:flex-none`}>
				{children}
				{mais && <Botao tipo="fantasma" pequeno onClick={() => setGaveta(true)}><SlidersHorizontal size={14} aria-hidden="true" />Mais filtros{sufixo}</Botao>}
				{nota && <span className="text-[12px] text-[var(--base-texto-3)]">{nota}</span>}
			</div>
			{direita && <div className="ml-auto flex min-w-0 flex-wrap items-center gap-2">{direita}</div>}
			{mais && (
				<Gaveta aberta={gaveta} onFechar={() => setGaveta(false)} titulo="Mais filtros" largura={400}
					rodape={<>{onLimparMais && <Botao tipo="secundario" onClick={onLimparMais}>Limpar</Botao>}<Botao onClick={() => setGaveta(false)}>Pronto</Botao></>}>
					<div className="flex flex-col gap-3 [&_select]:w-full">{mais}</div>
				</Gaveta>
			)}
		</div>
	);
}
