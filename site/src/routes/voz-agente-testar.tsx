import type { Route } from './+types/voz-agente-testar';
import { seo } from '@/lib/seo';
import { TestarConversa } from '@/components/fluxo/testar';
export function meta({ matches, location }: Route.MetaArgs) { return seo({ matches, location }, { title: 'Testar conversa · MotorCX', description: 'Simulador de texto do fluxo do agente virtual.', noindex: true }); }
export default function CanaisAgenteVirtualTestar() { return <TestarConversa />; }
