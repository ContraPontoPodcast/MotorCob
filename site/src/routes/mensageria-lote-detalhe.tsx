import type { Route } from './+types/mensageria-lote-detalhe';
import { seo } from '@/lib/seo';
import { LoteDetalhe } from '@/components/mensageria/lote-detalhe';

export function meta({ matches, location }: Route.MetaArgs) {
	return seo({ matches, location }, { title: 'Lote · Mensageria · MotorCX', description: 'Detalhe do lote de mensagens.', noindex: true });
}

export default function MensageriaLoteDetalhe() {
	return <LoteDetalhe />;
}
