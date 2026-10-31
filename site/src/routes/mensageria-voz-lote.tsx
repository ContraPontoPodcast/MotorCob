import type { Route } from './+types/mensageria-voz-lote';
import { seo } from '@/lib/seo';
import { LoteVozCurso } from '@/components/voz/lotes';
export function meta({ matches, location }: Route.MetaArgs) { return seo({ matches, location }, { title: 'Ligações em curso · MotorCX', description: 'Ligações em curso do agente virtual, por onda UF/DDD.', noindex: true }); }
export default function MensageriaVozLote() { return <LoteVozCurso />; }
