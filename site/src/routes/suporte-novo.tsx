import type { Route } from './+types/suporte-novo';
import { seo } from '@/lib/seo';
import { SuporteNovoPage } from '@/components/workspace/suporte/suporte-novo';
export function meta({ matches, location }: Route.MetaArgs) { return seo({ matches, location }, { title: 'Abrir chamado · MotorCX', description: 'Abra um chamado de suporte.', noindex: true }); }
export default function SuporteNovo() { return <SuporteNovoPage />; }
