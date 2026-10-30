import type { Route } from './+types/redefinir-senha';
import { seo } from '@/lib/seo';
import { DefinirSenhaForm } from '@/components/auth/definir-senha-form';
export function meta({ matches, location }: Route.MetaArgs) { return seo({ matches, location }, { title: 'Nova senha · MotorCX', description: 'Defina sua nova senha de acesso ao MotorCX.', noindex: true }); }
export default function RedefinirSenha() { return <DefinirSenhaForm mode="redefinir" />; }
