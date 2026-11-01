import type { Route } from './+types/speech-analytics';
import { Navigate, useLocation } from 'react-router';
import { seo } from '@/lib/seo';
import { ROTA_TESTAR_PERSONAS, abaValida, rotaSA } from '@/lib/speech';
import { SpeechAnalytics } from '@/components/speech/speech-analytics';
export function meta({ matches, location }: Route.MetaArgs) { return seo({ matches, location }, { title: 'Speech Analytics · MotorCX', description: 'O que as ligações dizem e o que fazer com isso, só com dado mascarado e agregado.', noindex: true }); }
export default function SpeechAnalyticsRoute({ params }: Route.ComponentProps) {
	const { search } = useLocation();
	// Roleplay foi para Fluxo do agente › Testar com personas; "Retroalimentação" virou Recomendações.
	if (params.aba === 'roleplay') return <Navigate to={ROTA_TESTAR_PERSONAS} replace />;
	if (params.aba === 'retroalimentacao') return <Navigate to={`${rotaSA('recomendacoes')}${search}`} replace />;
	return <SpeechAnalytics aba={abaValida(params.aba)} />;
}
