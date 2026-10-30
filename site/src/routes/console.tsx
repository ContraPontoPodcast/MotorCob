import type { Route } from './+types/console';
import { seo } from '@/lib/seo';
import { ConsoleEmpresasPage } from '@/components/workspace/console/console-empresas';
export function meta({ matches, location }: Route.MetaArgs) { return seo({ matches, location }, { title: 'Console · MotorCX', description: 'Console da equipe MotorCX.', noindex: true }); }
export default function Console() { return <ConsoleEmpresasPage />; }
