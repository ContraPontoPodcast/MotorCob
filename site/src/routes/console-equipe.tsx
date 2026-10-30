import type { Route } from './+types/console-equipe';
import { seo } from '@/lib/seo';
import { ConsoleEquipePage } from '@/components/workspace/console/console-equipe';
export function meta({ matches, location }: Route.MetaArgs) { return seo({ matches, location }, { title: 'Equipe · MotorCX', description: 'Equipe MotorCX no Console.', noindex: true }); }
export default function ConsoleEquipe() { return <ConsoleEquipePage />; }
