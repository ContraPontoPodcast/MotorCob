import type { Route } from './+types/console-margem';
import { seo } from '@/lib/seo';
import { ConsoleMargemPage } from '@/components/workspace/console/console-margem';
export function meta({ matches, location }: Route.MetaArgs) { return seo({ matches, location }, { title: 'Margem · MotorCX', description: 'Margem da mensageria por empresa e canal.', noindex: true }); }
export default function ConsoleMargem() { return <ConsoleMargemPage />; }
