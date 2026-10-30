import type { Route } from './+types/empresa-contatos';
import { seo } from '@/lib/seo';
import { ContatosPage } from '@/components/workspace/empresa/contatos';
export function meta({ matches, location }: Route.MetaArgs) { return seo({ matches, location }, { title: 'Contatos · MotorCX', description: 'Contatos da empresa.', noindex: true }); }
export default function EmpresaContatos() { return <ContatosPage />; }
