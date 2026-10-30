import type { Route } from './+types/mensageria-radar';
import { seo } from '@/lib/seo';
import { PainelRadar } from '@/components/mensageria/painel-radar';

export function meta({ matches, location }: Route.MetaArgs) {
	return seo({ matches, location }, { title: 'Painel do Radar · Mensageria | MotorCX', description: 'Respostas recebidas, classes do Radar e atendimento.', noindex: true });
}

export default function MensageriaRadar() {
	return <PainelRadar />;
}
