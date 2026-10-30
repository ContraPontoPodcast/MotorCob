import type { Route } from './+types/console-faturamento';
import { seo } from '@/lib/seo';
import { ConsoleFaturamentoPage } from '@/components/workspace/console/console-faturamento';
export function meta({ matches, location }: Route.MetaArgs) { return seo({ matches, location }, { title: 'Faturamento · MotorCX', description: 'Faturamento do console.', noindex: true }); }
export default function ConsoleFaturamento() { return <ConsoleFaturamentoPage />; }
