// Glossário do MotorCX — só SELECT em glossario e o rpc buscar_glossario(texto).
// Nenhuma tabela/view/política é criada aqui. Gravações só pela edição da tela
// /ajuda/o-que-significa (update/insert em glossario), já limitada pela RLS admin_equipe().

import { supabase } from '@/lib/supabase';

export type GlossarioTerm = {
	slug: string;
	grupo: string;
	termo: string;
	definicao: string;
	exemplo: string | null;
	antes: string | null;
	ordem: number;
};

/** Chama o rpc buscar_glossario(texto). Texto vazio devolve todos (ordenados por ordem). */
export async function buscarGlossario(texto: string): Promise<GlossarioTerm[]> {
	if (!supabase) return [];
	const { data, error } = await supabase.rpc('buscar_glossario', { texto });
	if (error) {
		// 42501 = permissão ausente no Supabase remoto (o GRANT SELECT em
		// public.glossario para anon/authenticated ainda não foi aplicado).
		// O glossário é conteúdo de referência: degrada silenciosamente para
		// vazio em vez de propagar o erro. Assim que o grant for aplicado, a
		// chamada volta a devolver os termos normalmente.
		if ((error as { code?: string }).code === '42501') return [];
		throw error;
	}
	return (data ?? []) as GlossarioTerm[];
}

/** Divide o campo "antes" só por ", " (nunca por "·"). */
export function parseAntes(antes: string | null | undefined): string[] {
	if (!antes) return [];
	return antes.split(', ').map((s) => s.trim()).filter(Boolean);
}

/** Corta a definição em `max` caracteres, com "…". */
export function cortarDefinicao(def: string, max = 140): string {
	if (!def) return '';
	if (def.length <= max) return def;
	return def.slice(0, max).trimEnd() + '…';
}

/** Valida o slug de um termo novo: a-z0-9 com hífens. */
export function slugValido(slug: string): boolean {
	return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug);
}
