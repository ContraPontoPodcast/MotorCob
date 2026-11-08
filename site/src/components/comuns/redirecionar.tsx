// Endereço antigo → endereço novo (lib/rotas-voz.ts), com `replace` e mantendo query e âncora. Usado pelas rotas que
// mudaram de lugar quando Agente Voz/CX e Speech Analytics viraram áreas próprias.
import { Navigate, useLocation } from 'react-router';
import { destinoRedirecionamento, ROTA_VOZ } from '@/lib/rotas-voz';

export function RedirecionarRotaAntiga() {
	const { pathname, search, hash } = useLocation();
	return <Navigate to={destinoRedirecionamento(pathname, search, hash) ?? ROTA_VOZ} replace />;
}
