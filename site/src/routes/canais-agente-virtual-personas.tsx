import type { Route } from './+types/canais-agente-virtual-personas';
import { seo } from '@/lib/seo';
import { TestarPersonas } from '@/components/fluxo/personas';
export function meta({ matches, location }: Route.MetaArgs) { return seo({ matches, location }, { title: 'Testar com personas · MotorCX', description: 'Conversas simuladas em lote com personas de ficção.', noindex: true }); }
export default function CanaisAgenteVirtualPersonas() { return <TestarPersonas />; }
