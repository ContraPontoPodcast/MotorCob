import type { Route } from './+types/relatorios';
import { seo } from '@/lib/seo';
import { RelatoriosLista } from '@/components/relatorios/relatorios-lista';

export function meta({ matches, location }: Route.MetaArgs) {
	return seo({ matches, location }, { title: 'Relatórios · MotorCX', description: 'Relatórios de mensageria, orquestração e jornada.', noindex: true });
}

export default function Relatorios() {
	return <RelatoriosLista />;
}
