import type { Route } from './+types/demonstracao';
import { SitePublico } from '@/components/site-v5/site-publico';
import { metaPublica } from '@/components/site-v5/seo';
import { PaginaDemonstracao } from '@/components/site-v5/paginas/demonstracao';

export function meta({ matches, location }: Route.MetaArgs) {
	return metaPublica({ matches, location }, 'demonstracao');
}

export default function Rota() {
	return <SitePublico pagina="demonstracao"><PaginaDemonstracao /></SitePublico>;
}
