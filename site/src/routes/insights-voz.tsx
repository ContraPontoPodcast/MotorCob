import type { Route } from './+types/insights-voz';
import { seo } from '@/lib/seo';
import { InsightsVoz } from '@/components/voz/insights';
export function meta({ matches, location }: Route.MetaArgs) { return seo({ matches, location }, { title: 'Insights de voz · MotorCX', description: 'O que as pessoas disseram nas ligações, só em números agregados.', noindex: true }); }
export default function InsightsVozRoute() { return <InsightsVoz />; }
