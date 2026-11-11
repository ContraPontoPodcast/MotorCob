import type { Route } from './+types/speech-roleplay-operador';
import { seo } from '@/lib/seo';
import { Roleplay } from '@/components/speech/roleplay';
export function meta({ matches, location }: Route.MetaArgs) { return seo({ matches, location }, { title: 'Pessoa · Roleplay · MotorCX', description: 'Treinos atribuídos, sessões de treino e feedbacks 1:1 de uma pessoa do Cadastro para treino.', noindex: true }); }
export default function SpeechRoleplayOperador({ params }: Route.ComponentProps) { return <Roleplay key={params.op} tela={{ tipo: 'pessoa', id: params.op }} />; }
