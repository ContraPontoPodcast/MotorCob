import type { Route } from './+types/canais-agente-virtual-pedido';
import { seo } from '@/lib/seo';
import { PedidoGerado } from '@/components/fluxo/pedido';
export function meta({ matches, location }: Route.MetaArgs) { return seo({ matches, location }, { title: 'Rascunho gerado · MotorCX', description: 'Fluxo do agente descrito em texto e montado pelo MotorCX.', noindex: true }); }
export default function CanaisAgenteVirtualPedido({ params }: Route.ComponentProps) { return <PedidoGerado key={params.id} pedidoId={Number(params.id)} />; }
