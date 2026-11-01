// SÓ DESENVOLVIMENTO: as telas do Fluxo do agente com dados fictícios (fixturas), sem login nem banco, para ver e
// fotografar com o Playwright. A rota /dev/fluxo só existe quando o dev server roda com VITE_FLUXO_FIXTURES=1
// (src/routes.ts); no build de produção ela nem entra, e o componente ainda confere import.meta.env.DEV.
import { useMemo } from 'react';
import { useParams } from 'react-router';
import { ProvedorFixturas, type CtxFluxo, type Tela } from '@/components/fluxo/contexto';
import { criarApiFixturas } from '@/components/fluxo/fixturas';
import { ListaFluxos } from '@/components/fluxo/lista';
import { EditorFluxo } from '@/components/fluxo/editor';
import { TestarConversa } from '@/components/fluxo/testar';
import { DesempenhoFluxo } from '@/components/fluxo/desempenho';
import { PedidoGerado } from '@/components/fluxo/pedido';
import { TestarPersonas } from '@/components/fluxo/personas';
import { ConectoresCrm } from '@/components/fluxo/conectores';

export default function DevFluxo() {
	const { tela = 'lista', id } = useParams();
	const valor = useMemo<CtxFluxo>(() => ({
		empresa: { id: 1, slug: 'aurora', nome: 'Aurora Cobranças (demonstração)' },
		credor: { id: 11, nome: 'Cartão Aurora' },
		credores: [{ id: 11, nome: 'Cartão Aurora' }, { id: 12, nome: 'Empréstimo pessoal' }, { id: 13, nome: 'Consignado Norte' }],
		permissoes: ['editar_canais', 'editar_credores'],
		equipe: false,
		api: criarApiFixturas(),
		demo: true,
		rota: (t: Tela, i?: number | string | null, busca?: Record<string, string | number | null | undefined>) => {
			const q = Object.entries(busca ?? {}).filter(([, v]) => v != null && v !== '').map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`).join('&');
			return `/dev/fluxo/${t}${i != null && i !== '' ? `/${i}` : ''}${q ? `?${q}` : ''}`;
		},
	}), []);
	if (!import.meta.env.DEV) return null;
	const n = Number(id);
	const corpo = tela === 'editor' ? <EditorFluxo key={id} versaoId={n || 105} />
		: tela === 'testar' ? <TestarConversa />
		: tela === 'desempenho' ? <DesempenhoFluxo />
		: tela === 'pedido' ? <PedidoGerado key={id} pedidoId={n || 412} />
		: tela === 'personas' ? <TestarPersonas />
		: tela === 'conectores' ? <ConectoresCrm />
		: <ListaFluxos />;
	return (
		<ProvedorFixturas valor={valor}>
			<div className="min-h-screen bg-[var(--base-fundo,var(--base-fill))] px-4 py-6 text-[var(--base-texto)] sm:px-8">
				<p className="mb-4 rounded-lg px-3 py-1.5 text-[12px] font-semibold" style={{ backgroundColor: 'var(--estado-atencao-fundo)', color: 'var(--estado-atencao-texto)' }}>Modo de demonstração (só desenvolvimento): dados fictícios, nada vai ao banco.</p>
				<div className="mx-auto max-w-[1200px]">{corpo}</div>
			</div>
		</ProvedorFixturas>
	);
}
