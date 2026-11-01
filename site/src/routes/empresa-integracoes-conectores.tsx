import type { Route } from './+types/empresa-integracoes-conectores';
import { seo } from '@/lib/seo';
import { ConectoresCrm } from '@/components/fluxo/conectores';
export function meta({ matches, location }: Route.MetaArgs) { return seo({ matches, location }, { title: 'Conectores do CRM · MotorCX', description: 'APIs do CRM que o agente virtual chama durante a ligação.', noindex: true }); }
export default function EmpresaIntegracoesConectores() { return <ConectoresCrm />; }
