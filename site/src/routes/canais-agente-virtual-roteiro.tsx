import type { Route } from './+types/canais-agente-virtual-roteiro';
import { seo } from '@/lib/seo';
import { RoteiroAgente } from '@/components/voz/roteiro';
// Roteiro antigo (SQL 56): continua valendo na carteira até um fluxo entrar em uso nela (o executor cai no roteiro).
export function meta({ matches, location }: Route.MetaArgs) { return seo({ matches, location }, { title: 'Roteiro do agente virtual · MotorCX', description: 'Roteiro do agente virtual por carteira: rascunho, aprovação e uso.', noindex: true }); }
export default function CanaisAgenteVirtualRoteiro() { return <RoteiroAgente />; }
