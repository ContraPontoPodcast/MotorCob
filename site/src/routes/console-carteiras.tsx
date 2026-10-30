import type { Route } from './+types/console-carteiras';
import { seo } from '@/lib/seo';
import { ConsoleCarteirasPage } from '@/components/workspace/console/console-carteiras';
export function meta({ matches, location }: Route.MetaArgs) { return seo({ matches, location }, { title: 'Carteiras | MotorCX', description: 'Carteiras de empresas no Console MotorCX.', noindex: true }); }
export default function ConsoleCarteiras() { return <ConsoleCarteirasPage />; }
