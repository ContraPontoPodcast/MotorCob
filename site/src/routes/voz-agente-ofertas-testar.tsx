import type { Route } from './+types/voz-agente-ofertas-testar';
import { seo } from '@/lib/seo';
import { TestarOfertas } from '@/components/fluxo/ofertas';
export function meta({ matches, location }: Route.MetaArgs) { return seo({ matches, location }, { title: 'Testar ofertas · Agente de voz · MotorCX', description: 'De onde veio cada oferta e o que o agente diria, com um cliente fictício.', noindex: true }); }
export default function VozAgenteOfertasTestar() { return <TestarOfertas />; }
