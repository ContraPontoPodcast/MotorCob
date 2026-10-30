import type { Route } from './+types/mensageria-atendimento';
import { seo } from '@/lib/seo';
import { Atendimento } from '@/components/mensageria/atendimento';

export function meta({ matches, location }: Route.MetaArgs) {
	return seo({ matches, location }, { title: 'Caixa de atendimento · Mensageria | MotorCX', description: 'Atenda as conversas de SMS, RCS e WhatsApp em uma só caixa.', noindex: true });
}

export default function MensageriaAtendimento() {
	return <Atendimento />;
}
