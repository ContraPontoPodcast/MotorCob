import type { Route } from './+types/assistente-minhas';
import { seo } from '@/lib/seo';
import { MinhasPerguntas } from '@/components/workspace/assistente/minhas-perguntas';

export function meta({ matches, location }: Route.MetaArgs) {
	return seo({ matches, location }, { title: 'Minhas perguntas | MotorCX', description: 'Suas conversas com o Assistente MotorCX.', noindex: true });
}

export default function AssistenteMinhas() {
	return <MinhasPerguntas />;
}
