import type { Route } from './+types/voz-discagem-robos';
import { seo } from '@/lib/seo';
import { RobosPreditivo } from '@/components/discagem/robos-preditivo';

export function meta({ matches, location }: Route.MetaArgs) {
	return seo({ matches, location }, { title: 'Robôs e o Preditivo · MotorCX', description: 'Por que a licença conta conversas com o robô, não linhas discando: Power e Preditivo.' });
}

export default function RobosPreditivoRoute() { return <RobosPreditivo />; }
