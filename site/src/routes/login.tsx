import type { Route } from './+types/login';
import { seo } from '@/lib/seo';
import { LoginForm } from '@/components/auth/login-form';
export function meta({ matches, location }: Route.MetaArgs) { return seo({ matches, location }, { title: 'Entrar · MotorCX', description: 'Acesse a plataforma MotorCX de inteligência de contato para cobrança.', noindex: true }); }
export default function Login() { return <LoginForm/>; }
