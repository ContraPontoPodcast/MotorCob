import type { Route } from './+types/implantacao';
import { seo } from '@/lib/seo';
import { AssistenteImplantacao } from '@/components/implantacao/assistente';
export function meta({ matches, location }: Route.MetaArgs) { return seo({ matches, location }, { title: 'Assistente de implantação · MotorCX', description: 'Os 5 passos para pôr um cliente para rodar: empresa, carteira, primeira carga, como acionar e o que falta.', noindex: true }); }
export default function ImplantacaoRoute() { return <AssistenteImplantacao />; }
