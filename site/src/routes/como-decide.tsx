import type { Route } from './+types/como-decide';
import { SitePublico } from '@/components/site-v5/site-publico';
import { metaPublica } from '@/components/site-v5/seo';
import { PaginaComoDecide } from '@/components/site-v5/paginas/como-decide';

export function meta({ matches, location }: Route.MetaArgs) {
	return metaPublica({ matches, location }, 'comoDecide');
}

export default function Rota() {
	return <SitePublico pagina="como-decide"><PaginaComoDecide /></SitePublico>;
}
