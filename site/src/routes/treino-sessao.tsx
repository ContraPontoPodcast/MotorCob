import type { Route } from './+types/treino-sessao';
import { seo } from '@/lib/seo';
import { PaginaSessaoOperador } from '@/components/treino/pagina';
export function meta({ matches, location }: Route.MetaArgs) { return [...seo({ matches, location }, { title: 'Sessão de treino · MotorCX', description: 'Treino por texto com cliente simulado.', noindex: true, path: '/treino' }), { name: 'referrer', content: 'no-referrer' }]; }
export default function TreinoSessaoRoute({ params }: Route.ComponentProps) { return <PaginaSessaoOperador key={params.sessao} token={params.token} atr={params.atr} sessao={params.sessao} />; }
