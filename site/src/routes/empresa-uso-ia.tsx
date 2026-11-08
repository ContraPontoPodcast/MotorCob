import type { Route } from './+types/empresa-uso-ia';
import { seo } from '@/lib/seo';
import { UsoIAPage } from '@/components/workspace/empresa/uso-ia';
export function meta({ matches, location }: Route.MetaArgs) { return seo({ matches, location }, { title: 'Uso de IA · MotorCX', description: 'Créditos de IA da empresa no ciclo, por função e por dia.', noindex: true }); }
export default function EmpresaUsoIA() { return <UsoIAPage />; }
