import type { Route } from './+types/empresa-contratacao-robos-historico';
import { seo } from '@/lib/seo';
import { useMotorAuth } from '@/components/auth-provider';
import { Navigate } from 'react-router';
import { EmpresaShell } from '@/components/workspace/empresa/empresa-shell';
import { RobosContratadosHistorico } from '@/components/workspace/empresa/robos-contratados';
import { useConsolePerms } from '@/components/workspace/console/console-perms';

export function meta({ matches, location }: Route.MetaArgs) {
	return seo({ matches, location }, { title: 'Histórico dos robôs | MotorCX', description: 'Histórico dos robôs contratados (licenças) do Agente de voz.', noindex: true });
}

// Histórico dos robôs (licencas_voz): equipe com editar_contratacao ou ver_faturamento.
export default function EmpresaContratacaoRobosHistorico() {
	const { empresa } = useMotorAuth();
	const { can } = useConsolePerms();
	if (!can('editar_contratacao') && !can('ver_faturamento')) return <Navigate to="/empresa/contratacao" replace />;
	return (
		<EmpresaShell>
			{empresa?.id && <RobosContratadosHistorico empresaId={String(empresa.id)} />}
		</EmpresaShell>
	);
}
