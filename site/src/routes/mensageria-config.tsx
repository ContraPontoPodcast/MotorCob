import type { Route } from './+types/mensageria-config';
import { seo } from '@/lib/seo';
import { ConfigCanal } from '@/components/mensageria/config-canal';

export function meta({ matches, location }: Route.MetaArgs) {
	return seo({ matches, location }, { title: 'Configurações · Mensageria · MotorCX', description: 'Configurações de mensageria.', noindex: true });
}

export default function MensageriaConfig() {
	return <ConfigCanal />;
}
