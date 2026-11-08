import { Navigate, useParams } from 'react-router';
import type { Route } from './+types/canal';
import { seo } from '@/lib/seo';
import { CanalTela } from '@/components/canais/canal-tela';
import { ehCanalTela } from '@/lib/estado-canais';
export function meta({ matches, location }: Route.MetaArgs) { return seo({ matches, location }, { title: 'Canal · MotorCX', description: 'Estado do canal, Pausar e Retomar, e a configuração por seção: regras de envio, mensagens, retorno, custos e conexão.' }); }
// Tela do canal (SPEC Canais §3.2; PRs 6 e 7): estado no topo e as seções do canal, cada uma salva sozinha.
export default function CanalRoute() {
  const { canal } = useParams();
  if (!ehCanalTela(canal)) return <Navigate to="/canais" replace />;
  return <CanalTela key={canal} canal={canal}/>;
}
