import type { Route } from './+types/console-implantacao';
import { seo } from '@/lib/seo';
import { ConsoleImplantacaoPage } from '@/components/workspace/console/console-implantacao';
export function meta({ matches, location }: Route.MetaArgs) { return seo({ matches, location }, { title: 'Implantação · MotorCX', description: 'Onde cada cliente parou na implantação.', noindex: true }); }
export default function ConsoleImplantacao() { return <ConsoleImplantacaoPage />; }
