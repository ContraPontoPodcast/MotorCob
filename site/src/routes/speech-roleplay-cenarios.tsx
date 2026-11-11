import type { Route } from './+types/speech-roleplay-cenarios';
import { seo } from '@/lib/seo';
import { Roleplay } from '@/components/speech/roleplay';
export function meta({ matches, location }: Route.MetaArgs) { return seo({ matches, location }, { title: 'Cenários · Roleplay · MotorCX', description: 'Biblioteca de clientes simulados para treinar operadores: Padrão MotorCX e os cenários da empresa.', noindex: true }); }
export default function SpeechRoleplayCenarios() { return <Roleplay tela={{ tipo: 'cenarios' }} />; }
