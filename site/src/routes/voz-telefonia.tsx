import type { Route } from './+types/voz-telefonia';
import { seo } from '@/lib/seo';
import { Telefonia } from '@/components/agente-voz/telefonia';
export function meta({ matches, location }: Route.MetaArgs) { return seo({ matches, location }, { title: 'Telefonia · Agente Voz/CX · MotorCX', description: 'Por onde o MotorCX liga: rota, bina e transferência.', noindex: true }); }
export default function VozTelefoniaRoute() { return <Telefonia />; }
