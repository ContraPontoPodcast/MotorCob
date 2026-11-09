// "Testar conversa" ao lado do Roteiro (PR6 do redesenho; SPEC §2.1 e U10). Abre no próprio editor (?testar=1), não
// em outra página: a etapa em que a conversa está fica acesa no Roteiro e o painel diz qual trava agiu e quando. No
// celular, ocupa a tela toda. Usa o mesmo simulador de sempre (api.simular e api.ouvir, Edge Function
// simular_fluxo_voz); a tela cheia /voz/agente/testar continua, com as opções de conector e os casos de teste.
import { useState } from 'react';
import { Lock, Maximize2, RotateCcw, X } from 'lucide-react';
import { rotuloTrava, textoFim, travasDoTeste, type Definicao } from '@/lib/fluxo';
import type { FluxoApi } from './api';
import { Conversa, type EstadoConversa } from './conversa-teste';
import { mensagem } from './comum';

export function PainelTestar({ estado, definicao, nomes, api, versao, onFechar, onEtapa, onTelaCheia }: {
	estado: EstadoConversa; definicao: Definicao; nomes: Map<string, string>; api: FluxoApi | null; versao: number;
	onFechar: () => void; onEtapa: (id: string) => void; onTelaCheia: () => void;
}) {
	const [soa, setSoa] = useState(true);
	const [tocando, setTocando] = useState<string | null>(null);
	const [erro, setErro] = useState('');
	const { sim } = estado;
	const ids = new Set(definicao.blocos.map(b => b.id));
	const cam = (sim?.caminho ?? []).filter(id => ids.has(id));
	const atual = cam[cam.length - 1] ?? null;
	const travas = travasDoTeste(sim?.turnos ?? []);
	const fim = [...(sim?.turnos ?? [])].reverse().find(t => t.fim)?.fim ?? null;
	async function ouvir(texto: string, chave: string) {
		if (!api || tocando) return;
		setTocando(chave); setErro('');
		try {
			const r = await api.ouvir(versao, texto);
			if (!r.audio) throw new Error('Prévia sem áudio no modo de demonstração.');
			const a = new Audio(`data:${r.mime};base64,${r.audio}`);
			a.onended = () => setTocando(null);
			await a.play();
		} catch (e) { setErro(mensagem(e)); setTocando(null); }
	}
	return (
		<aside aria-label="Testar conversa" data-testar-ao-lado
			className="fixed inset-0 z-50 flex flex-col overflow-hidden bg-[var(--base-cartao)] lg:sticky lg:inset-auto lg:top-4 lg:z-auto lg:max-h-[calc(100vh-2rem)] lg:rounded-2xl"
			style={{ boxShadow: '0 0 0 1px var(--base-borda)' }}>
			<header className="space-y-1.5 border-b px-4 pb-3 pt-3.5" style={{ borderColor: 'var(--base-borda)' }}>
				<div className="flex items-center gap-2">
					<h2 className="min-w-0 flex-1 text-[15px] font-semibold text-[var(--base-texto)]">Testar conversa</h2>
					<label className="inline-flex items-center gap-1.5 text-[12.5px] text-[var(--base-texto-2)]"><input type="checkbox" className="accent-[var(--destaque)]" checked={soa} onChange={e => setSoa(e.target.checked)} /> Como soa</label>
					<button type="button" onClick={() => void estado.rodar([])} disabled={estado.ocupado} className="inline-flex h-8 items-center gap-1 rounded-full px-2.5 text-[12.5px] font-semibold text-[var(--base-texto)] disabled:opacity-50" style={{ boxShadow: '0 0 0 1px var(--base-borda)' }}><RotateCcw size={13} aria-hidden /> Recomeçar</button>
					<button type="button" aria-label="Fechar o teste" onClick={onFechar} className="grid h-8 w-8 place-items-center rounded-full text-[var(--base-texto-2)] hover:bg-[var(--base-fill)]"><X size={16} /></button>
				</div>
				<p className="text-[12px] text-[var(--base-texto-2)]">
					Por texto, sem ligar. Cliente de teste fictício e conectores simulados.{' '}
					<button type="button" onClick={onTelaCheia} className="inline-flex items-center gap-0.5 font-semibold text-[var(--destaque)] underline-offset-2 hover:underline"><Maximize2 size={11} aria-hidden /> Tela cheia</button> (opções de conector e casos de teste).
				</p>
				<p className="text-[12.5px] text-[var(--base-texto)]" data-agora>
					{atual ? <>{sim?.encerrada ? 'Terminou em' : 'Agora em'} <button type="button" onClick={() => onEtapa(atual)} className="font-semibold text-[var(--destaque)] underline-offset-2 hover:underline">{nomes.get(atual) ?? atual}</button>{sim?.encerrada && fim ? ` · ${textoFim(fim)}` : ''}</> : <span className="text-[var(--base-texto-3)]">Começando…</span>}
				</p>
				{travas.length > 0 && (
					<ul className="space-y-0.5" aria-label="Travas que agiram" data-travas-agiram>
						{travas.map((t, i) => (
							<li key={i} className="flex items-start gap-1.5 text-[12px] text-[var(--base-texto)]">
								<Lock size={12} className="mt-[2px] shrink-0 text-[var(--area-voz)]" aria-hidden />
								<span><b className="font-semibold text-[var(--area-voz)]">{rotuloTrava(t)}</b> · {t.pessoa ? `quando o cliente disse “${t.pessoa}”` : 'na abertura'}{t.etapa ? `, em ${nomes.get(t.etapa) ?? t.etapa}` : ''}</span>
							</li>
						))}
					</ul>
				)}
			</header>
			<div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
				{erro && <p role="alert" className="mb-2 text-[12.5px] text-[var(--estado-erro-texto)]">{erro}</p>}
				<Conversa estado={estado} nomes={nomes} soa={soa} onOuvir={api ? (t, k) => void ouvir(t, k) : undefined} tocando={tocando} onEtapa={onEtapa} alturaMax="max-h-none" />
			</div>
		</aside>
	);
}
