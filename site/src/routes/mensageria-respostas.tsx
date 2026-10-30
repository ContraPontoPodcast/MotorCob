import { redirect } from 'react-router';
import type { Route } from './+types/mensageria-respostas';
import { seo } from '@/lib/seo';

export function meta({ matches, location }: Route.MetaArgs) {
	return seo({ matches, location }, { title: 'Respostas · Mensageria · MotorCX', description: 'Caixa de entrada de respostas.', noindex: true });
}

/** As respostas por canal agora vivem na caixa única de atendimento. */
export function clientLoader({ params }: Route.ClientLoaderArgs) {
	const canal = params.canal ?? '';
	const qs = canal ? `?canal=${encodeURIComponent(canal)}` : '';
	return redirect(`/mensageria/atendimento${qs}`);
}
