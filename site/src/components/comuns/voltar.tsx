// "← Tela-mãe" no topo das telas que se abrem a partir de outra. Só cores do tema (--base-*): funciona no claro e
// no escuro. O destino vem de src/lib/rota-pai.ts (nunca do histórico do navegador).
import { Link, useLocation } from 'react-router';
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

/** "← tela-mãe" da rota atual (src/lib/rota-pai.ts); nada quando a rota não tem tela-mãe. */
export function Voltar() {
	const { pathname } = useLocation();
	const { perfil } = useMotorAuth();
	const pai = rotaPai(pathname, { equipe: !!perfil?.equipe });
	return pai ? <div><VoltarPara {...pai} /></div> : null;
}
