import type { Route } from './+types/console-qualidade';
import { seo } from '@/lib/seo';
import { ConsoleQualidadePage } from '@/components/workspace/console/console-qualidade';
export function meta({ matches, location }: Route.MetaArgs) { return seo({ matches, location }, { title: 'Qualidade dos fornecedores | MotorCX', description: 'Qualidade dos fornecedores de mensageria por canal.', noindex: true }); }
export default function ConsoleQualidade() { return <ConsoleQualidadePage />; }
