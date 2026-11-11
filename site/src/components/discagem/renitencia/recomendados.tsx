// Agente Voz/CX › Discagem › Renitência: a tabela dos padrões recomendados (REVISAO_ESPECIALISTA.md D2; PR 8 do plano)
// com o que vale nesta carteira ao lado e "Usar os padrões recomendados" (só no rascunho: vale ao salvar como vN).
import { Aviso, Botao, Cartao, Pilula, Tabela } from '@/components/ds';
import {
	RENITENCIA_RECOMENDADA, aplicarRenitenciaRecomendada, foraDoRecomendado, hojeNaCarteira, type LinhaRecomendada,
} from '@/lib/discagem-recomendado';
import type { DiscagemRen } from '@/lib/renitencia';

export function RenitenciaRecomendada({ draft, setDraft, canEdit }: { draft: DiscagemRen; setDraft: (d: DiscagemRen) => void; canEdit: boolean }) {
	const fora = foraDoRecomendado(draft);
	const ok = fora.length === 0;
	return (
		<Cartao titulo="Padrões recomendados" linha="Cada tentativa evitada em número que não atende reduz as chamadas curtas."
			direita={ok ? <Pilula tom="ok">Esta carteira já segue</Pilula> : canEdit ? <Botao tipo="secundario" pequeno onClick={() => setDraft(aplicarRenitenciaRecomendada(draft))}>Usar os padrões recomendados</Botao> : <Pilula tom="atencao">{fora.length} diferente{fora.length > 1 ? 's' : ''}</Pilula>}>
			<Tabela<LinhaRecomendada> rotulo="Padrões recomendados de renitência" linhas={RENITENCIA_RECOMENDADA} chave={l => l.k}
				colunas={[
					{ id: 's', titulo: 'Situação', celula: l => l.situacao },
					{ id: 'r', titulo: 'Rediscar', celula: l => l.rediscar },
					{ id: 'm', titulo: 'Máx. por dia no número', num: true, celula: l => l.maxDia },
					{ id: 'd', titulo: 'Depois', celula: l => <span className="text-[var(--base-texto-2)]">{l.depois}</span> },
					{ id: 'c', titulo: 'Nesta carteira', celula: l => l.confere ? (l.confere(draft) ? <Pilula tom="ok">igual</Pilula> : <span className="text-[var(--base-texto-2)]">{hojeNaCarteira(draft, l.k)}</span>) : <span className="text-[var(--base-texto-3)]">já é assim</span> },
				]}
				celular={l => ({ titulo: l.situacao, valor: l.confere ? (l.confere(draft) ? 'igual' : 'diferente') : undefined, resumo: `${l.rediscar} · máx. ${l.maxDia} · ${l.depois}` })} />
			{!ok && (
				<div className="mt-3">
					<Aviso tom="info">
						Diferente nesta carteira: {fora.join(', ')}. O botão muda só o rascunho (fixa 2 tentativas por número e liga a regra por sinalização); nada vale até salvar, e a versão atual fica no histórico.
					</Aviso>
				</div>
			)}
		</Cartao>
	);
}
