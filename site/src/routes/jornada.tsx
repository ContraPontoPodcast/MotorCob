import type { Route } from './+types/jornada';
import { seo } from '@/lib/seo';
import { JornadaInicio } from '@/components/jornada/inicio';
export function meta({ matches, location }: Route.MetaArgs) { return seo({ matches, location }, { title: 'Jornada | MotorCX', description: 'Visão geral da jornada do cliente por momento.' }); }
export default function JornadaRoute() { return <JornadaInicio />; }
