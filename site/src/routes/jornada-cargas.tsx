import type { Route } from './+types/jornada-cargas';
import { seo } from '@/lib/seo';
import { JornadaCargas } from '@/components/jornada/cargas';
export function meta({ matches, location }: Route.MetaArgs) { return seo({ matches, location }, { title: 'Enviar arquivos · Jornada | MotorCX', description: 'Envie clientes e contatos da jornada.' }); }
export default function JornadaCargasRoute() { return <JornadaCargas />; }
