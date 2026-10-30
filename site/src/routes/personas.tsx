import type { Route } from './+types/personas';
import { seo } from '@/lib/seo';
import { Personas } from '@/components/personas/personas';

export function meta({ matches, location }: Route.MetaArgs) {
	return seo({ matches, location }, {
		title: 'Personas · MotorCX',
		description: 'Clientes parecidos respondem pelos mesmos canais. O MotorCX aprende com as ocorrências e escolhe o melhor canal para cada cliente.',
	});
}

export default function PersonasRoute() {
	return <Personas />;
}
