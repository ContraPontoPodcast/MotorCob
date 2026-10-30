import type { Route } from './+types/empresa-integracoes';
import { seo } from '@/lib/seo';
import { ModulosPage } from '@/components/workspace/empresa/modulos';
export function meta({ matches, location }: Route.MetaArgs) { return seo({ matches, location }, { title: 'Integrações | MotorCX', description: 'Módulos e integrações da empresa.', noindex: true }); }
export default function EmpresaIntegracoes() { return <ModulosPage />; }
