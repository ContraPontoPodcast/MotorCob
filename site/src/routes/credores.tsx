import type { Route } from './+types/credores';
import { seo } from '@/lib/seo';
import { Credores } from '@/components/credores/credores';
export function meta({ matches, location }: Route.MetaArgs) { return seo({ matches, location }, { title: 'Carteiras · MotorCX', description: 'Cadastre e gerencie as carteiras da empresa.' }); }
export default function CredoresRoute() { return <Credores/>; }
