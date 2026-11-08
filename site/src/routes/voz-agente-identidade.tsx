import type { Route } from './+types/voz-agente-identidade';
import { seo } from '@/lib/seo';
import { IdentidadeAgente } from '@/components/fluxo/identidade';
export function meta({ matches, location }: Route.MetaArgs) { return seo({ matches, location }, { title: 'Confirmar identidade · Agente de voz · MotorCX', description: 'Quem confere a identidade antes de o agente falar da dívida: CRM, arquivo ou os dois.', noindex: true }); }
export default function VozAgenteIdentidade() { return <IdentidadeAgente />; }
