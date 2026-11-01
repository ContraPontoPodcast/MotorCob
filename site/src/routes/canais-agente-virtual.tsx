import type { Route } from './+types/canais-agente-virtual';
import { seo } from '@/lib/seo';
import { ListaFluxos } from '@/components/fluxo/lista';
export function meta({ matches, location }: Route.MetaArgs) { return seo({ matches, location }, { title: 'Fluxos do agente virtual · MotorCX', description: 'Um fluxo de conversa por carteira: versões, aprovação e uso.', noindex: true }); }
export default function CanaisAgenteVirtual() { return <ListaFluxos />; }
