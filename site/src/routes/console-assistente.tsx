import type { Route } from './+types/console-assistente';
import { seo } from '@/lib/seo';
import { ConsoleAssistentePage } from '@/components/workspace/console/console-assistente';
export function meta({ matches, location }: Route.MetaArgs) {
	return seo({ matches, location }, { title: 'Assistente · MotorCX', description: 'Painel do Assistente MotorCX: perguntas, respostas da equipe e sugestões.', noindex: true });
}
export default function ConsoleAssistente() { return <ConsoleAssistentePage />; }
