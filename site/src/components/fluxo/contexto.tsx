// Contexto das telas do Fluxo do agente: empresa, carteira, permissões e a fonte de dados. Nas rotas de verdade vem
// do login (useMotorAuth) e do Supabase; no modo de demonstração (só desenvolvimento, VITE_FLUXO_FIXTURES=1) vem das
// fixturas, para ver as telas sem banco (Playwright).
import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { useMotorAuth } from '@/components/auth-provider';
import { supabase } from '@/lib/supabase';
import { apiSupabase, type FluxoApi } from './api';

export const BASE_FLUXO = '/canais/agente-virtual';
export type Tela = 'lista' | 'editor' | 'testar' | 'desempenho' | 'pedido' | 'personas' | 'conectores' | 'roteiro';

export interface CtxFluxo {
	empresa: { id: number; slug: string; nome: string } | null;
	credor: { id: number; nome: string } | null;
	credores: { id: number; nome: string }[];
	permissoes: string[];
	equipe: boolean;
	api: FluxoApi | null;
	demo: boolean;
	/** Endereço de cada tela (no modo de demonstração, tudo fica em /dev/fluxo/...). */
	rota: (tela: Tela, id?: number | string | null, busca?: Record<string, string | number | null | undefined>) => string;
}

export function rotaReal(tela: Tela, id?: number | string | null, busca?: Record<string, string | number | null | undefined>): string {
	const base = tela === 'conectores' ? '/empresa/integracoes/conectores'
		: tela === 'lista' ? BASE_FLUXO
		: `${BASE_FLUXO}/${tela}${id != null && id !== '' ? `/${id}` : ''}`;
	const q = Object.entries(busca ?? {}).filter(([, v]) => v != null && v !== '').map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`).join('&');
	return q ? `${base}?${q}` : base;
}

export const FixturaCtx = createContext<CtxFluxo | null>(null);

export function useFluxo(): CtxFluxo {
	const fx = useContext(FixturaCtx);
	const auth = useMotorAuth();
	const api = useMemo(() => (supabase ? apiSupabase(supabase) : null), []);
	if (fx) return fx;
	return {
		empresa: auth.empresa ? { id: Number(auth.empresa.id), slug: auth.empresa.slug, nome: auth.empresa.nome } : null,
		credor: auth.credor ? { id: Number(auth.credor.id), nome: auth.credor.nome } : null,
		credores: auth.credores.map(c => ({ id: Number(c.id), nome: c.nome })),
		permissoes: auth.permissoes,
		equipe: !!auth.perfil?.equipe,
		api,
		demo: false,
		rota: rotaReal,
	};
}

/** Permissões do backend: editar_canais edita; aprovar_roteiro_voz aprova e coloca em uso; editar_credores, a alçada.
 *  A equipe MotorCX não edita nem aprova o fluxo do cliente (pode_editar_fluxo_voz / pode_aprovar_fluxo_voz). */
export function usePermissoesFluxo() {
	const { permissoes, equipe } = useFluxo();
	return {
		editar: !equipe && permissoes.includes('editar_canais'),
		aprovar: !equipe && permissoes.includes('aprovar_roteiro_voz'),
		alcada: !equipe && permissoes.includes('editar_credores'),
		ver: equipe || permissoes.includes('editar_canais') || permissoes.includes('aprovar_roteiro_voz'),
	};
}

export function ProvedorFixturas({ valor, children }: { valor: CtxFluxo; children: ReactNode }) {
	return <FixturaCtx.Provider value={valor}>{children}</FixturaCtx.Provider>;
}
