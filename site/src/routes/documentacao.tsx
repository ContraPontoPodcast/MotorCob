import type { Route } from './+types/documentacao';
import { seo } from '@/lib/seo';
import { DocumentacaoPage } from '@/components/workspace/docs/documentacao';

export function meta({ matches, location }: Route.MetaArgs) {
	return seo({ matches, location }, {
		title: 'Documentação da API · MotorCX',
		description: 'Integre o seu sistema pela API do MotorCX: cargas, status e Lista do dia.',
		noindex: true,
	});
}

export default function Documentacao() {
	return <DocumentacaoPage />;
}
