import type { Route } from './+types/solucoes-voz';
import { SitePublico } from '@/components/site-v5/site-publico';
import { metaPublica } from '@/components/site-v5/seo';
import { PaginaVoz } from '@/components/site-v5/paginas/voz';

export function meta({ matches, location }: Route.MetaArgs) {
	return metaPublica({ matches, location }, 'voz');
}

export default function Rota() {
	return <SitePublico pagina="voz"><PaginaVoz /></SitePublico>;
}
