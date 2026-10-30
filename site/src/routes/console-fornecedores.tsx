import type { Route } from './+types/console-fornecedores';
import { seo } from '@/lib/seo';
import { ConsoleFornecedoresPage } from '@/components/workspace/console/console-fornecedores';
export function meta({ matches, location }: Route.MetaArgs) { return seo({ matches, location }, { title: 'Fornecedores · MotorCX', description: 'Fornecedores de mensageria.', noindex: true }); }
export default function ConsoleFornecedores() { return <ConsoleFornecedoresPage />; }
