import type { Route } from './+types/cliente';
import { seo } from '@/lib/seo';
import { ClientLookup } from '@/components/cliente/client-lookup';
export function meta({ matches, location }: Route.MetaArgs) { return seo({ matches, location }, { title: 'Extrato do cliente · MotorCX', description: 'Consulte a TAG e a trilha de um cliente por ID.' }); }
export default function Cliente() { return <ClientLookup/>; }
