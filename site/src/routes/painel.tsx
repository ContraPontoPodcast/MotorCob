import type { Route } from './+types/painel';
import { seo } from '@/lib/seo';
import { PermissionGate } from '@/components/role-gate';
import { Metrics } from '@/components/painel/metrics';
import { PERM } from '@/lib/permissoes';
export function meta({ matches, location }: Route.MetaArgs) { return seo({ matches, location }, { title: 'Painel de indicadores · MotorCX', description: 'Analise resultados por período, safra e cluster.' }); }
export default function Painel() { return <PermissionGate perm={PERM.verPainel}><Metrics/></PermissionGate>; }
