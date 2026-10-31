import type { Route } from './+types/jornada-painel';
import { seo } from '@/lib/seo';
import { PermissionGate } from '@/components/role-gate';
import { PERM } from '@/lib/permissoes';
import { JornadaPainel } from '@/components/jornada/painel';
export function meta({ matches, location }: Route.MetaArgs) { return seo({ matches, location }, { title: 'Painel · Jornada | MotorCX', description: 'Resultado da jornada por momento, canal e mensagem.', noindex: true }); }
export default function JornadaPainelRoute() { return <PermissionGate perm={PERM.verPainel} tela="O Painel da Jornada"><JornadaPainel /></PermissionGate>; }
