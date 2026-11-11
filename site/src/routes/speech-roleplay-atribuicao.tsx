import type { Route } from './+types/speech-roleplay-atribuicao';
import { seo } from '@/lib/seo';
import { Roleplay } from '@/components/speech/roleplay';
export function meta({ matches, location }: Route.MetaArgs) { return seo({ matches, location }, { title: 'Treino · Treinos atribuídos · Roleplay · MotorCX', description: 'Situação de cada pessoa no treino, links de treino, lembrete, prazo, tentativas e feedback 1:1.', noindex: true }); }
export default function SpeechRoleplayAtribuicao({ params }: Route.ComponentProps) { return <Roleplay key={params.id} tela={{ tipo: 'atribuicao', id: params.id }} />; }
