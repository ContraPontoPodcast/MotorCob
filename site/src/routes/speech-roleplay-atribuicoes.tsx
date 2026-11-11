import type { Route } from './+types/speech-roleplay-atribuicoes';
import { seo } from '@/lib/seo';
import { Roleplay } from '@/components/speech/roleplay';
export function meta({ matches, location }: Route.MetaArgs) { return seo({ matches, location }, { title: 'Treinos atribuídos · Roleplay · MotorCX', description: 'Treinos passados às pessoas e equipes, com prazo, meta, tentativas e o link pessoal de cada operador.', noindex: true }); }
export default function SpeechRoleplayAtribuicoes() { return <Roleplay tela={{ tipo: 'atribuicoes' }} />; }
