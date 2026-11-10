import type { Route } from './+types/empresa-contratacao-voz';
import { seo } from '@/lib/seo';
import { useMotorAuth } from '@/components/auth-provider';
import { Navigate } from 'react-router';
import { EmpresaShell } from '@/components/workspace/empresa/empresa-shell';
import { CobrancaIaVozEditar } from '@/components/workspace/empresa/cobranca-ia-voz';
import { useConsolePerms } from '@/components/workspace/console/console-perms';

export function meta({ matches, location }: Route.MetaArgs) {
	return seo({ matches, location }, { title: 'Agente de voz: modelo de cobrança | MotorCX', description: 'Por minuto falado com a IA ou licença de robôs.', noindex: true });
}

// Contratação › Agente de voz: modelo de cobrança, preço do minuto, cadência e limite. Só a equipe com
// editar_contratacao (salvar_cobranca_ia_voz, SQL 123).
export default function EmpresaContratacaoVoz() {
	const { empresa } = useMotorAuth();
	const { can } = useConsolePerms();
	if (!can('editar_contratacao')) return <Navigate to="/empresa/contratacao" replace />;
	return (
		<EmpresaShell>
			<h2 className="mb-4 text-[19px] font-semibold text-[var(--base-texto)]">Agente de voz · modelo de cobrança</h2>
			{empresa?.id && <CobrancaIaVozEditar empresaId={String(empresa.id)} />}
		</EmpresaShell>
	);
}
