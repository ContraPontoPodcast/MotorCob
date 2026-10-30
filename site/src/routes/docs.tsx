import type { Route } from './+types/docs';
import { seo } from '@/lib/seo';
import { DocsListaPage } from '@/components/workspace/docs/docs-lista';
export function meta({ matches, location }: Route.MetaArgs) { return seo({ matches, location }, { title: 'Documentação · MotorCX', description: 'Atalhos e ajuda da plataforma.', noindex: true }); }
export default function Docs() { return <DocsListaPage />; }
