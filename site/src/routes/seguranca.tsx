import type { Route } from './+types/seguranca';
import { SitePublico } from '@/components/site-v5/site-publico';
import { metaPublica } from '@/components/site-v5/seo';
import { PaginaSeguranca } from '@/components/site-v5/paginas/seguranca';

export function meta({ matches, location }: Route.MetaArgs) {
	return metaPublica({ matches, location }, 'seguranca');
}

export default function Rota() {
	return <SitePublico pagina="seguranca"><PaginaSeguranca /></SitePublico>;
}
