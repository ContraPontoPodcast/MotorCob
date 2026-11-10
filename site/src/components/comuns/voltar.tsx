// "← Tela-mãe" no topo das telas que se abrem a partir de outra. Só cores do tema (--base-*): funciona no claro e
// no escuro. O destino vem de src/lib/rota-pai.ts. Exceção (regra única de Voltar do Roleplay, SPEC §2.1): quando a
// tela foi aberta de dentro do app por um link que guardou a origem (`state.de` + `state.deRotulo`, ver
// `estadoDe`), o "← Voltar" leva à tela de onde a pessoa veio pelo histórico (o mesmo lugar do ⟵ do navegador).
// Sem a origem (link direto, aba nova), continua indo para a tela-mãe.
import { createContext, useContext } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { ArrowLeft } from 'lucide-react';
import { useMotorAuth } from '@/components/auth-provider';
import { rotaPai } from '@/lib/rota-pai';

/** Link "← rótulo" para um destino fixo. */
export function VoltarPara({ to, rotulo }: { to: string; rotulo: string }) {
	return (
		<Link
			to={to}
			aria-label={`Voltar para ${rotulo}`}
			data-voltar
			className="mb-2 inline-flex min-h-[32px] max-w-full items-center gap-1.5 text-[13px] font-medium text-[var(--base-texto-2)] hover:text-[var(--base-texto)]"
		>
			<ArrowLeft size={14} aria-hidden className="shrink-0" />
			<span className="truncate">{rotulo}</span>
		</Link>
	);
}

/** Mesmo visual do VoltarPara, para voltar a um passo da própria tela (sem mudar de rota). Ex.: "Descrever segmentos
 *  e régua" volta para a lista de Segmentos da Orquestração. */
export function VoltarBotao({ rotulo, onClick }: { rotulo: string; onClick: () => void }) {
	return (
		<button
			type="button"
			onClick={onClick}
			aria-label={`Voltar para ${rotulo}`}
			data-voltar
			className="mb-2 inline-flex min-h-[32px] max-w-full items-center gap-1.5 text-[13px] font-medium text-[var(--base-texto-2)] hover:text-[var(--base-texto)]"
		>
			<ArrowLeft size={14} aria-hidden className="shrink-0" />
			<span className="truncate">{rotulo}</span>
		</button>
	);
}

/** Rota de verdade da tela quando o endereço é outro: o modo de demonstração (/dev/fluxo/...) mostra o mesmo voltar
 *  que a tela tem em /voz/agente/... */
export const RotaDaTela = createContext<string | null>(null);

/** Origem guardada no `state` do link (regra única de Voltar). */
export type EstadoDe = { de: string; deRotulo: string };
/** `state` para um Link que abre uma tela "para dentro": o "← Voltar" da tela aberta volta para cá. */
export const estadoDe = (de: string, deRotulo: string): EstadoDe => ({ de, deRotulo });
export function origemDoEstado(state: unknown): EstadoDe | null {
	const s = state as Partial<EstadoDe> | null;
	return s && typeof s.de === 'string' && s.de.startsWith('/') && typeof s.deRotulo === 'string' && s.deRotulo.trim() ? { de: s.de, deRotulo: s.deRotulo.trim() } : null;
}

/** "← tela-mãe" da rota atual (src/lib/rota-pai.ts); nada quando a rota não tem tela-mãe. Aberta de outra tela do
 *  app (state.de), volta para ela pelo histórico. */
export function Voltar() {
	const loc = useLocation();
	const navegar = useNavigate();
	const pathname = useContext(RotaDaTela) ?? loc.pathname;
	const { perfil } = useMotorAuth();
	const pai = rotaPai(pathname, { equipe: !!perfil?.equipe });
	const origem = pai ? origemDoEstado(loc.state) : null;
	if (origem) return <div><VoltarBotao rotulo={origem.deRotulo} onClick={() => navegar(-1)} /></div>;
	return pai ? <div><VoltarPara {...pai} /></div> : null;
}
