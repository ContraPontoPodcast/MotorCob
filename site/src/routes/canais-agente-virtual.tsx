import type { Route } from './+types/canais-agente-virtual';
import { seo } from '@/lib/seo';
import { RoteiroAgente } from '@/components/voz/roteiro';
export function meta({ matches, location }: Route.MetaArgs) { return seo({ matches, location }, { title: 'Roteiro do agente virtual · MotorCX', description: 'Roteiro do agente virtual por carteira: rascunho, aprovação e uso.', noindex: true }); }
export default function CanaisAgenteVirtual() { return <RoteiroAgente />; }
