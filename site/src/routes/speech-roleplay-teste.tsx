import type { Route } from './+types/speech-roleplay-teste';
import { seo } from '@/lib/seo';
import { Roleplay } from '@/components/speech/roleplay';
export function meta({ matches, location }: Route.MetaArgs) { return seo({ matches, location }, { title: 'Resultado do teste · Cenários · Roleplay · MotorCX', description: 'Resultado do teste do cenário pela Qualidade: nada conta para operador.', noindex: true }); }
export default function SpeechRoleplayTeste({ params }: Route.ComponentProps) { return <Roleplay key={params.sid} tela={{ tipo: 'teste', id: params.id, sid: params.sid }} />; }
