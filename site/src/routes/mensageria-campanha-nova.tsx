import type { Route } from './+types/mensageria-campanha-nova';
import { seo } from '@/lib/seo';
import { CampanhaNova } from '@/components/mensageria/campanha-nova';

export function meta({ matches, location }: Route.MetaArgs) {
	return seo({ matches, location }, { title: 'Nova campanha · Mensageria · MotorCX', description: 'Criar campanha.', noindex: true });
}

export default function MensageriaCampanhaNova() {
	return <CampanhaNova />;
}
