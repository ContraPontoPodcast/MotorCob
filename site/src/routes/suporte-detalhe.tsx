import type { Route } from './+types/suporte-detalhe';
import { seo } from '@/lib/seo';
import { SuporteDetalhePage } from '@/components/workspace/suporte/suporte-detalhe';
export function meta({ matches, location }: Route.MetaArgs) { return seo({ matches, location }, { title: 'Chamado · MotorCX', description: 'Detalhe do chamado de suporte.', noindex: true }); }
export default function SuporteDetalhe() { return <SuporteDetalhePage />; }
