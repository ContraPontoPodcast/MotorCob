import type { Route } from './+types/speech-roleplay-lado-a-lado';
import { seo } from '@/lib/seo';
import { Roleplay } from '@/components/speech/roleplay';
export function meta({ matches, location }: Route.MetaArgs) { return seo({ matches, location }, { title: 'Treino lado a lado · Roleplay · MotorCX', description: 'A Qualidade abre a sessão de treino nesta máquina para a pessoa treinar ao lado.', noindex: true }); }
export default function SpeechRoleplayLadoALado({ params }: Route.ComponentProps) { return <Roleplay key={`${params.id}:${params.op}`} tela={{ tipo: 'lado_a_lado', id: params.id, op: params.op }} />; }
