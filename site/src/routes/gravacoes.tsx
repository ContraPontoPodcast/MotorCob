import type { Route } from './+types/gravacoes';
import { seo } from '@/lib/seo';
import { PermissionGate } from '@/components/role-gate';
import { Gravacoes } from '@/components/voz/gravacoes';
import { PERM_VOZ } from '@/lib/voz';
export function meta({ matches, location }: Route.MetaArgs) { return seo({ matches, location }, { title: 'Gravações · MotorCX', description: 'Gravações do agente virtual e do discador, com acesso registrado.', noindex: true }); }
export default function GravacoesRoute() { return <PermissionGate perm={PERM_VOZ.ouvirGravacoes} tela="Gravações"><Gravacoes /></PermissionGate>; }
