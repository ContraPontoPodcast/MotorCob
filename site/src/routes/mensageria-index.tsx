import type { Route } from './+types/mensageria-index';
import { seo } from '@/lib/seo';
import { ProdutoSeletor } from '@/components/mensageria/produto-seletor';

export function meta({ matches, location }: Route.MetaArgs) {
	return seo({ matches, location }, { title: 'Mensageria · MotorCX', description: 'Escolha o canal de mensageria.', noindex: true });
}

export default function MensageriaIndex() {
	return <ProdutoSeletor />;
}
