// SÓ DESENVOLVIMENTO: as telas do Fluxo do agente com dados fictícios (fixturas), sem login nem banco, para ver e
// fotografar com o Playwright. A rota /dev/fluxo só existe quando o dev server roda com VITE_FLUXO_FIXTURES=1
// (src/routes.ts); no build de produção ela nem entra, e o componente ainda confere import.meta.env.DEV.
import { useMemo, useState } from 'react';
import { useParams, useSearchParams } from 'react-router';
import { ProvedorFixturas, rotaReal, type CtxFluxo, type Tela } from '@/components/fluxo/contexto';
import { RotaDaTela } from '@/components/comuns/voltar';
import { criarApiFixturas } from '@/components/fluxo/fixturas';
import { ListaFluxos } from '@/components/fluxo/lista';
import { EditorFluxo } from '@/components/fluxo/editor';
import { TestarConversa } from '@/components/fluxo/testar';
import { DesempenhoFluxo } from '@/components/fluxo/desempenho';
import { PedidoGerado } from '@/components/fluxo/pedido';
import { TestarPersonas } from '@/components/fluxo/personas';
import { ConectoresCrm } from '@/components/fluxo/conectores';
import { IdentidadeAgente } from '@/components/fluxo/identidade';
import { OfertasAgente, TestarOfertas } from '@/components/fluxo/ofertas';
import { MapeamentoCarga } from '@/components/comuns/mapeamento-carga';
import { reconhecer, type ColunasCarga } from '@/lib/mapeamento-carga';
import { recomendada } from '@/lib/identidade-mailing';

// carga fictícia para ver o grupo "Para o agente de voz" (os valores nunca aparecem: a tela mascara)
const CAB_DEMO = ['ID_CLIENTE', 'CPF_CNPJ', 'CONTRATO', 'SALDO', 'DIAS_ATRASO', 'TEL1', 'TEL2', 'EMAIL', 'DT_NASC', 'ULT3_DOC', 'UF'];
const LINHAS_DEMO = [['CLI-00001', '000.000.001-91', 'CT-1', '1.380,00', '412', '11900000001', '', 'pessoa@exemplo.test', '01/01/1980', '191', 'SP']];
function CargaDemo() {
	const rec = useMemo(() => reconhecer(CAB_DEMO), []);
	const [c, setC] = useState<ColunasCarga>(() => ({ ...rec, documento_validacao: 'CPF_CNPJ' }));
	return <><h1 className="mb-3 text-[20px] font-semibold">Colunas da carga</h1><MapeamentoCarga cabecalho={CAB_DEMO} colunas={c} reconhecido={rec} onTrocar={setC} linhas={LINHAS_DEMO} /></>;
}

export default function DevFluxo() {
	const { tela = 'lista', id } = useParams();
	const [busca] = useSearchParams();
	const aprova = busca.get('aprova') === '1';     // ?aprova=1: o perfil de quem aprova o roteiro de voz (Admin)
	const comIdentidade = busca.get('identidade') === '1';   // ?identidade=1: a carteira já confere pelo arquivo (SQL 88)
	const valor = useMemo<CtxFluxo>(() => ({
		empresa: { id: 1, slug: 'aurora', nome: 'Aurora Cobranças (demonstração)' },
		credor: { id: 11, nome: 'Cartão Aurora' },
		credores: [{ id: 11, nome: 'Cartão Aurora' }, { id: 12, nome: 'Empréstimo pessoal' }, { id: 13, nome: 'Consignado Norte' }],
		permissoes: ['editar_canais', 'editar_credores', ...(aprova ? ['aprovar_roteiro_voz'] : [])],
		equipe: false,
		equipeMonta: false,
		api: (() => {
			const api = criarApiFixturas();
			if (comIdentidade) void api.salvarIdentidade(1, 11, recomendada(true));
			return api;
		})(),
		demo: true,
		rota: (t: Tela, i?: number | string | null, busca?: Record<string, string | number | null | undefined>) => {
			const q = Object.entries(busca ?? {}).filter(([, v]) => v != null && v !== '').map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`).join('&');
			return `/dev/fluxo/${t}${i != null && i !== '' ? `/${i}` : ''}${q ? `?${q}` : ''}`;
		},
	}), [aprova, comIdentidade]);
	if (!import.meta.env.DEV) return null;
	const n = Number(id);
	const corpo = tela === 'editor' ? <EditorFluxo key={id} versaoId={n || 105} />
		: tela === 'testar' ? <TestarConversa />
		: tela === 'desempenho' ? <DesempenhoFluxo />
		: tela === 'pedido' ? <PedidoGerado key={id} pedidoId={n || 412} />
		: tela === 'personas' ? <TestarPersonas />
		: tela === 'conectores' ? <ConectoresCrm />
		: tela === 'identidade' ? <IdentidadeAgente />
		: tela === 'ofertas' ? (id === 'testar' ? <TestarOfertas /> : <OfertasAgente />)
		: tela === 'carga' ? <CargaDemo />
		: <ListaFluxos />;
	return (
		<ProvedorFixturas valor={valor}>
			{/* o voltar da tela como em /voz/agente/... (o link leva ao app de verdade) */}
			<RotaDaTela.Provider value={tela === 'carga' ? null : rotaReal(tela as Tela, id ?? (tela === 'editor' ? 105 : tela === 'pedido' ? 412 : null))}>
			<div className="min-h-screen bg-[var(--base-fundo,var(--base-fill))] px-4 py-6 text-[var(--base-texto)] sm:px-8">
				<p className="mb-4 rounded-lg px-3 py-1.5 text-[12px] font-semibold" style={{ backgroundColor: 'var(--estado-atencao-fundo)', color: 'var(--estado-atencao-texto)' }}>Modo de demonstração (só desenvolvimento): dados fictícios, nada vai ao banco.</p>
				<div className="mx-auto max-w-[1200px]">{corpo}</div>
			</div>
			</RotaDaTela.Provider>
		</ProvedorFixturas>
	);
}
