import type { Route } from './+types/relatorios-novo';
import { seo } from '@/lib/seo';
import { MontarRelatorioNovo } from '@/components/relatorios/montar-relatorio-novo';

export function meta({ matches, location }: Route.MetaArgs) {
	return seo({ matches, location }, { title: 'Montar relatório · MotorCX', description: 'Monte um relatório para a sua empresa.', noindex: true });
}

export default function RelatoriosNovo() {
	return <MontarRelatorioNovo />;
}
