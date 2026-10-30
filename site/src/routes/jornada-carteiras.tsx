import type { Route } from './+types/jornada-carteiras';
import { seo } from '@/lib/seo';
import { JornadaCarteiras } from '@/components/jornada/carteiras';
export function meta({ matches, location }: Route.MetaArgs) { return seo({ matches, location }, { title: 'Carteiras · Jornada | MotorCX', description: 'Carteiras da frente Jornada do Cliente.' }); }
export default function JornadaCarteirasRoute() { return <JornadaCarteiras />; }
