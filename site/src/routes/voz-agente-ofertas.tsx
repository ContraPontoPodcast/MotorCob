import type { Route } from './+types/voz-agente-ofertas';
import { seo } from '@/lib/seo';
import { OfertasAgente } from '@/components/fluxo/ofertas';
export function meta({ matches, location }: Route.MetaArgs) { return seo({ matches, location }, { title: 'Ofertas da carteira · Agente de voz · MotorCX', description: 'De onde vêm as ofertas do agente: a API do credor ou o arquivo do dia, em que ordem. O agente não calcula.', noindex: true }); }
export default function VozAgenteOfertas() { return <OfertasAgente />; }
