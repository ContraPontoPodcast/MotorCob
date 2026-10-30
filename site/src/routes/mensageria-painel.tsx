import type { Route } from './+types/mensageria-painel';
import { seo } from '@/lib/seo';
import { PainelCanal } from '@/components/mensageria/painel';

export function meta({ matches, location }: Route.MetaArgs) {
	return seo({ matches, location }, { title: 'Painel · Mensageria · MotorCX', description: 'Painel de mensageria por canal.', noindex: true });
}

export default function MensageriaPainel() {
	return <PainelCanal />;
}
