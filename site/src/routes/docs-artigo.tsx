import type { Route } from './+types/docs-artigo';
import { seo } from '@/lib/seo';
import { DocsArtigoPage } from '@/components/workspace/docs/docs-artigo';
export function meta({ matches, location }: Route.MetaArgs) { return seo({ matches, location }, { title: 'Documentação · MotorCX', description: 'Artigo da documentação.', noindex: true }); }
export default function DocsArtigo() { return <DocsArtigoPage />; }
