// Agente Voz/CX › Discagem › Ritmo: bloco "Posição do número" (REVISAO_ESPECIALISTA.md D3; PREDITIVO.md 5.1 "o que hoje
// é o modo de discagem"; PR 8 do plano). Mostra o modo que vale na carteira, o recomendado (2 telefones por dia,
// horizontal) e abre a mesma gaveta do modo da Renitência para editar. Muda só o rascunho: vale ao salvar como vN.
import { Botao, Cartao, ListaRegras, Pilula } from '@/components/ds';
import { POSICAO_RECOMENDADA, aplicarPosicaoRecomendada, posicaoNoRecomendado, resumoPosicao } from '@/lib/discagem-recomendado';
import type { DiscagemRen } from '@/lib/renitencia';

export function PosicaoNumero({ draft, setDraft, canEdit, onEditar }: { draft: DiscagemRen; setDraft: (d: DiscagemRen) => void; canEdit: boolean; onEditar: () => void }) {
	const ok = posicaoNoRecomendado(draft);
	return (
		<Cartao titulo="Posição do número" linha={resumoPosicao(draft)}
			direita={<>
				{ok ? <Pilula tom="ok">Recomendado</Pilula> : canEdit && <Botao tipo="secundario" pequeno onClick={() => setDraft(aplicarPosicaoRecomendada(draft))}>Usar o recomendado</Botao>}
				<Botao tipo="fantasma" pequeno onClick={onEditar}>{canEdit ? 'Editar o modo' : 'Ver o modo'}</Botao>
			</>}>
			<ListaRegras regras={[
				{ titulo: 'Recomendado', texto: `${POSICAO_RECOMENDADA} Não 5 telefones em sequência: cada número a mais que não atende vira chamada curta.` },
				{ titulo: 'Hora em que o número costuma atender', texto: 'Use a ordem “Melhor horário pelo histórico” para ligar antes nesse horário, dentro da janela da UF.' },
				{ titulo: 'Nunca troque a bina para fugir de bloqueio', texto: 'A linha que liga é sempre a mesma. Trocar a bina ou espalhar por mais linhas para contornar a regra das curtas pode endurecer os critérios da Anatel.' },
			]} />
		</Cartao>
	);
}
