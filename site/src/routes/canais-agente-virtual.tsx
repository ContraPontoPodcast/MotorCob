import { RedirecionarRotaAntiga } from '@/components/comuns/redirecionar';
// Endereço antigo: a tela mudou de lugar (Agente Voz/CX ou Speech Analytics). Leva ao novo com a mesma query (lib/rotas-voz.ts).
export default function RotaAntiga() { return <RedirecionarRotaAntiga />; }
