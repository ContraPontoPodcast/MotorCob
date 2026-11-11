import type { Route } from './+types/treino-briefing';
import { seo } from '@/lib/seo';
import { PaginaBriefing } from '@/components/treino/pagina';
export function meta({ matches, location }: Route.MetaArgs) { return [...seo({ matches, location }, { title: 'Treino · MotorCX', description: 'Briefing do treino com cliente simulado.', noindex: true, path: '/treino' }), { name: 'referrer', content: 'no-referrer' }]; }
export default function TreinoBriefingRoute({ params }: Route.ComponentProps) { return <PaginaBriefing key={`${params.token}:${params.atr}`} token={params.token} atr={params.atr} />; }
