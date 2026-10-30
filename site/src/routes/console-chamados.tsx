import { redirect } from 'react-router';
import type { Route } from './+types/console-chamados';

// Redirecionamento canônico: os avisos da equipe apontam para
// /console/chamados?id={id}, mas a tela de chamados é /console/atendimento.
export function clientLoader({ request }: Route.ClientLoaderArgs) {
	const url = new URL(request.url);
	return redirect(`/console/atendimento${url.search}`);
}
