import type { Route } from './+types/ajuda-glossario';
import { seo } from '@/lib/seo';
import { GlossarioPage } from '@/components/glossario/glossario-page';

export function meta({ matches, location }: Route.MetaArgs) {
	return seo({ matches, location }, {
		title: 'O que significa · MotorCX',
		description: 'Glossário do MotorCX: um nome para cada coisa. Procure pelo nome de hoje ou por um nome antigo.',
		noindex: true,
	});
}

export default function AjudaGlossario() {
	return <GlossarioPage />;
}
