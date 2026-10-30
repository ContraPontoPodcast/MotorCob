import type { Route } from './+types/mensageria-config-atendimento';
import { seo } from '@/lib/seo';
import { ConfigAtendimento } from '@/components/mensageria/config-atendimento';

export function meta({ matches, location }: Route.MetaArgs) {
	return seo({ matches, location }, { title: 'Atendimento · Configurar · Mensageria | MotorCX', description: 'Meta de primeira resposta, avisos e respostas rápidas.', noindex: true });
}

export default function MensageriaConfigAtendimento() {
	return <ConfigAtendimento />;
}
