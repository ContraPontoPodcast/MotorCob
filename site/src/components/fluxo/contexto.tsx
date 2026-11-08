// Contexto das telas do Fluxo do agente: empresa, carteira, permissões e a fonte de dados. Nas rotas de verdade vem
// do login (useMotorAuth) e do Supabase; no modo de demonstração (só desenvolvimento, VITE_FLUXO_FIXTURES=1) vem das
// fixturas, para ver as telas sem banco (Playwright).
import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { useMotorAuth } from '@/components/auth-provider';
import { useConsolePerms } from '@/components/workspace/console/console-perms';
import { supabase } from '@/lib/supabase';
import { apiSupabase, type FluxoApi } from './api';

export const BASE_FLUXO = '/voz/agente'; // Agente Voz/CX › Agente de voz (antes /canais/agente-virtual, que redireciona)
export type Tela = 'lista' | 'editor' | 'testar' | 'desempenho' | 'pedido' | 'personas' | 'conectores' | 'roteiro';

export interface CtxFluxo {
	empresa: { id: number; slug: string; nome: string } | null;
	credor: { id: number; nome: string } | null;
	credores: { id: number; nome: string }[];
	permissoes: string[];
	equipe: boolean;
	/** Equipe MotorCX com a permissão de Console que monta o fluxo do cliente (responder_chamados, SQL 68). */
	equipeMonta: boolean;
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
	const consola = useConsolePerms();
	const api = useMemo(() => (supabase ? apiSupabase(supabase) : null), []);
	if (fx) return fx;
	const equipe = !!auth.perfil?.equipe;
	return {
		empresa: auth.empresa ? { id: Number(auth.empresa.id), slug: auth.empresa.slug, nome: auth.empresa.nome } : null,
		credor: auth.credor ? { id: Number(auth.credor.id), nome: auth.credor.nome } : null,
		credores: auth.credores.map(c => ({ id: Number(c.id), nome: c.nome })),
		permissoes: auth.permissoes,
		equipe,
		equipeMonta: equipe && consola.can(PERMISSAO_EQUIPE_FLUXO),
		api,
		demo: false,
		rota: rotaReal,
	};
}

/** Permissão de Console com que a equipe MotorCX monta o fluxo do cliente: a mesma com que já entrega o pedido de fluxo
 *  feito a ela (entregar_pedido_fluxo_equipe). O banco confere em pode_editar_fluxo_voz (SQL 68). */
export const PERMISSAO_EQUIPE_FLUXO = 'responder_chamados';

export interface PermissoesFluxo { editar: boolean; aprovar: boolean; alcada: boolean; ver: boolean }

/** Permissões do backend: editar_canais edita; aprovar_roteiro_voz aprova e coloca em uso; editar_credores, a alçada.
 *  Equipe MotorCX (SQL 68): com responder_chamados monta o fluxo do cliente (cria, edita o rascunho, duplica, base de
 *  respostas, casos de teste, testa e envia para aprovação). Aprovar, colocar em uso e a alçada continuam só com o
 *  cliente (pode_aprovar_fluxo_voz). */
export function permissoesFluxo({ permissoes, equipe, equipeMonta }: Pick<CtxFluxo, 'permissoes' | 'equipe' | 'equipeMonta'>): PermissoesFluxo {
	return {
		editar: equipe ? equipeMonta : permissoes.includes('editar_canais'),
		aprovar: !equipe && permissoes.includes('aprovar_roteiro_voz'),
		alcada: !equipe && permissoes.includes('editar_credores'),
		ver: equipe || permissoes.includes('editar_canais') || permissoes.includes('aprovar_roteiro_voz'),
	};
}

export function usePermissoesFluxo(): PermissoesFluxo {
	return permissoesFluxo(useFluxo());
}

export function ProvedorFixturas({ valor, children }: { valor: CtxFluxo; children: ReactNode }) {
	return <FixturaCtx.Provider value={valor}>{children}</FixturaCtx.Provider>;
}
