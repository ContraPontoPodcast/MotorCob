import type { Route } from './+types/speech-analytics';
import { seo } from '@/lib/seo';
import { abaValida } from '@/lib/speech';
import { SpeechAnalytics } from '@/components/speech/speech-analytics';
export function meta({ matches, location }: Route.MetaArgs) { return seo({ matches, location }, { title: 'Speech Analytics · MotorCX', description: 'O que as ligações dizem e o que fazer com isso, só com dado mascarado e agregado.', noindex: true }); }
export default function SpeechAnalyticsRoute({ params }: Route.ComponentProps) { return <SpeechAnalytics aba={abaValida(params.aba)} />; }
