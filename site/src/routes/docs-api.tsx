import type { Route } from './+types/docs-api';
import { seo } from '@/lib/seo';
import { DocsApiPage } from '@/components/workspace/docs/docs-api';
export function meta({ matches, location }: Route.MetaArgs) { return seo({ matches, location }, { title: 'Documentação da API · MotorCX', description: 'Integração e API do MotorCX.', noindex: true }); }
export default function DocsApi() { return <DocsApiPage />; }
