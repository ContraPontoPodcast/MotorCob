import type { Route } from './+types/empresa-auditoria';
import { seo } from '@/lib/seo';
import { PermissionGate } from '@/components/role-gate';
import { Auditoria } from '@/components/auditoria/auditoria';
import { PERM } from '@/lib/permissoes';
export function meta({ matches, location }: Route.MetaArgs) { return seo({ matches, location }, { title: 'Auditoria | MotorCX', description: 'Histórico de alterações no MotorCX.', noindex: true }); }
export default function EmpresaAuditoria() { return <PermissionGate perm={PERM.verAuditoria}><Auditoria/></PermissionGate>; }
