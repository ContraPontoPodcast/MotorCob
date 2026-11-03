import type { Route } from './+types/solucoes-cobranca';
import { SitePublico } from '@/components/site-v5/site-publico';
import { metaPublica } from '@/components/site-v5/seo';
import { PaginaCobranca } from '@/components/site-v5/paginas/cobranca';

export function meta({ matches, location }: Route.MetaArgs) {
	return metaPublica({ matches, location }, 'cobranca');
}

export default function Rota() {
	return <SitePublico pagina="cobranca"><PaginaCobranca /></SitePublico>;
}
