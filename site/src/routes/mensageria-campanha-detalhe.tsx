import type { Route } from './+types/mensageria-campanha-detalhe';
import { seo } from '@/lib/seo';
import { CampanhaDetalhe } from '@/components/mensageria/campanha-detalhe';

export function meta({ matches, location }: Route.MetaArgs) {
	return seo({ matches, location }, { title: 'Campanha · Mensageria · MotorCX', description: 'Detalhe da campanha.', noindex: true });
}

export default function MensageriaCampanhaDetalhe() {
	return <CampanhaDetalhe />;
}
