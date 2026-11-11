import type { Route } from './+types/voz-telefonia-tronco';
import { seo } from '@/lib/seo';
import { TelefoniaTronco } from '@/components/agente-voz/telefonia-tronco';
export function meta({ matches, location }: Route.MetaArgs) { return seo({ matches, location }, { title: 'Tronco · Telefonia · Agente Voz/CX · MotorCX', description: 'Operadora, senha no cofre, bina e Testar a rota.', noindex: true }); }
export default function VozTelefoniaTroncoRoute() { return <TelefoniaTronco />; }
