// A conversa de teste (simulador por texto), usada em dois lugares: o painel "Testar conversa" ao lado do Roteiro
// (PR6 do redesenho) e a tela cheia /voz/agente/testar. Mesmo backend de sempre: api.simular (Edge Function
// simular_fluxo_voz, que roda o MESMO executor da ligação com o cliente de teste) e api.ouvir (prévia de voz).
// Nenhuma chamada nova. O simulador não guarda estado: cada fala reenvia a conversa toda.
import { useEffect, useRef, useState } from 'react';
import { Lock, Volume2 } from 'lucide-react';
import { Botao, campoCls, campoStyle } from '@/components/voz/ui';
import { MODOS, falaOk, rotuloTrava, textoFim, travasDoTeste, type Modo } from '@/lib/fluxo';
import { comoSoa } from '@/lib/falado';
import type { CenarioConector, FluxoApi, Simulacao } from './api';
import { mensagem } from './comum';

export interface EstadoConversa {
	sim: Simulacao | null; falas: string[]; ocupado: boolean; erro: string;
	rodar: (lista: string[]) => Promise<void>; enviar: (t: string) => void;
}

/** Estado da conversa de teste de uma versão. `ativo` liga o começo automático (a fala de abertura). */
export function useConversaTeste(api: FluxoApi | null, versao: number, cenarios: Record<string, CenarioConector>, ativo: boolean): EstadoConversa {
	const [falas, setFalas] = useState<string[]>([]);
	const [sim, setSim] = useState<Simulacao | null>(null);
	const [erro, setErro] = useState('');
	const [ocupado, setOcupado] = useState(false);
	async function rodar(lista: string[]) {
		if (!api || !versao) return;
		setOcupado(true); setErro('');
		try { setSim(await api.simular(versao, lista, [], cenarios)); setFalas(lista); } catch (e) { setErro(mensagem(e)); } finally { setOcupado(false); }
	}
	useEffect(() => { setSim(null); setFalas([]); if (ativo && versao) void rodar([]); }, [versao, JSON.stringify(cenarios), ativo]);
	function enviar(t: string) {
		const f = t.trim();
		if (!falaOk(f) || ocupado || sim?.encerrada) return;
		void rodar([...falas, f]);
	}
	return { sim, falas, ocupado, erro, rodar, enviar };
}

/** Atalhos do que o cliente diria: comuns, objeções e os que disparam travas (sem silêncio: chega com o PR8). */
export const ATALHOS: { grupo: string; trava?: boolean; itens: string[] }[] = [
	{ grupo: 'Comuns', itens: ['Sou eu.', '15 de março.', 'Quero parcelar.', 'Aceito as 6 parcelas.'] },
	{ grupo: 'Objeções', itens: ['Já paguei.', 'Não reconheço essa dívida.', 'Tô desempregado.', 'Tira os juros que eu fecho.'] },
	{ grupo: 'Travas', trava: true, itens: ['Não me ligue mais.', 'Quero falar com uma pessoa.', 'Não, aqui é a vizinha.'] },
];

/**
 * A conversa: falas do agente e do cliente, a etapa de cada fala (com o nome, nunca o código), "soa:" quando
 * "Como soa" está ligado, a trava que agiu e quando, e o fim. Embaixo, os atalhos e o campo de texto.
 */
