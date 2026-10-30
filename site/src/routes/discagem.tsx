import type { Route } from './+types/discagem';
import { seo } from '@/lib/seo';
import { Discagem } from '@/components/discagem/discagem';

export function meta({ matches, location }: Route.MetaArgs) {
	return seo({ matches, location }, { title: 'Discagem · MotorCX', description: 'Regras de discagem da carteira: renitência, horários por UF/DDD e chamadas curtas.' });
}

export default function DiscagemRoute() { return <Discagem />; }
