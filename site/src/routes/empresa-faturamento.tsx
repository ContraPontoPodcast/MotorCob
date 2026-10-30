import type { Route } from './+types/empresa-faturamento';
import { seo } from '@/lib/seo';
import { FaturamentoPage } from '@/components/workspace/empresa/faturamento';
export function meta({ matches, location }: Route.MetaArgs) { return seo({ matches, location }, { title: 'Faturamento · MotorCX', description: 'Faturas e consumo da empresa.', noindex: true }); }
export default function EmpresaFaturamento() { return <FaturamentoPage />; }
