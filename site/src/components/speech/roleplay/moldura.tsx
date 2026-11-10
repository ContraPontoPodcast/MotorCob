// Moldura das telas do Roleplay: trilha clicável, cabeçalho com "← tela-mãe" (lib/rota-pai.ts), as abas do Speech
// Analytics (Roleplay marcada também nos detalhes) e a sub-navegação do Roleplay. Cada tela tem o próprio título,
// no h1 e na aba do navegador ("Cenários · Roleplay · MotorCX").
import { createContext, useContext, useEffect, type ReactNode } from 'react';
import { Link, useLocation, type LinkProps } from 'react-router';
import { estadoDe } from '@/components/comuns/voltar';
import { ChevronRight } from 'lucide-react';
import { PageHeading } from '@/components/app-shell';
import { SECOES_RP, ehSecaoRP, secaoRP, tituloDocumentoRP, trilhaRP, type ItemTrilha, type SecaoRP } from '@/lib/roleplay';
import { AbasSpeech } from '../abas-speech';

export function TrilhaRP({ itens }: { itens: ItemTrilha[] }) {
	return (
		<nav aria-label="Você está em" className="mb-2 min-w-0">
			<ol className="flex flex-wrap items-center gap-1 text-[12.5px] text-[var(--base-texto-3)]">
				{itens.map((i, k) => (
					<li key={k} className="flex min-w-0 items-center gap-1">
						{k > 0 && <ChevronRight size={12} aria-hidden="true" className="shrink-0" />}
						{i.to ? <Link to={i.to} className="truncate hover:text-[var(--base-texto)] hover:underline">{i.rotulo}</Link>
							: <span aria-current="page" className="truncate font-medium text-[var(--base-texto-2)]">{i.rotulo}</span>}
					</li>
				))}
			</ol>
		</nav>
	);
}

/** Seções irmãs do Roleplay. Trocar de seção substitui a entrada do histórico (o ⟵ do navegador não passa por
 *  cada seção visitada). No detalhe, a seção-mãe continua marcada. */
export function SubnavRP({ secao, exato }: { secao: SecaoRP; exato: boolean }) {
	return (
		<nav aria-label="Roleplay" className="mb-5 flex max-w-full flex-wrap gap-1">
			{SECOES_RP.map(s => {
				const atual = s.id === secao;
				const cls = `rounded-lg px-3 py-1.5 text-[13px] font-semibold ${atual ? 'bg-[var(--base-fill)] text-[var(--base-texto)]' : 'text-[var(--base-texto-2)] hover:bg-[var(--base-fill)] hover:text-[var(--base-texto)]'}`;
				return <Link key={s.id} to={s.to} replace aria-current={atual ? (exato ? 'page' : 'true') : undefined} className={cls}>{s.nome}</Link>;
			})}
		</nav>
	);
}

/** Título da tela do Roleplay aberta agora (o "← Voltar" da tela seguinte diz para onde volta). */
const TelaAtualRP = createContext<string | null>(null);

/** Estado de navegação "vim desta tela" (regra única de Voltar, SPEC §2.1). */
export function useEstadoDe() {
	const { pathname, search } = useLocation();
	const titulo = useContext(TelaAtualRP);
	return titulo ? estadoDe(pathname + search, titulo) : undefined;
}

/** Link que abre uma tela "para dentro" lembrando a origem: o "← Voltar" (e o ⟵ do navegador) voltam para cá. */
export function LinkRP({ state, ...p }: LinkProps) {
	const de = useEstadoDe();
	return <Link {...p} state={state ?? de} />;
}

export function MolduraRP({ titulo, descricao, acoes, detalhe, meio, children }: {
	titulo: string; descricao?: string; acoes?: ReactNode;
	/** Nome da tela de detalhe (cenário, pessoa), para a trilha e o título da aba. */
	detalhe?: string | null;
	/** Degrau entre a seção e o detalhe (ex.: o treino, na sessão de uma pessoa). */
	meio?: ItemTrilha | null;
	children: ReactNode;
}) {
	const { pathname } = useLocation();
	const doc = tituloDocumentoRP(pathname, detalhe, meio);
	useEffect(() => { document.title = doc; }, [doc]);
	return (
		<TelaAtualRP.Provider value={titulo}>
			<TrilhaRP itens={trilhaRP(pathname, detalhe, meio)} />
			<PageHeading title={titulo} description={descricao} actions={acoes} semControles area="Speech Analytics › Roleplay" />
			<AbasSpeech atual="roleplay" />
			<SubnavRP secao={secaoRP(pathname) ?? 'painel'} exato={ehSecaoRP(pathname)} />
			{children}
		</TelaAtualRP.Provider>
	);
}
