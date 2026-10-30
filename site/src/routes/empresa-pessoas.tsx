import type { Route } from './+types/empresa-pessoas';
import { seo } from '@/lib/seo';
import { PessoasPerfisPage } from '@/components/workspace/empresa/pessoas-perfis';
export function meta({ matches, location }: Route.MetaArgs) {
	return seo({ matches, location }, { title: 'Pessoas e perfis · MotorCX', description: 'Pessoas e perfis da empresa.', noindex: true });
}
export default function EmpresaPessoas() { return <PessoasPerfisPage />; }
