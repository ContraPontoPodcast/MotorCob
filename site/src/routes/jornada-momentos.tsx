import type { Route } from './+types/jornada-momentos';
import { seo } from '@/lib/seo';
import { JornadaMomentos } from '@/components/jornada/momentos';
export function meta({ matches, location }: Route.MetaArgs) { return seo({ matches, location }, { title: 'Momentos da jornada | MotorCX', description: 'Defina os passos de cada momento da jornada.' }); }
export default function JornadaMomentosRoute() { return <JornadaMomentos />; }
