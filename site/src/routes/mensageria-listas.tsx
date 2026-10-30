import type { Route } from './+types/mensageria-listas';
import { seo } from '@/lib/seo';
import { ListasContato } from '@/components/mensageria/listas';

export function meta({ matches, location }: Route.MetaArgs) {
	return seo({ matches, location }, { title: 'Listas · Mensageria · MotorCX', description: 'Listas de contato.', noindex: true });
}

export default function MensageriaListas() {
	return <ListasContato />;
}
