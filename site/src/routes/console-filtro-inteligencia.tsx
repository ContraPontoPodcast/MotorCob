import type { Route } from './+types/console-filtro-inteligencia';
import { seo } from '@/lib/seo';
import { ConsoleFiltroInteligenciaPage } from '@/components/workspace/console/console-filtro-inteligencia';
export function meta({ matches, location }: Route.MetaArgs) { return seo({ matches, location }, { title: 'Filtro de inteligência | MotorCX', description: 'Configuração do filtro de inteligência.', noindex: true }); }
export default function ConsoleFiltroInteligencia() { return <ConsoleFiltroInteligenciaPage />; }
