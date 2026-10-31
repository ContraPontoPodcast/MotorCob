import type { Route } from './+types/empresa-privacidade';
import { seo } from '@/lib/seo';
import { PrivacidadeVozPage } from '@/components/workspace/empresa/privacidade-voz';
export function meta({ matches, location }: Route.MetaArgs) { return seo({ matches, location }, { title: 'Privacidade e gravações · MotorCX', description: 'Retenção, aviso de gravação, transcrição e pedidos do titular.', noindex: true }); }
export default function EmpresaPrivacidade() { return <PrivacidadeVozPage />; }
