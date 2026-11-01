import type { Route } from './+types/canais-agente-virtual-editor';
import { seo } from '@/lib/seo';
import { EditorFluxo } from '@/components/fluxo/editor';
export function meta({ matches, location }: Route.MetaArgs) { return seo({ matches, location }, { title: 'Editor do fluxo · MotorCX', description: 'Quadro por ramos do fluxo do agente virtual.', noindex: true }); }
export default function CanaisAgenteVirtualEditor({ params }: Route.ComponentProps) { return <EditorFluxo key={params.versao} versaoId={Number(params.versao)} />; }
