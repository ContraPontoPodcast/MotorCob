import { Navigate } from 'react-router';
import type { Route } from './+types/console-voz';
import { seo } from '@/lib/seo';
// Link dos avisos do banco (rota de voz sem cadastro, SQL 56): abre Fornecedores e rotas na aba Agente virtual.
export function meta({ matches, location }: Route.MetaArgs) { return seo({ matches, location }, { title: 'Agente virtual · MotorCX', description: 'Agente virtual: troncos, rotas e concorrência.', noindex: true }); }
export default function ConsoleVoz() { return <Navigate to="/console/fornecedores?aba=voz" replace />; }
