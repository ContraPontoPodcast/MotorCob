import type { Route } from './+types/suporte';
import { seo } from '@/lib/seo';
import { SuporteListaPage } from '@/components/workspace/suporte/suporte-lista';
export function meta({ matches, location }: Route.MetaArgs) { return seo({ matches, location }, { title: 'Suporte · MotorCX', description: 'Seus chamados de suporte.', noindex: true }); }
export default function Suporte() { return <SuporteListaPage />; }
