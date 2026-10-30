import type { Route } from './+types/mensageria-templates';
import { seo } from '@/lib/seo';
import { TemplatesCanal } from '@/components/mensageria/templates';

export function meta({ matches, location }: Route.MetaArgs) {
	return seo({ matches, location }, { title: 'Templates · Mensageria · MotorCX', description: 'Templates de mensageria.', noindex: true });
}

export default function MensageriaTemplates() {
	return <TemplatesCanal />;
}
