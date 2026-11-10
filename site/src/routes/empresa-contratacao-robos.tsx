import type { Route } from './+types/empresa-contratacao-robos';
import { seo } from '@/lib/seo';
import { useMotorAuth } from '@/components/auth-provider';
import { Navigate } from 'react-router';
import { EmpresaShell } from '@/components/workspace/empresa/empresa-shell';
import { RobosContratadosEditar } from '@/components/workspace/empresa/robos-contratados';
import { useConsolePerms } from '@/components/workspace/console/console-perms';

export function meta({ matches, location }: Route.MetaArgs) {
	return seo({ matches, location }, { title: 'Editar robôs contratados | MotorCX', description: 'Robôs contratados (licenças) do Agente de voz.', noindex: true });
}

// Contratação › Agente de voz › Editar robôs contratados: só a equipe com editar_contratacao (salvar_licencas_voz).
export default function EmpresaContratacaoRobos() {
	const { empresa } = useMotorAuth();
	const { can } = useConsolePerms();
	if (!can('editar_contratacao')) return <Navigate to="/empresa/contratacao" replace />;
	return (
		<EmpresaShell>
			<h2 className="mb-4 text-[19px] font-semibold text-[var(--base-texto)]">Editar robôs contratados</h2>
			{empresa?.id && <RobosContratadosEditar empresaId={String(empresa.id)} />}
		</EmpresaShell>
	);
}
