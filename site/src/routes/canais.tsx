import type { Route } from './+types/canais';
import { seo } from '@/lib/seo';
import { Canais } from '@/components/canais/canais';
export function meta({ matches, location }: Route.MetaArgs) { return seo({ matches, location }, { title: 'Canais · MotorCX', description: 'Ajuste horário, capacidade e custo de cada canal da empresa.' }); }
export default function CanaisRoute() { return <Canais/>; }
