import type { Route } from './+types/mensageria-voz-lotes';
import { seo } from '@/lib/seo';
import { LotesVoz } from '@/components/voz/lotes';
export function meta({ matches, location }: Route.MetaArgs) { return seo({ matches, location }, { title: 'Lotes do agente virtual · MotorCX', description: 'Lotes de ligações do agente virtual.', noindex: true }); }
export default function MensageriaVozLotes() { return <LotesVoz />; }
