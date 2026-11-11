import type { Route } from './+types/speech-roleplay-testar';
import { seo } from '@/lib/seo';
import { Roleplay } from '@/components/speech/roleplay';
export function meta({ matches, location }: Route.MetaArgs) { return seo({ matches, location }, { title: 'Testar cenário · Roleplay · MotorCX', description: 'A Qualidade conversa com o cliente simulado para testar o cenário antes de atribuir.', noindex: true }); }
export default function SpeechRoleplayTestar({ params }: Route.ComponentProps) { return <Roleplay key={params.id} tela={{ tipo: 'testar', id: params.id }} />; }
