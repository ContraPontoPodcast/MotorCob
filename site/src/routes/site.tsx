import type { Route } from './+types/site';
import { SitePublico } from '@/components/site-v5/site-publico';
import { metaPublica } from '@/components/site-v5/seo';
import { PaginaHome } from '@/components/site-v5/paginas/home';

export function meta({ matches, location }: Route.MetaArgs) {
	return metaPublica({ matches, location }, 'home');
}

export default function Rota() {
	return <SitePublico pagina="home"><PaginaHome /></SitePublico>;
}
