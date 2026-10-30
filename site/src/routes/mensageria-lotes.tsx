import type { Route } from './+types/mensageria-lotes';
import { seo } from '@/lib/seo';
import { LotesLista } from '@/components/mensageria/lotes-lista';

export function meta({ matches, location }: Route.MetaArgs) {
	return seo({ matches, location }, { title: 'Lotes · Mensageria · MotorCX', description: 'Histórico de lotes de mensagens.', noindex: true });
}

export default function MensageriaLotes() {
	return <LotesLista />;
}
