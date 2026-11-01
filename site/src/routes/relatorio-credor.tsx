import type { Route } from './+types/relatorio-credor';
import { seo } from '@/lib/seo';
import { RelatorioPublico } from '@/components/speech/relatorio-publico';
export function meta({ matches, location }: Route.MetaArgs) { return seo({ matches, location }, { title: 'Relatório ao credor · MotorCX', description: 'Relatório de leitura enviado pela assessoria.', noindex: true }); }
export default function RelatorioCredorRoute({ params }: Route.ComponentProps) { return <RelatorioPublico token={params.token} />; }
