import type { Route } from './+types/voz';
import { seo } from '@/lib/seo';
import { VisaoGeralVoz } from '@/components/agente-voz/visao-geral';
export function meta({ matches, location }: Route.MetaArgs) { return seo({ matches, location }, { title: 'Agente Voz/CX · MotorCX', description: 'Agente de voz, discagem, ligações e telefonia.', noindex: true }); }
export default function VozRoute() { return <VisaoGeralVoz />; }
