import type { Route } from './+types/console-atendimento';
import { seo } from '@/lib/seo';
import { ConsoleAtendimentoPage } from '@/components/workspace/console/console-atendimento';
export function meta({ matches, location }: Route.MetaArgs) { return seo({ matches, location }, { title: 'Atendimento · MotorCX', description: 'Atendimento da equipe MotorCX.', noindex: true }); }
export default function ConsoleAtendimento() { return <ConsoleAtendimentoPage />; }
