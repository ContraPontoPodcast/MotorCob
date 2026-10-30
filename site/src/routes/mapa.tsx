import type { Route } from './+types/mapa';
import { seo } from '@/lib/seo';
import { MapaEsteira } from '@/components/mapa/mapa-esteira';
export function meta({ matches, location }: Route.MetaArgs) { return seo({ matches, location }, { title: 'Mapa da Esteira · MotorCX', description: 'Onde está a base hoje em cada etapa dos acionamentos, e quem se moveu entre elas.' }); }
export default function MapaRoute() { return <MapaEsteira/>; }
