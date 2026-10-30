import type { Route } from './+types/definir-senha';
import { seo } from '@/lib/seo';
import { DefinirSenhaForm } from '@/components/auth/definir-senha-form';
export function meta({ matches, location }: Route.MetaArgs) { return seo({ matches, location }, { title: 'Criar senha · MotorCX', description: 'Crie sua senha de acesso ao MotorCX.', noindex: true }); }
export default function DefinirSenha() { return <DefinirSenhaForm mode="convite" />; }
