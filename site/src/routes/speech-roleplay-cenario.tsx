import type { Route } from './+types/speech-roleplay-cenario';
import { seo } from '@/lib/seo';
import { Roleplay } from '@/components/speech/roleplay';
export function meta({ matches, location }: Route.MetaArgs) { return seo({ matches, location }, { title: 'Cenário · Roleplay · MotorCX', description: 'Cenário de treino: cliente simulado, dívida fictícia, objeções, dificuldade e os itens do checklist em foco.', noindex: true }); }
export default function SpeechRoleplayCenario({ params }: Route.ComponentProps) { return <Roleplay key={params.id} tela={{ tipo: 'cenario', id: params.id }} />; }
