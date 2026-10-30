import type { Route } from './+types/envios';
import { seo } from '@/lib/seo';
import { PermissionGate } from '@/components/role-gate';
import { Uploads } from '@/components/envios/uploads';
import { PERM } from '@/lib/permissoes';
export function meta({ matches, location }: Route.MetaArgs) { return seo({ matches, location }, { title: 'Enviar arquivos · MotorCX', description: 'Envie arquivos CSV para processamento no MotorCX.' }); }
export default function Envios() { return <PermissionGate perm={PERM.enviarArquivos}><Uploads/></PermissionGate>; }
