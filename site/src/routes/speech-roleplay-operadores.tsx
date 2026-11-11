import type { Route } from './+types/speech-roleplay-operadores';
import { seo } from '@/lib/seo';
import { Roleplay } from '@/components/speech/roleplay';
export function meta({ matches, location }: Route.MetaArgs) { return seo({ matches, location }, { title: 'Cadastro para treino · Roleplay · MotorCX', description: 'Equipes e operadores que recebem treinos: apelido, equipe e, se quiser, o ID do discador. Sem login e sem dado pessoal.', noindex: true }); }
export default function SpeechRoleplayOperadores() { return <Roleplay tela={{ tipo: 'cadastro' }} />; }
