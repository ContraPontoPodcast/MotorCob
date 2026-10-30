import type { Route } from './+types/empresa-modulos';
import { seo } from '@/lib/seo';
import { ModulosPage } from '@/components/workspace/empresa/modulos';
export function meta({ matches, location }: Route.MetaArgs) { return seo({ matches, location }, { title: 'Módulos · MotorCX', description: 'Módulos da empresa.', noindex: true }); }
export default function EmpresaModulos() { return <ModulosPage />; }
