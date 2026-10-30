import type { Route } from './+types/conta';
import { useSearchParams } from 'react-router';
import { seo } from '@/lib/seo';
import { ContaDadosPage } from '@/components/workspace/conta/conta-dados';
import { ContaSegurancaPage } from '@/components/workspace/conta/conta-seguranca';
import { ContaNotificacoesPage } from '@/components/workspace/conta/conta-notificacoes';
import { ContaPreferenciasPage } from '@/components/workspace/conta/conta-preferencias';
import { ContaPermissoesPage } from '@/components/workspace/conta/conta-permissoes';

export function meta({ matches, location }: Route.MetaArgs) {
	return seo({ matches, location }, { title: 'Minha conta · MotorCX', description: 'Seus dados de perfil.', noindex: true });
}

export default function Conta() {
	const [params] = useSearchParams();
	const aba = params.get('aba') || 'dados';
	switch (aba) {
		case 'seguranca': return <ContaSegurancaPage />;
		case 'notificacoes': return <ContaNotificacoesPage />;
		case 'preferencias': return <ContaPreferenciasPage />;
		case 'perfil': return <ContaPermissoesPage />;
		default: return <ContaDadosPage />;
	}
}
