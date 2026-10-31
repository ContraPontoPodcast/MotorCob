import type { Route } from './+types/jornada-clientes';
import { seo } from '@/lib/seo';
import { PermissionGate } from '@/components/role-gate';
import { PERM } from '@/lib/permissoes';
import { JornadaClientes } from '@/components/jornada/clientes';
export function meta({ matches, location }: Route.MetaArgs) { return seo({ matches, location }, { title: 'Clientes · Jornada | MotorCX', description: 'Onde cada cliente está na jornada hoje, só pelo ID.', noindex: true }); }
export default function JornadaClientesRoute() { return <PermissionGate perm={PERM.verClientes} tela="Clientes da Jornada"><JornadaClientes /></PermissionGate>; }
