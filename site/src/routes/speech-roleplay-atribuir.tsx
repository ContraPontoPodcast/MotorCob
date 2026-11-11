import type { Route } from './+types/speech-roleplay-atribuir';
import { seo } from '@/lib/seo';
import { Roleplay } from '@/components/speech/roleplay';
export function meta({ matches, location }: Route.MetaArgs) { return seo({ matches, location }, { title: 'Atribuir treino · Roleplay · MotorCX', description: 'Escolha o cenário, quem treina, o prazo, a meta e as tentativas.', noindex: true }); }
export default function SpeechRoleplayAtribuir() { return <Roleplay tela={{ tipo: 'atribuir' }} />; }
