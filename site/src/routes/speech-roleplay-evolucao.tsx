import type { Route } from './+types/speech-roleplay-evolucao';
import { seo } from '@/lib/seo';
import { Roleplay } from '@/components/speech/roleplay';
export function meta({ matches, location }: Route.MetaArgs) { return seo({ matches, location }, { title: 'Evolução · Roleplay · MotorCX', description: 'Evolução do treino por item, por equipe e por pessoa, ao lado das ligações reais. Sem ranking.', noindex: true }); }
export default function SpeechRoleplayEvolucao() { return <Roleplay tela={{ tipo: 'evolucao' }} />; }
