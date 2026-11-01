import type { Route } from './+types/canais-agente-virtual-desempenho';
import { seo } from '@/lib/seo';
import { DesempenhoFluxo } from '@/components/fluxo/desempenho';
export function meta({ matches, location }: Route.MetaArgs) { return seo({ matches, location }, { title: 'Desempenho do fluxo · MotorCX', description: 'Onde as pessoas saem do fluxo do agente virtual.', noindex: true }); }
export default function CanaisAgenteVirtualDesempenho() { return <DesempenhoFluxo />; }
