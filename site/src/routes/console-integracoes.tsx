import type { Route } from './+types/console-integracoes';
import { seo } from '@/lib/seo';
import { ConsoleIntegracoesPage } from '@/components/workspace/console/console-integracoes';
export function meta({ matches, location }: Route.MetaArgs) { return seo({ matches, location }, { title: 'Integrações · MotorCX', description: 'Tokens de API das empresas.', noindex: true }); }
export default function ConsoleIntegracoes() { return <ConsoleIntegracoesPage />; }
