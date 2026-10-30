import type { Route } from './+types/console-produtos';
import { seo } from '@/lib/seo';
import { ConsoleProdutosPage } from '@/components/workspace/console/console-produtos';
export function meta({ matches, location }: Route.MetaArgs) { return seo({ matches, location }, { title: 'Produtos e preços | MotorCX', description: 'Produtos e preços da mensageria por canal.', noindex: true }); }
export default function ConsoleProdutos() { return <ConsoleProdutosPage />; }
