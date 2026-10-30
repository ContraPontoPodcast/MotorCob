import { useNavigate, useLocation } from 'react-router';
import { PRODUTO_MAP, CANAL_STORAGE_KEY, isCanalValido, type CanalId } from '@/lib/mensageria-produtos';
import { useAreasLiberadas } from '@/hooks/use-areas-liberadas';

/** Ordem fixa dos canais na linha: SMS · RCS · WhatsApp · E-mail. */
const ORDEM: CanalId[] = ['sms', 'rcs', 'whatsapp', 'email'];

/**
 * Linha "Canal" da moldura da Mensageria: uma pílula por canal contratado,
 * acima das abas. A ativa é o canal da rota; clicar troca o {c} mantendo a
 * aba (ou cai em /campanhas quando a aba não existe no canal de destino).
 * Rotas sem canal (atendimento, radar, config/atendimento) mostram a mesma
 * linha; clicar leva para /mensageria/{c}/campanhas.
 */
export function CanalPills() {
	const navigate = useNavigate();
	const loc = useLocation();
	const { canais } = useAreasLiberadas();

	const ordenados = ORDEM.filter(c => canais.includes(c));
	if (ordenados.length === 0) return null;

	const m = loc.pathname.match(/^\/mensageria\/([^/]+)(\/([^/]+))?/);
	const canalDaRota = m && isCanalValido(m[1]) ? (m[1] as CanalId) : null;

	function trocar(novo: CanalId) {
		try { localStorage.setItem(CANAL_STORAGE_KEY, novo); } catch { /* ignore */ }
		const match = loc.pathname.match(/^\/mensageria\/([^/]+)(\/([^/]+))?/);
		if (match && isCanalValido(match[1])) {
			const aba = match[3]; // 'lotes', 'campanhas', 'templates', ...
			if (aba === 'lotes' && novo === 'whatsapp') {
				navigate(`/mensageria/${novo}/campanhas`);
			} else if (aba) {
				navigate(`/mensageria/${novo}/${aba}`);
			} else {
				navigate(`/mensageria/${novo}`);
			}
		} else {
			navigate(`/mensageria/${novo}/campanhas`);
		}
	}

	const unico = ordenados.length === 1;

	return (
		<div className="flex items-center gap-2 border-b px-4 py-2" style={{ borderColor: 'var(--base-borda)', backgroundColor: 'var(--base-cartao)' }}>
			<span className="text-[12px] font-medium text-[var(--base-texto-3)]">Canal</span>
			<div className="flex items-center gap-1.5">
				{ordenados.map(c => {
					const ativo = c === canalDaRota;
					const nome = PRODUTO_MAP[c].nome;
					const cor = PRODUTO_MAP[c].cor;
					if (unico) {
						return (
							<span key={c} className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[12px] font-semibold" style={{ backgroundColor: 'var(--base-texto)', color: 'var(--base-cartao)' }}>
								<span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: cor }} />
								{nome}
							</span>
						);
					}
					return (
						<button
							key={c}
							onClick={() => trocar(c)}
							className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[12px] font-semibold transition-colors"
							style={ativo
								? { backgroundColor: 'var(--base-texto)', color: 'var(--base-cartao)' }
								: { border: '1px solid var(--base-borda)', color: 'var(--base-texto-2)' }
							}
						>
							<span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: cor }} />
							{nome}
						</button>
					);
				})}
			</div>
		</div>
	);
}
