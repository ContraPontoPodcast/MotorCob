import type { Route } from './+types/mensageria-score';
import { seo } from '@/lib/seo';
import { ScoreEconomia } from '@/components/mensageria/score-economia';

export function meta({ matches, location }: Route.MetaArgs) {
	return seo({ matches, location }, { title: 'Economia do Score · Mensageria · MotorCX', description: 'Quanto o Score de Entrega fez você economizar.', noindex: true });
}

export default function MensageriaScore() {
	return <ScoreEconomia />;
}
