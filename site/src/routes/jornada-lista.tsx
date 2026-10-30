import type { Route } from './+types/jornada-lista';
import { seo } from '@/lib/seo';
import { JornadaLista } from '@/components/jornada/lista';
export function meta({ matches, location }: Route.MetaArgs) { return seo({ matches, location }, { title: 'Lista do dia · Jornada | MotorCX', description: 'Lista do dia da jornada por canal.' }); }
export default function JornadaListaRoute() { return <JornadaLista />; }
