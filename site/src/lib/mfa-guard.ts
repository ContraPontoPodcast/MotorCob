import type { SupabaseClient } from '@supabase/supabase-js';
import { proximoPasso } from '@/components/duasEtapasLogica';

/**
 * Guarda das páginas protegidas: com sessão, decide se o usuário precisa concluir
 * a verificação em duas etapas. Retorna '/login' quando não está "pronto" (ainda há
 * um passo de duas etapas pendente), ou null para liberar. Sem sessão é tratado
 * pelo chamador (que já redireciona para /login).
 *
 * Nenhum outro lugar decide sobre duas etapas: só esta função e o /login.
 */
export async function mfaRedirect(client: SupabaseClient, ehAdmin: boolean): Promise<string | null> {
	const passo = await proximoPasso(client, ehAdmin);
	return passo.etapa === 'pronto' ? null : '/login';
}
