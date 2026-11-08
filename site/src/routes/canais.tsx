import { useSearchParams } from 'react-router';
import type { Route } from './+types/canais';
import { seo } from '@/lib/seo';
import { CanaisVisaoGeral } from '@/components/canais/visao-geral';
import { FrasesPagina } from '@/components/canais/frases-pagina';
export function meta({ matches, location }: Route.MetaArgs) { return seo({ matches, location }, { title: 'Canais · MotorCX', description: 'Estado de cada canal da empresa: se está funcionando, o que fazer e a configuração.' }); }
// /canais = visão geral (estado por canal, sem campos; Importar playbook no topo). /canais?secao=frases (item "Frases"
// do menu) = as frases de cada canal; a configuração de cada canal fica em /canais/:canal.
export default function CanaisRoute() {
  const [params] = useSearchParams();
  return params.get('secao') === 'frases' ? <FrasesPagina/> : <CanaisVisaoGeral/>;
}
