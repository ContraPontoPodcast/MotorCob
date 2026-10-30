import type { Route } from './+types/fila';
import { seo } from '@/lib/seo';
import { Queue } from '@/components/fila/queue';
export function meta({ matches, location }: Route.MetaArgs) { return seo({ matches, location }, { title: 'Lista do dia · MotorCX', description: 'Consulte e baixe os IDs da lista por canal.' }); }
export default function Fila() { return <Queue/>; }
