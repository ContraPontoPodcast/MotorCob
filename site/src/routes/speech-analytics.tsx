import type { Route } from './+types/speech-analytics';
import { Navigate, useLocation } from 'react-router';
import { seo } from '@/lib/seo';
import { abaValida, rotaSA } from '@/lib/speech';
import { SpeechAnalytics } from '@/components/speech/speech-analytics';
export function meta({ matches, location, params }: Route.MetaArgs) {
	if (params.aba === 'roleplay') return seo({ matches, location }, { title: 'Roleplay · Speech Analytics · MotorCX', description: 'Treino de operadores com clientes simulados, com nota pelo mesmo checklist de qualidade das ligações.', noindex: true });
	return seo({ matches, location }, { title: 'Speech Analytics · MotorCX', description: 'O que as ligações dizem e o que fazer com isso, só com dado mascarado e agregado.', noindex: true });
}
export default function SpeechAnalyticsRoute({ params }: Route.ComponentProps) {
	const { search } = useLocation();
	// /speech-analytics/roleplay é o Painel do treino de operadores (SQL 90; antes redirecionava para Testar com
	// personas, que continua em Agente Voz/CX). "Retroalimentação" virou Recomendações.
	if (params.aba === 'retroalimentacao') return <Navigate to={`${rotaSA('recomendacoes')}${search}`} replace />;
	return <SpeechAnalytics aba={abaValida(params.aba)} />;
}
