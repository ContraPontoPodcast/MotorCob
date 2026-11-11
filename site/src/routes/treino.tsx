import type { Route } from './+types/treino';
import { seo } from '@/lib/seo';
import { PaginaMeusTreinos } from '@/components/treino/pagina';
// O token fica fora do canonical/og:url e o navegador não manda o endereço como Referer.
export function meta({ matches, location }: Route.MetaArgs) { return [...seo({ matches, location }, { title: 'Meus treinamentos · Treino · MotorCX', description: 'Treinos com cliente simulado passados pela Qualidade.', noindex: true, path: '/treino' }), { name: 'referrer', content: 'no-referrer' }]; }
export default function TreinoRoute({ params }: Route.ComponentProps) { return <PaginaMeusTreinos token={params.token} />; }
