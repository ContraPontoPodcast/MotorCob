import type { Route } from './+types/empresa';
import { seo } from '@/lib/seo';
import { VisaoGeralPage } from '@/components/workspace/empresa/visao-geral';
export function meta({ matches, location }: Route.MetaArgs) { return seo({ matches, location }, { title: 'Empresa · MotorCX', description: 'Dados e atalhos da empresa.', noindex: true }); }
export default function Empresa() { return <VisaoGeralPage />; }
