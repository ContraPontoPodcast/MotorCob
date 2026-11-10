import type { Route } from './+types/empresa-faturamento-demonstrativo';
import { seo } from '@/lib/seo';
import { useMotorAuth } from '@/components/auth-provider';
import { EmpresaShell } from '@/components/workspace/empresa/empresa-shell';
import { DemonstrativoMinutoIa } from '@/components/workspace/empresa/demonstrativo-ia';

export function meta({ matches, location }: Route.MetaArgs) {
	return seo({ matches, location }, { title: 'Demonstrativo do Agente de voz | MotorCX', description: 'Minuto falado com a IA por ligação e por dia.', noindex: true });
}

// Empresa › Faturamento › Demonstrativo do minuto falado (SQL 127). O banco confere ve_faturamento.
export default function EmpresaFaturamentoDemonstrativo() {
	const { empresa } = useMotorAuth();
	return <EmpresaShell>{empresa?.id && <DemonstrativoMinutoIa empresaId={String(empresa.id)} empresaSlug={String(empresa.slug ?? '')} />}</EmpresaShell>;
}
