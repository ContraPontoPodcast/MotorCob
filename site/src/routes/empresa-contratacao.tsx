import type { Route } from './+types/empresa-contratacao';
import { seo } from '@/lib/seo';
import { useMotorAuth } from '@/components/auth-provider';
import { Navigate } from 'react-router';
import { EmpresaShell } from '@/components/workspace/empresa/empresa-shell';
import { ContratacaoEmpresa } from '@/components/workspace/empresa/contratacao-empresa';
import { useConsolePerms } from '@/components/workspace/console/console-perms';

export function meta({ matches, location }: Route.MetaArgs) {
	return seo({ matches, location }, { title: 'Contratação | MotorCX', description: 'Contratação da empresa.', noindex: true });
}

export default function EmpresaContratacao() {
	const { empresa } = useMotorAuth();
	const { can } = useConsolePerms();
	const podeContratacao = can('editar_contratacao');
	const soPrecos = !podeContratacao && can('editar_precos');
	if (!podeContratacao && !soPrecos) return <Navigate to="/empresa" replace />;
	return (
		<EmpresaShell>
			<ContratacaoEmpresa mode="editar" empresaId={empresa?.id} soPrecos={soPrecos} />
		</EmpresaShell>
	);
}
