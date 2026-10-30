import type { Route } from './+types/credor-configuracoes';
import { seo } from '@/lib/seo';
import { CredorConfiguracoes } from '@/components/credores/configuracoes';
export function meta({ matches, location }: Route.MetaArgs) { return seo({ matches, location }, { title: 'Configurações da carteira · MotorCX', description: 'Aponte as colunas dos arquivos e marque os resultados de ocorrência que são CPC.' }); }
export default function CredorConfiguracoesRoute() { return <CredorConfiguracoes />; }
