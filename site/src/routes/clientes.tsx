import type { Route } from './+types/clientes';
import { seo } from '@/lib/seo';
import { Clientes } from '@/components/clientes/clientes';
export function meta({ matches, location }: Route.MetaArgs) { return seo({ matches, location }, { title: 'Clientes da carteira · MotorCX', description: 'Veja onde cada cliente da carteira se enquadrou na esteira.' }); }
export default function ClientesRoute() { return <Clientes/>; }
