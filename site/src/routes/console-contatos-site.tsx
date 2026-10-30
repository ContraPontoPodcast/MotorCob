import type { Route } from './+types/console-contatos-site';
import { seo } from '@/lib/seo';
import { supabase } from '@/lib/supabase';
import type { ContatoSite } from '@/components/workspace/console/console-contatos-site';

export function meta({ matches, location }: Route.MetaArgs) {
	return seo({ matches, location }, { title: 'Contatos do site · MotorCX', description: 'Contatos recebidos pelo site.', noindex: true });
}

// Lê no navegador com a sessão de quem está logado; a RLS (SQL 52) só devolve linhas para a equipe MotorCob.
export async function clientLoader(): Promise<{ contatos: ContatoSite[] }> {
	try {
		if (!supabase) return { contatos: [] };
		const { data: sessao } = await supabase.auth.getSession();
		if (!sessao.session) return { contatos: [] };
		const { data, error } = await supabase
			.from('contatos_site')
			.select('id, nome, empresa, email, telefone, mensagem, origem, criado_em')
			.order('criado_em', { ascending: false })
			.limit(100);
		if (error) return { contatos: [] };
		return { contatos: (data ?? []) as ContatoSite[] };
	} catch {
		return { contatos: [] };
	}
}

export { ConsoleContatosSitePage as default } from '@/components/workspace/console/console-contatos-site';
