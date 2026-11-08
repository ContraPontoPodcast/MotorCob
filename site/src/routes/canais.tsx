import { useSearchParams } from 'react-router';
import type { Route } from './+types/canais';
import { seo } from '@/lib/seo';
import { Canais } from '@/components/canais/canais';
import { CanaisVisaoGeral } from '@/components/canais/visao-geral';
export function meta({ matches, location }: Route.MetaArgs) { return seo({ matches, location }, { title: 'Canais · MotorCX', description: 'Estado de cada canal da empresa: se está funcionando, o que fazer e a configuração.' }); }
// /canais = visão geral nova (estado por canal, sem campos). /canais?secao=frases (item "Frases" do menu) continua
// abrindo os canais com a aba Modelos de mensagem, como antes.
export default function CanaisRoute() {
  const [params] = useSearchParams();
  return params.get('secao') === 'frases' ? <Canais/> : <CanaisVisaoGeral/>;
}
