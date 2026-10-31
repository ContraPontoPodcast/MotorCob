import type { Route } from './+types/envios-gravacoes-discador';
import { seo } from '@/lib/seo';
import { PermissionGate } from '@/components/role-gate';
import { GravacoesDiscador } from '@/components/voz/gravacoes-discador';
import { PERM } from '@/lib/permissoes';
export function meta({ matches, location }: Route.MetaArgs) { return seo({ matches, location }, { title: 'Gravações do discador · MotorCX', description: 'Importação das gravações do discador da empresa e quarentena.', noindex: true }); }
export default function EnviosGravacoesDiscador() { return <PermissionGate perm={PERM.enviarArquivos} tela="Gravações do discador"><GravacoesDiscador /></PermissionGate>; }
