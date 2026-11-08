import { Navigate, useParams } from 'react-router';
import type { Route } from './+types/canal';
import { seo } from '@/lib/seo';
import { Canais } from '@/components/canais/canais';
import { ehCanalTela } from '@/lib/estado-canais';
export function meta({ matches, location }: Route.MetaArgs) { return seo({ matches, location }, { title: 'Canal · MotorCX', description: 'Configuração do canal: horário, limites, custo, quem envia e mensagens.' }); }
// "Configurar" da visão geral: a configuração de hoje, só deste canal. A tela nova do canal (seções e salvar por seção)
// é o próximo passo do redesign; o endereço fica o mesmo.
export default function CanalRoute() {
  const { canal } = useParams();
  if (!ehCanalTela(canal)) return <Navigate to="/canais" replace />;
  return <Canais key={canal} canal={canal}/>;
}
