import type { Route } from './+types/console-saude';
import { seo } from '@/lib/seo';
import { ConsoleSaudePage } from '@/components/workspace/console/console-saude';
export function meta({ matches, location }: Route.MetaArgs) { return seo({ matches, location }, { title: 'Saúde · MotorCX', description: 'Saúde das empresas no Console MotorCX.', noindex: true }); }
export default function ConsoleSaude() { return <ConsoleSaudePage />; }
