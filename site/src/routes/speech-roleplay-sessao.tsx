import type { Route } from './+types/speech-roleplay-sessao';
import { seo } from '@/lib/seo';
import { Roleplay } from '@/components/speech/roleplay';
export function meta({ matches, location }: Route.MetaArgs) { return seo({ matches, location }, { title: 'Sessão · Treinos atribuídos · Roleplay · MotorCX', description: 'Resultado de uma sessão de treino: o que fez bem, o que treinar, revisar a avaliação e feedback 1:1.', noindex: true }); }
export default function SpeechRoleplaySessao({ params }: Route.ComponentProps) { return <Roleplay key={params.sid} tela={{ tipo: 'sessao', id: params.id, sid: params.sid }} />; }
