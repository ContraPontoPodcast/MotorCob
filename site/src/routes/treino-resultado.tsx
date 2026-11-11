import type { Route } from './+types/treino-resultado';
import { seo } from '@/lib/seo';
import { PaginaResultadoOperador } from '@/components/treino/pagina';
export function meta({ matches, location }: Route.MetaArgs) { return [...seo({ matches, location }, { title: 'Resultado do treino · MotorCX', description: 'Resultado formativo do treino com cliente simulado.', noindex: true, path: '/treino' }), { name: 'referrer', content: 'no-referrer' }]; }
export default function TreinoResultadoRoute({ params }: Route.ComponentProps) { return <PaginaResultadoOperador key={params.sessao} token={params.token} atr={params.atr} sessao={params.sessao} />; }
