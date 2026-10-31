import type { Route } from './+types/empresa-auditoria';
import { seo } from '@/lib/seo';
import { PermissionGate } from '@/components/role-gate';
import { Auditoria } from '@/components/auditoria/auditoria';
import { PERM } from '@/lib/permissoes';
import { useMotorAuth } from '@/components/auth-provider';
import { EmpresaShell } from '@/components/workspace/empresa/empresa-shell';
export function meta({ matches, location }: Route.MetaArgs) { return seo({ matches, location }, { title: 'Auditoria | MotorCX', description: 'Histórico de alterações no MotorCX.', noindex: true }); }
export default function EmpresaAuditoria() {
	const { empresa } = useMotorAuth();
	const tela = <PermissionGate perm={PERM.verAuditoria}><Auditoria/></PermissionGate>;
	// Mesma moldura das outras telas da Empresa; a equipe sem empresa na pílula vê a auditoria geral.
	if (empresa) return <EmpresaShell>{tela}</EmpresaShell>;
	return <div className="mx-auto max-w-[1080px] px-4 py-8">{tela}</div>;
}