export function Conversa({ estado, nomes, soa, onOuvir, tocando, onEtapa, alturaMax = 'max-h-[60vh]' }: {
	estado: EstadoConversa; nomes: Map<string, string>; soa?: boolean;
	onOuvir?: (texto: string, chave: string) => void; tocando?: string | null;
	/** Clique no nome da etapa (no painel ao lado, rola o Roteiro até ela). */
	onEtapa?: (id: string) => void; alturaMax?: string;
}) {
	const { sim, ocupado } = estado;
	const [texto, setTexto] = useState('');
	const fim = useRef<HTMLDivElement>(null);
	useEffect(() => { fim.current?.scrollIntoView?.({ block: 'nearest' }); }, [sim]);
	const travas = travasDoTeste(sim?.turnos ?? []);
	const nomeEtapa = (id: string | null) => (id ? nomes.get(id) ?? id : null);
	const textoOk = falaOk(texto.trim());
	return (
		<div className="flex min-h-0 flex-col">
			<div className={`flex ${alturaMax} min-h-0 flex-col gap-2.5 overflow-y-auto pr-1`} aria-live="polite" data-conversa>
				{!sim && ocupado && <p className="text-[13px] text-[var(--base-texto-3)]">Começando a conversa…</p>}
				{(sim?.turnos ?? []).map((t, i) => (
					<div key={i} className="flex flex-col gap-2">
						{t.pessoa && <div className="max-w-[85%] self-end rounded-[12px_12px_4px_12px] px-3 py-2 text-[13.5px] text-[var(--base-texto)]" style={{ backgroundColor: 'var(--destaque-suave)' }}>{t.pessoa}</div>}
						{travas.filter(x => x.turno === i).map(x => (
							<div key={x.trava} data-trava={x.trava} className="inline-flex items-center gap-1.5 self-center text-center text-[12px] font-semibold text-[var(--area-voz)]">
								<Lock size={12} aria-hidden /> {rotuloTrava(x)}{x.etapa ? ` · agiu em ${nomeEtapa(x.etapa)}` : ''}
							</div>
						))}
						{t.falas.map((f, j) => {
							const nome = nomeEtapa(f.bloco);
							return (
								<div key={j} className="max-w-[88%]">
									<div className="flex items-start gap-1.5">
										<div className="min-w-0 rounded-[12px_12px_12px_4px] bg-[var(--base-fill)] px-3 py-2 text-[13.5px] text-[var(--base-texto)]">{f.texto}</div>
										{onOuvir && <button type="button" aria-label="Ouvir esta fala" title="Ouvir a voz" disabled={!!tocando} onClick={() => onOuvir(soa ? comoSoa(f.texto) : f.texto, `${i}-${j}`)} className="mt-1 shrink-0 rounded-full p-1 text-[var(--base-texto-3)] hover:text-[var(--base-texto)] disabled:opacity-50"><Volume2 size={15} className={tocando === `${i}-${j}` ? 'animate-pulse' : ''} /></button>}
									</div>
									{soa && comoSoa(f.texto) !== f.texto && <p className="mt-1 text-[12px] italic text-[var(--base-texto-2)]">soa: “{comoSoa(f.texto)}”</p>}
									<div className="mt-0.5 text-[11.5px] text-[var(--base-texto-3)]">
										{nome && (onEtapa && f.bloco ? <button type="button" className="font-semibold text-[var(--destaque)] underline-offset-2 hover:underline" onClick={() => onEtapa(f.bloco!)}>{nome}</button> : <span>{nome}</span>)}
										{[!nome && t.travas.length ? 'trava fixa' : null, MODOS[f.modo as Modo]?.nome, j === t.falas.length - 1 && t.intencao ? `entendeu: ${t.intencao.intencao.replace(/_/g, ' ')} (${t.intencao.confianca})` : null, j === t.falas.length - 1 && t.conectores.length ? t.conectores.map(c => `${c.nome ?? `conector ${c.conector}`} ${c.status ?? c.classe}`).join(' · ') : null].filter(Boolean).map(x => ` · ${x}`).join('')}
									</div>
								</div>
							);
						})}
						{t.fim && <div className="self-center text-[12.5px] font-semibold text-[var(--base-texto)]" data-fim>Fim · {textoFim(t.fim)}</div>}
					</div>
				))}
				<div ref={fim} />
			</div>
			{estado.erro && <p role="alert" className="mt-2 text-[12.5px] text-[var(--estado-erro-texto)]">{estado.erro}</p>}
			{!sim?.encerrada ? (
				<>
					<div className="mt-3 space-y-1.5" aria-label="Atalhos do cliente">
						{ATALHOS.map(g => (
							<div key={g.grupo} className="flex flex-wrap items-center gap-1.5">
								<span className="w-[72px] shrink-0 text-[10.5px] font-bold uppercase tracking-[0.05em] text-[var(--base-texto-3)]">{g.grupo}</span>
								{g.itens.map(s => (
									<button key={s} type="button" disabled={ocupado} onClick={() => estado.enviar(s)}
										className="inline-flex h-7 items-center gap-1 rounded-full px-2.5 text-[12px] text-[var(--base-texto)] hover:bg-[var(--base-fill)] disabled:opacity-50"
										style={{ boxShadow: `0 0 0 1px ${g.trava ? 'var(--area-voz)' : 'var(--base-borda)'}` }}>
										{g.trava && <Lock size={11} aria-hidden />}{s}
									</button>
								))}
							</div>
						))}
					</div>
					<form className="mt-2.5 flex gap-2" onSubmit={e => { e.preventDefault(); if (textoOk) { estado.enviar(texto); setTexto(''); } }}>
						<input aria-label="Mensagem" value={texto} maxLength={300} onChange={e => setTexto(e.target.value)} placeholder="Escreva como se fosse o cliente…" className={`${campoCls} h-10 min-w-0 flex-1`} style={campoStyle} />
						<Botao type="submit" disabled={!textoOk || ocupado}>Enviar</Botao>
					</form>
					{texto && !textoOk && <p className="mt-1 text-[12px] text-[var(--estado-erro-texto)]">Até 300 caracteres, sem número de documento, telefone ou e-mail.</p>}
				</>
			) : <div className="mt-3"><Botao secundario onClick={() => void estado.rodar([])}>Recomeçar</Botao></div>}
		</div>
	);
}
