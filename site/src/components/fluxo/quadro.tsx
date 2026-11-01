// Quadro por ramos do editor (decisão do dono, no lugar do canvas livre com linhas) e a barra de envio para aprovação.
// Componentes só de apresentação (sem dados nem rotas), testados em site/fluxo/componentes.test.tsx.
import { Lock } from 'lucide-react';
import { Pilula } from '@/components/voz/ui';
import {
	MODOS, quadroPorRamos, resumoBloco, textoSaida, tituloBloco,
	type Bloco, type Definicao, type SituacaoVersao,
} from '@/lib/fluxo';
import { Detalhes, Ponto } from './ds';

export type Marca = 'erro' | 'atencao';

/** Etapa com trava fixa (o cadeado do cartão): abertura, identidade, transferir para humano e o recado neutro. */
export const temTrava = (b: Bloco) => b.tipo === 'abertura' || b.tipo === 'identidade' || (b.tipo === 'encerrar' && b.params?.resultado === 'recado') || b.tipo === 'generativa';

function CartaoEtapa({ b, marca, compartilhados, onAbrir }: { b: Bloco; marca?: Marca; compartilhados: Set<string>; onAbrir: (id: string) => void }) {
	const resumo = resumoBloco(b);
	return (
		<button type="button" onClick={() => onAbrir(b.id)} data-etapa={b.id}
			className="flex min-w-0 flex-col items-stretch gap-1.5 rounded-xl px-3 py-2.5 text-left hover:shadow-sm"
			style={{ backgroundColor: 'var(--base-cartao)', border: `1px solid ${marca === 'erro' ? 'var(--estado-erro)' : 'var(--base-borda)'}`, borderLeft: `4px solid ${MODOS[b.modo]?.cor ?? 'var(--base-borda)'}` }}>
			<span className="flex items-center justify-between gap-1.5">
				<b className="min-w-0 truncate text-[13px] font-semibold text-[var(--base-texto)]">{b.id} · {tituloBloco(b)}</b>
				{marca === 'erro' ? <Pilula tom="erro">impede</Pilula> : marca === 'atencao' ? <Pilula tom="atencao">atenção</Pilula> : temTrava(b) ? <Lock size={13} className="shrink-0 text-[var(--base-texto-3)]" aria-label="Etapa com trava fixa" /> : null}
			</span>
			{resumo && <span className="text-[12px] text-[var(--base-texto-2)]" style={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{resumo}</span>}
			<span className="flex flex-wrap gap-x-2.5 gap-y-0.5 text-[12px] text-[var(--base-texto-2)]">
				{b.saidas.length ? b.saidas.map(s => (
					<span key={s.quando} title={textoSaida(s, compartilhados)}>{s.rotulo} <b className="text-[var(--base-texto)]">{compartilhados.has(s.para) ? '↪' : '→'} {s.para}</b></span>
				)) : <span>fim</span>}
			</span>
		</button>
	);
}

/** O caminho principal em cima e os ramos embaixo; cada etapa mostra as saídas como "Sim → N5". No celular, vira uma coluna. */
export function Quadro({ definicao, marcas, vista, onAbrir }: { definicao: Definicao; marcas: Map<string, Marca>; vista: 'quadro' | 'lista'; onAbrir: (id: string) => void }) {
	const ramos = quadroPorRamos(definicao);
	const compartilhados = new Set(ramos.filter(r => r.tipo === 'finais').flatMap(r => r.blocos.map(b => b.id)));
	const qtd = (n: number) => `${n} ${n === 1 ? 'etapa' : 'etapas'}`;
	if (vista === 'lista') {
		return (
			<div className="rounded-2xl bg-[var(--base-cartao)] px-4" style={{ boxShadow: '0 0 0 1px var(--base-borda)' }}>
				{ramos.map(r => (
					<Detalhes key={r.nome + (r.origem ?? '')} titulo={r.nome} qtd={qtd(r.blocos.length)} aberto={r.tipo === 'principal'}>
						<div className="flex flex-col gap-2">{r.blocos.map(b => <CartaoEtapa key={b.id} b={b} marca={marcas.get(b.id)} compartilhados={compartilhados} onAbrir={onAbrir} />)}</div>
					</Detalhes>
				))}
			</div>
		);
	}
	const raia = (r: (typeof ramos)[number], principal: boolean) => (
		<section key={r.nome + (r.origem ?? '')} aria-label={r.nome} className="flex min-w-0 flex-col gap-2 rounded-2xl p-2.5" style={{ backgroundColor: 'var(--base-fill)' }}>
			<div className="flex justify-between gap-2 px-0.5 text-[12px] font-semibold text-[var(--base-texto-2)]">
				<span className="min-w-0 truncate">{r.nome}{r.origem ? <span className="font-normal text-[var(--base-texto-3)]"> · de {r.origem}</span> : null}</span>
				<span className="shrink-0 font-normal">{qtd(r.blocos.length)}</span>
			</div>
			<div className="grid items-start gap-2" style={{ gridTemplateColumns: principal ? 'repeat(auto-fill, minmax(min(210px, 100%), 1fr))' : 'minmax(0, 1fr)' }}>
				{r.blocos.map(b => <CartaoEtapa key={b.id} b={b} marca={marcas.get(b.id)} compartilhados={compartilhados} onAbrir={onAbrir} />)}
			</div>
		</section>
	);
	const [principal, ...resto] = ramos;
	return (
		<div className="space-y-3">
			{principal && raia(principal, principal.tipo === 'principal')}
			{resto.length > 0 && (
				<div className="grid items-start gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(210px, 100%), 1fr))' }}>
					{resto.map(r => raia(r, false))}
				</div>
			)}
		</div>
	);
}

/** Legenda curta dos modos (cor + nome simples). */
export function LegendaModos() {
	return (
		<div className="flex flex-wrap gap-x-3 gap-y-1 text-[12px] text-[var(--base-texto-2)]">
			{Object.values(MODOS).map(m => <span key={m.nome} className="inline-flex items-center gap-1"><Ponto cor={m.cor} />{m.nome}</span>)}
		</div>
	);
}

/**
 * Ação principal do editor. "Enviar para aprovação" fica desabilitado, com o motivo escrito ao lado, enquanto houver
 * pendência (decisão do dono). Quem aprova vê também "Aprovar" (mesmo bloqueio); depois, "Colocar em uso".
 */
export function BarraEnvio({ situacao, estado, podeEditar, podeAprovar, ocupado, onEnviar, onAprovar, onUsar }: {
	situacao: SituacaoVersao; estado: { ok: boolean; motivo: string }; podeEditar: boolean; podeAprovar: boolean; ocupado?: boolean;
	onEnviar: () => void; onAprovar: () => void; onUsar: () => void;
}) {
	const btn = 'inline-flex h-9 items-center justify-center gap-1.5 rounded-lg px-4 text-[13px] font-semibold disabled:cursor-not-allowed disabled:opacity-50';
	const prim = { backgroundColor: 'var(--destaque)', color: 'var(--destaque-texto)' };
	const sec = { border: '1px solid var(--base-borda)', color: 'var(--base-texto)' };
	if (situacao === 'aprovado_empresa') {
		return (
			<div className="flex flex-col items-end gap-1">
				{podeAprovar
					? <button type="button" className={btn} style={prim} disabled={ocupado} onClick={onUsar}>Colocar em uso</button>
					: <span className="text-[12.5px] text-[var(--base-texto-2)]">Aprovada. Quem tem Aprovar roteiro de voz coloca em uso.</span>}
			</div>
		);
	}
	if (situacao !== 'rascunho') return null;
	const bloqueado = !estado.ok || !!ocupado;
	return (
		<div className="flex flex-col items-start gap-1 sm:items-end">
			<div className="flex flex-wrap gap-2">
				{podeAprovar && <button type="button" className={btn} style={sec} disabled={bloqueado} aria-describedby={estado.motivo ? 'motivo-envio' : undefined} onClick={onAprovar}>Aprovar</button>}
				{podeEditar && <button type="button" className={btn} style={prim} disabled={bloqueado} title={estado.motivo || undefined} aria-describedby={estado.motivo ? 'motivo-envio' : undefined} onClick={onEnviar}>Enviar para aprovação</button>}
			</div>
			{estado.motivo && <span id="motivo-envio" role="status" className="text-[12px]" style={{ color: estado.ok ? 'var(--base-texto-3)' : 'var(--estado-erro-texto)' }}>{estado.motivo}</span>}
		</div>
	);
}
