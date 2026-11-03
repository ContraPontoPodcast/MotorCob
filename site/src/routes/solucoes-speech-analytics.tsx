import type { Route } from './+types/solucoes-speech-analytics';
import { SitePublico } from '@/components/site-v5/site-publico';
import { metaPublica } from '@/components/site-v5/seo';
import { PaginaSpeech } from '@/components/site-v5/paginas/speech-analytics';

export function meta({ matches, location }: Route.MetaArgs) {
	return metaPublica({ matches, location }, 'speech');
}

export default function Rota() {
	return <SitePublico pagina="speech"><PaginaSpeech /></SitePublico>;
}
