import type { Route } from './+types/speech-roleplay-cenario-novo';
import { seo } from '@/lib/seo';
import { Roleplay } from '@/components/speech/roleplay';
export function meta({ matches, location }: Route.MetaArgs) { return seo({ matches, location }, { title: 'Novo cenário · Cenários · Roleplay · MotorCX', description: 'Novo cenário de treino: cliente simulado, dívida fictícia, objeções, dificuldade e itens do checklist em foco.', noindex: true }); }
export default function SpeechRoleplayCenarioNovo() { return <Roleplay tela={{ tipo: 'novo_cenario' }} />; }
