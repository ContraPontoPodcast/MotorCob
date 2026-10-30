import type { Route } from './+types/empresas';
import { seo } from '@/lib/seo';
import { Empresas } from '@/components/empresas/empresas';
export function meta({ matches, location }: Route.MetaArgs) { return seo({ matches, location }, { title: 'Empresas · MotorCX', description: 'Cadastre e gerencie as empresas clientes do MotorCX.' }); }
export default function EmpresasRoute() { return <Empresas/>; }
