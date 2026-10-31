import type { Route } from './+types/empresa-integracao-token';
import { seo } from '@/lib/seo';
import { EmpresaShell } from '@/components/workspace/empresa/empresa-shell';
import { UsoToken } from '@/components/workspace/empresa/tokens-api';
export function meta({ matches, location }: Route.MetaArgs) { return seo({ matches, location }, { title: 'Uso do token | MotorCX', description: 'Chamadas e erros de um token de API.', noindex: true }); }
export default function EmpresaIntegracaoToken({ params }: Route.ComponentProps) {
	return <EmpresaShell><UsoToken id={params.id} /></EmpresaShell>;
}
