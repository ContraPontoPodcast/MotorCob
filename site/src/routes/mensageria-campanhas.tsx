import type { Route } from './+types/mensageria-campanhas';
import { seo } from '@/lib/seo';
import { CampanhasLista } from '@/components/mensageria/campanhas-lista';

export function meta({ matches, location }: Route.MetaArgs) {
	return seo({ matches, location }, { title: 'Campanhas · Mensageria · MotorCX', description: 'Campanhas de mensageria.', noindex: true });
}

export default function MensageriaCampanhas() {
	return <CampanhasLista />;
}
