import type { Route } from './+types/home';
import { seo } from '@/lib/seo';
import { InicioHome } from '@/components/home/inicio-home';
export function meta({ matches, location }: Route.MetaArgs) { return seo({ matches, location }, { title: 'Início | MotorCX', description: 'Sua porta de entrada na plataforma MotorCX.', noindex: true }); }
export default function HomePage() { return <InicioHome />; }
