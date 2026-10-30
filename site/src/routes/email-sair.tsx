import type { Route } from './+types/email-sair';
import { seo } from '@/lib/seo';
import { EmailSairPage } from '@/components/site/email-sair';
export function meta({ matches, location }: Route.MetaArgs) { return seo({ matches, location }, { title: 'Sair da lista | MotorCX', description: 'Gerenciar seus e-mails.', noindex: true }); }
export default function EmailSair() { return <EmailSairPage />; }
