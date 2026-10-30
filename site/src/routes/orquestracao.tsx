import type { Route } from './+types/orquestracao';
import { seo } from '@/lib/seo';
import { Orquestracao } from '@/components/orquestracao/orquestracao';
export function meta({ matches, location }: Route.MetaArgs) { return seo({ matches, location }, { title: 'Orquestração · MotorCX', description: 'Desenhe o que mandar para cada segmento: clusters, condições e a estratégia de cada momento.' }); }
export default function OrquestracaoRoute() { return <Orquestracao/>; }
