import type { Route } from './+types/acoes';
import { seo } from '@/lib/seo';
import { Acoes } from '@/components/acoes/acoes';
export function meta({ matches, location }: Route.MetaArgs) {
	return seo({ matches, location }, { title: 'Ações · MotorCX', description: 'Quantas ações o MotorCX mandou fazer e o que voltou delas.' });
}
export default function AcoesPage() { return <Acoes />; }
