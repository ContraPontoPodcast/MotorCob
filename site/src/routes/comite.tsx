import type { Route } from './+types/comite';
import { seo } from '@/lib/seo';
import { PermissionGate } from '@/components/role-gate';
import { CommitteeFiles } from '@/components/comite/committee-files';
import { PERM } from '@/lib/permissoes';
export function meta({ matches, location }: Route.MetaArgs) { return seo({ matches, location }, { title: 'Comitê · MotorCX', description: 'Acesse relatórios mensais do comitê.' }); }
export default function Comite() { return <PermissionGate perm={PERM.baixarComite}><CommitteeFiles/></PermissionGate>; }
