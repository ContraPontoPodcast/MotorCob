import type { Route } from './+types/jornada-mensagens';
import { seo } from '@/lib/seo';
import { JornadaMensagens } from '@/components/jornada/mensagens';

export function meta({ matches, location }: Route.MetaArgs) {
	return seo({ matches, location }, { title: 'Mensagens por momento · Jornada | MotorCX', description: 'Frases de cada momento da jornada, por canal.', noindex: true });
}

export default function Route() {
	return <JornadaMensagens />;
}
