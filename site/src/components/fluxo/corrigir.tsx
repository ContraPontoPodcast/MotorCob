// "O que corrigir" dentro da etapa (PR4 do redesenho; SPEC §2.1 e §6, pergunta Q6): o problema, o motivo, o que fazer
// e, quando a correção é determinística, um botão. O botão nunca muda nada sozinho: abre o antes → depois e só depois de
// confirmar a mudança vai para o rascunho (mesmo salvar_fluxo_voz de sempre). O banco continua decidindo se o fluxo
// vale. As correções em si são funções puras em site/src/lib/fluxo.ts (correcaoDe), testadas com os mesmos casos do
// validador Python (tests/dados/fluxo_correcoes_casos.json).
import type { ReactNode } from 'react';
import { ArrowRight } from 'lucide-react';
import { ConfirmaAcao } from '@/components/comuns/confirma-acao';
import { Pilula } from '@/components/voz/ui';
import type { Correcao } from '@/lib/fluxo';

/** Ação do botão de um "O que corrigir": a correção de um clique ou um atalho (cadastrar alçada, abrir testes). */
export interface AcaoCorrigir { rotulo: string; onClick: () => void; disabled?: boolean; motivo?: string }

/** "O que corrigir" dentro da etapa: o quê, por quê / como corrigir, se segura o envio e o botão (se houver). */
export function OQueCorrigir({ impede, texto, como, acao, fluxo }: { impede: boolean; texto: ReactNode; como?: string; acao?: AcaoCorrigir | null; fluxo?: boolean }) {
	return (
		<div role={impede ? 'alert' : 'status'} data-corrigir="" className="flex flex-wrap items-start gap-x-3 gap-y-2 rounded-xl px-3 py-2.5 text-[13px] text-[var(--base-texto)]" style={{ backgroundColor: impede ? 'var(--estado-erro-fundo)' : 'var(--estado-atencao-fundo)' }}>
			<div className="min-w-[200px] flex-1">
				<span className="flex flex-wrap items-center gap-x-2 gap-y-1">
					<b className="font-semibold" style={{ color: impede ? 'var(--estado-erro-texto)' : 'var(--estado-atencao-texto)' }}>{impede ? (fluxo ? 'O que corrigir (fluxo):' : 'O que corrigir:') : (fluxo ? 'Antes de aprovar:' : 'Atenção:')}</b>
					<span className="min-w-0">{texto}</span>
					{impede && <Pilula tom="erro">impede o envio</Pilula>}
				</span>
				{como && <small className="mt-1 block text-[12.5px] text-[var(--base-texto-2)]">{como}</small>}
			</div>
			{acao && (
				<button type="button" onClick={acao.onClick} disabled={acao.disabled} title={acao.disabled ? acao.motivo : undefined}
					className="inline-flex min-h-8 max-w-full items-center rounded-lg px-3 py-1.5 text-left text-[12.5px] font-semibold leading-snug disabled:opacity-50"
					style={impede ? { backgroundColor: 'var(--destaque)', color: 'var(--destaque-texto)' } : { backgroundColor: 'var(--base-cartao)', color: 'var(--base-texto)', boxShadow: '0 0 0 1px var(--base-borda)' }}>
					{acao.rotulo}
				</button>
			)}
			{acao?.disabled && acao.motivo && <small className="basis-full text-[12px] text-[var(--base-texto-2)]">{acao.motivo}</small>}
		</div>
	);
}

/** O antes → depois de uma correção, como aparece no aviso de confirmação. */
export function AntesDepois({ c, local }: { c: Correcao; local?: boolean }) {
	return (
		<div className="space-y-3">
			<ul className="space-y-2.5" aria-label="O que muda no rascunho">
				{c.mudancas.map((m, i) => (
					<li key={i} className="space-y-1">
						<b className="block text-[12.5px] font-semibold text-[var(--base-texto-2)]">{m.onde}</b>
						<span className="grid gap-1 text-[13px] sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] sm:items-center">
							<span className="rounded-lg px-2.5 py-1.5 text-[var(--base-texto-2)] line-through decoration-[var(--estado-erro-texto)]" style={{ backgroundColor: 'var(--estado-erro-fundo)' }}><span className="sr-only">Antes: </span>{m.antes}</span>
							<ArrowRight size={14} className="hidden text-[var(--base-texto-3)] sm:block" aria-hidden />
							<span className="rounded-lg px-2.5 py-1.5 font-medium text-[var(--base-texto)]" style={{ backgroundColor: 'var(--estado-pronto-fundo)' }}><span className="sr-only">Depois: </span>{m.depois}</span>
						</span>
					</li>
				))}
			</ul>
			{c.nota && <p className="text-[12.5px] text-[var(--base-texto-2)]">{c.nota}</p>}
			<p className="text-[12.5px] text-[var(--base-texto-3)]">{local ? 'Troca o texto aqui na gaveta. Depois, salve a etapa.' : 'A mudança vai para o rascunho.'} Nada vai para ligação sem aprovação.</p>
		</div>
	);
}

/** Aviso de confirmação da correção de um clique: mostra o antes → depois e só então aplica. */
export function ConfirmaCorrecao({ correcao, ocupado, onConfirmar, onFechar, local }: { correcao: Correcao | null; ocupado?: boolean; onConfirmar: (c: Correcao) => void; onFechar: () => void; local?: boolean }) {
	return (
		<ConfirmaAcao
			aberto={correcao != null}
			titulo={correcao ? `${correcao.botao}?` : ''}
			texto={correcao ? <AntesDepois c={correcao} local={local} /> : null}
			botao={local ? 'Trocar a fala' : 'Aplicar no rascunho'}
			loading={ocupado}
			onClose={onFechar}
			onConfirm={() => correcao && onConfirmar(correcao)}
		/>
	);
}
