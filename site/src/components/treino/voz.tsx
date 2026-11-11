// Sessão de treino por VOZ em tela cheia (Roleplay, SQL 119): o operador fala com a cliente simulada pelo microfone.
// O áudio vai por WebSocket seguro até o serviço de voz da VM (voz/treino_voz.py), com o bilhete de uso único que a Edge
// Function `treino` emite (o roteiro da cliente vai dentro, assinado; a tela não lê). STT, cliente simulada, TTS e a
// avaliação rodam lá; a transcrição volta ao vivo, já mascarada. Áudio nunca é guardado.
// Serve ao operador pelo link e à Qualidade (treino lado a lado e teste do cenário), como a sessão por texto:
// - antes: teste de microfone (nível ao vivo), "Estou de fone" e "Ouvir a voz"; microfone bloqueado → texto a 1 clique;
// - na ligação: transcrição ao vivo, "Mudo", "Encerrar ligação" (vermelho, com confirmação), relógio e controles fixos
//   no rodapé (no celular, sempre à mão);
// - sair por qualquer caminho pede confirmação ("Continuar treinando", "Encerrar e ver a nota", "Sair sem contar");
// - a cliente desligou ou o tempo acabou: o vermelho dá lugar a "Ver meu resultado" (a avaliação já começou na VM);
// - rede caiu ou o microfone parou: a tentativa não conta.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useBlocker } from 'react-router';
import { Loader2, Mic, MicOff, PhoneOff, Volume2 } from 'lucide-react';
import { Aviso, Botao, Modal, Pilula } from '@/components/ds';
import { textoAlcada } from '@/lib/roleplay';
import { relogio, type RespostaEncerrar, type Turno } from '@/lib/treino-sessao';
import {
	AVISO_FIM, CHAVE_FONE, CODIGO_WORKLET, TAXA_VOZ, TEXTO_ERRO_MICROFONE, dePCM16, erroMicrofone, lerMensagemVoz, nivel, paraPCM16,
	textoFimVoz, urlVozOk, type ErroMicrofone, type MensagemVoz,
} from '@/lib/treino-voz';
import type { FichaSessao, ResultadoChamada } from './sessao';

export type BilheteVoz = { url: string; bilhete: string; limite_s: number; por_franquia: boolean };
export type ChamarVoz = {
	bilhete: () => Promise<ResultadoChamada<BilheteVoz>>;
	/** "Sair sem contar" antes de a ligação conectar (a Edge Function fecha a sessão sem uso). */
	sair: () => Promise<ResultadoChamada<{ situacao: string }>>;
};
export type PedirPrevia = () => Promise<ResultadoChamada<{ audio: string; mime: string }>>;

const lerFone = () => { try { return sessionStorage.getItem(CHAVE_FONE) === '1'; } catch { return false; } };
const gravarFone = (v: boolean) => { try { sessionStorage.setItem(CHAVE_FONE, v ? '1' : '0'); } catch { /* sem armazenamento: só nesta tela */ } };
const AUDIO = { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 };

// ------------------------------------------------------------------ "Ouvir a voz"
export function OuvirVoz({ pedir, rotulo = 'Ouvir a voz' }: { pedir: PedirPrevia; rotulo?: string }) {
	const [estado, setEstado] = useState<'parado' | 'carregando' | 'tocando'>('parado');
	const [erro, setErro] = useState('');
	async function ouvir() {
		setEstado('carregando'); setErro('');
		const r = await pedir();
		if (r.erro || !r.data) { setEstado('parado'); setErro(r.erro ?? 'Não deu para gerar a prévia agora.'); return; }
		const a = new Audio(`data:${/^audio\/[a-z0-9.+-]+$/.test(r.data.mime) ? r.data.mime : 'audio/mpeg'};base64,${r.data.audio}`);
		a.onended = () => setEstado('parado');
		setEstado('tocando');
		void a.play().catch(() => { setEstado('parado'); setErro('O navegador não deixou tocar o áudio. Clique de novo.'); });
	}
	return (
		<span className="inline-flex flex-col gap-1">
			<Botao tipo="secundario" pequeno onClick={() => void ouvir()} disabled={estado !== 'parado'}>
				<Volume2 size={14} aria-hidden="true" />{estado === 'carregando' ? 'Gerando…' : estado === 'tocando' ? 'Tocando…' : rotulo}
			</Botao>
			{erro && <small role="alert" className="text-[12px] text-[var(--estado-erro-texto)]">{erro}</small>}
		</span>
	);
}

// ------------------------------------------------------------------ teste de microfone
/** Pede o microfone, mostra o nível ao vivo e guarda "Estou de fone". onOk(true) quando o navegador liberou. */
export function TesteMicrofone({ onOk, onTexto, ouvir }: { onOk: (ok: boolean) => void; onTexto?: () => void; ouvir?: PedirPrevia }) {
	const [estado, setEstado] = useState<'parado' | 'testando' | ErroMicrofone>('parado');
	const [nv, setNv] = useState(0);
	const [ouviu, setOuviu] = useState(false);
	const [fone, setFone] = useState(lerFone);
	const parar = useRef<() => void>(() => {});
	useEffect(() => () => parar.current(), []);

	async function testar() {
		parar.current();
		try {
			if (!navigator.mediaDevices?.getUserMedia) throw Object.assign(new Error('sem suporte'), { name: 'NotSupportedError' });
			const s = await navigator.mediaDevices.getUserMedia({ audio: AUDIO });
			const ctx = new AudioContext();
			const an = ctx.createAnalyser();
			an.fftSize = 1024;
			ctx.createMediaStreamSource(s).connect(an);
			const buf = new Float32Array(an.fftSize);
			let raf = 0;
			const passo = () => {
				an.getFloatTimeDomainData(buf);
				const v = nivel(buf);
				setNv(v);
				if (v > 0.08) setOuviu(true);
				raf = requestAnimationFrame(passo);
			};
			passo();
			parar.current = () => { cancelAnimationFrame(raf); s.getTracks().forEach(t => t.stop()); void ctx.close(); };
			setEstado('testando');
			onOk(true);
		} catch (e) {
			setEstado(erroMicrofone(e));
			onOk(false);
		}
	}
	return <TesteMicrofoneView estado={estado} nivel={nv} ouviu={ouviu} fone={fone} onTestar={() => void testar()} onTexto={onTexto} ouvir={ouvir}
		onFone={v => { setFone(v); gravarFone(v); }} />;
}

export function TesteMicrofoneView({ estado, nivel: nv, ouviu, fone, onTestar, onTexto, onFone, ouvir }: {
	estado: 'parado' | 'testando' | ErroMicrofone; nivel: number; ouviu: boolean; fone: boolean; onTestar: () => void; onTexto?: () => void;
	onFone: (v: boolean) => void; ouvir?: PedirPrevia;
}) {
	const erro = estado !== 'parado' && estado !== 'testando';
	return (
		<div className="space-y-3 rounded-xl bg-[var(--base-fill)] p-3 text-[13.5px]" aria-label="Teste de microfone">
			<div className="flex flex-wrap items-center gap-2">
				<Botao tipo="secundario" pequeno onClick={onTestar}><Mic size={14} aria-hidden="true" />{estado === 'testando' ? 'Testar de novo' : 'Testar o microfone'}</Botao>
				{ouvir && <OuvirVoz pedir={ouvir} />}
			</div>
			{estado === 'testando' && (
				<div className="space-y-1">
					<div className="h-2 w-full max-w-[280px] overflow-hidden rounded-full bg-[var(--base-cartao)]" role="meter" aria-label="Nível do microfone" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(nv * 100)}>
						<div className="h-full rounded-full bg-[var(--destaque)] transition-[width] duration-75" style={{ width: `${Math.round(nv * 100)}%` }} />
					</div>
					<p className="text-[12.5px] text-[var(--base-texto-2)]">{ouviu ? 'Ouvimos você. Microfone pronto.' : 'Fale alguma coisa: a barra deve se mexer.'}</p>
				</div>
			)}
			{erro && (
				<div role="alert" className="space-y-2">
					<Aviso tom="atencao">{TEXTO_ERRO_MICROFONE[estado]}</Aviso>
					{onTexto && <Botao pequeno onClick={onTexto}>Treinar por texto</Botao>}
				</div>
			)}
			<label className="flex items-start gap-2">
				<input type="checkbox" className="mt-0.5" checked={fone} onChange={e => onFone(e.target.checked)} />
				<span>Estou de fone de ouvido <small className="block text-[12px] text-[var(--base-texto-3)]">Com fone, dá para falar por cima da cliente. Sem fone, o microfone fica mudo enquanto ela fala (para não voltar o som).</small></span>
			</label>
		</div>
	);
}

// ------------------------------------------------------------------ o motor de áudio (microfone, WebSocket, alto-falante)
class MotorVoz {
	ws: WebSocket | null = null;
	ctx: AudioContext | null = null;
	stream: MediaStream | null = null;
	fontes: AudioBufferSourceNode[] = [];
	fimTocar = 0;
	mudo = false;
	fechado = false;
	recebeuFim = false;

	constructor(private o: { url: string; bilhete: string; fone: boolean; ao: (m: MensagemVoz) => void; aoNivel: (n: number) => void; aoFechar: () => void }) {}

	get tocando() { return !!this.ctx && this.ctx.currentTime < this.fimTocar; }

	async iniciar(): Promise<void> {
		this.stream = await navigator.mediaDevices.getUserMedia({ audio: AUDIO });
		this.stream.getAudioTracks().forEach(t => { t.onended = () => this.enviar({ tipo: 'microfone' }); });
		const ctx = new AudioContext();
		this.ctx = ctx;
		const fonte = ctx.createMediaStreamSource(this.stream);
		const aoQuadro = (f: Float32Array) => {
			this.o.aoNivel(nivel(f));
			if (this.mudo || this.ws?.readyState !== WebSocket.OPEN) return;
			if (!this.o.fone && this.tocando) return;            // sem fone: meia via enquanto a cliente fala
			this.ws.send(paraPCM16(f, ctx.sampleRate));
		};
		try {
			const url = URL.createObjectURL(new Blob([CODIGO_WORKLET], { type: 'application/javascript' }));
			await ctx.audioWorklet.addModule(url);
			URL.revokeObjectURL(url);
			const no = new AudioWorkletNode(ctx, 'motorcx-mic');
			no.port.onmessage = e => aoQuadro(e.data as Float32Array);
			fonte.connect(no);
		} catch {
			const no = ctx.createScriptProcessor(2048, 1, 1);           // navegador sem AudioWorklet
			no.onaudioprocess = e => aoQuadro(new Float32Array(e.inputBuffer.getChannelData(0)));
			fonte.connect(no);
			no.connect(ctx.destination);
		}
		const ws = new WebSocket(this.o.url);
		ws.binaryType = 'arraybuffer';
		this.ws = ws;
		ws.onopen = () => ws.send(JSON.stringify({ bilhete: this.o.bilhete }));
		ws.onmessage = e => {
			if (typeof e.data === 'string') {
				const m = lerMensagemVoz(e.data);
				if (!m) return;
				if (m.tipo === 'interromper') this.pararVoz();
				if (m.tipo === 'fim') this.recebeuFim = true;
				this.o.ao(m);
			} else if (e.data instanceof ArrayBuffer) this.tocar(e.data);
		};
		ws.onclose = () => { if (!this.fechado) this.o.aoFechar(); this.fechar(); };
	}

	tocar(b: ArrayBuffer) {
		const ctx = this.ctx;
		if (!ctx || !b.byteLength) return;
		const f = dePCM16(b);
		const ab = ctx.createBuffer(1, f.length, TAXA_VOZ);
		ab.getChannelData(0).set(f);
		const src = ctx.createBufferSource();
		src.buffer = ab;
		src.connect(ctx.destination);
		const ini = Math.max(ctx.currentTime + 0.02, this.fimTocar);
		src.start(ini);
		this.fimTocar = ini + ab.duration;
		this.fontes.push(src);
		src.onended = () => { this.fontes = this.fontes.filter(x => x !== src); };
	}

	pararVoz() {
		for (const s of this.fontes) { try { s.stop(); } catch { /* já parou */ } }
		this.fontes = [];
		this.fimTocar = this.ctx?.currentTime ?? 0;
	}

	enviar(d: Record<string, unknown>) { if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(d)); }
	setMudo(v: boolean) { this.mudo = v; this.enviar({ tipo: 'mudo', ligado: v }); }
	get conectado() { return this.ws?.readyState === WebSocket.OPEN; }

	fechar() {
		if (this.fechado) return;
		this.fechado = true;
		this.pararVoz();
		this.stream?.getTracks().forEach(t => t.stop());
		void this.ctx?.close().catch(() => {});
		try { this.ws?.close(); } catch { /* já fechou */ }
	}
}

// ------------------------------------------------------------------ a sessão
export type FaseVoz = 'conectando' | 'ligacao' | 'encerrada' | 'avaliando' | 'terminou';

export function SessaoVoz({ ficha, chamar, onFim, quem = 'operador' }: {
	ficha: FichaSessao; chamar: ChamarVoz; onFim: (r: RespostaEncerrar) => void; quem?: 'operador' | 'qualidade';
}) {
	const [fase, setFase] = useState<FaseVoz>('conectando');
	const [turnos, setTurnos] = useState<Turno[]>([]);
	const [parcial, setParcial] = useState('');
	const [seg, setSeg] = useState(0);
	const [limite, setLimite] = useState(ficha.duracao ?? 480);
	const [mudo, setMudo] = useState(false);
	const [nv, setNv] = useState(0);
	const [erro, setErro] = useState('');
	const [aviso, setAviso] = useState('');
	const [confirmar, setConfirmar] = useState(false);
	const motor = useRef<MotorVoz | null>(null);
	const pediuResultado = useRef(false);
	const fim = useRef<{ situacao: 'avaliada' | 'abandonada' | 'falhou'; motivo?: string; erro?: string } | null>(null);
	const terminou = useRef(false);
	const ativa = fase === 'conectando' || fase === 'ligacao' || fase === 'encerrada';

	const blocker = useBlocker(() => ativa);
	useEffect(() => { if (blocker.state === 'blocked') setConfirmar(true); }, [blocker.state]);
	useEffect(() => {
		if (!ativa) return;
		const avisar = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
		window.addEventListener('beforeunload', avisar);
		return () => window.removeEventListener('beforeunload', avisar);
	}, [ativa]);

	function concluir(r: { situacao: 'avaliada' | 'abandonada' | 'falhou'; motivo?: string; erro?: string }) {
		if (terminou.current) return;
		terminou.current = true;
		setFase('terminou');
		motor.current?.fechar();
		if (blocker.state === 'blocked') blocker.reset();
		onFim({ situacao: r.situacao, motivo: r.motivo, aviso: textoFimVoz(r) });
	}

	function aoMensagem(m: MensagemVoz) {
		switch (m.tipo) {
			case 'pronto': setLimite(m.limite_s); setFase('ligacao'); break;
			case 'fala': setParcial(''); setTurnos(t => [...t, { quem: m.quem, texto: m.texto, t: m.t }]); break;
			case 'parcial': setParcial(m.texto); break;
			case 'tempo': setSeg(m.segundos); break;
			case 'desligou': setAviso(AVISO_FIM.desligou); setFase(f => (f === 'ligacao' ? 'encerrada' : f)); break;
			case 'avaliando': setFase(f => (f === 'ligacao' ? 'encerrada' : f)); break;
			case 'erro': setErro(m.erro); break;
			case 'fim':
				fim.current = m;
				if (m.motivo && AVISO_FIM[m.motivo]) setAviso(AVISO_FIM[m.motivo]);
				if (m.situacao !== 'avaliada' || pediuResultado.current) concluir(m);
				else setFase('encerrada');
				break;
			default: break;
		}
	}

	useEffect(() => {
		let vivo = true;
		void (async () => {
			const b = await chamar.bilhete();
			if (!vivo) return;
			if (b.erro || !b.data || !urlVozOk(b.data.url)) {
				if (b.status !== 409) await chamar.sair();          // fecha a sessão sem uso: não conta, não cobra
				concluir({ situacao: 'falhou', motivo: 'servico', erro: b.erro ?? 'O treino por voz não está disponível agora. Treine por texto.' });
				return;
			}
			setLimite(b.data.limite_s);
			if (b.data.por_franquia) setAviso(`Restam ${relogio(b.data.limite_s)} de voz no treino deste mês: a ligação encerra e é avaliada se acabar.`);
			const m = new MotorVoz({
				url: b.data.url, bilhete: b.data.bilhete, fone: lerFone(), ao: aoMensagem, aoNivel: setNv,
				aoFechar: () => { if (!fim.current) concluir({ situacao: 'falhou', motivo: 'rede' }); },
			});
			motor.current = m;
			try { await m.iniciar(); } catch (e) {
				m.fechar();
				await chamar.sair();
				concluir({ situacao: 'falhou', motivo: 'microfone', erro: TEXTO_ERRO_MICROFONE[erroMicrofone(e)] });
			}
		})();
		return () => { vivo = false; motor.current?.fechar(); };
	}, []);   // uma vez por sessão: voltar a ela pelo ⟶ não reabre a ligação (o bilhete é de uso único)

	function encerrar() {
		setConfirmar(false);
		if (blocker.state === 'blocked') blocker.reset();
		pediuResultado.current = true;
		if (fim.current) { concluir(fim.current); return; }
		setFase('avaliando');
		motor.current?.enviar({ tipo: 'encerrar' });
	}

	async function sair() {
		setConfirmar(false);
		const m = motor.current;
		if (m?.conectado && !fim.current) {
			pediuResultado.current = true;
			setFase('avaliando');
			m.enviar({ tipo: 'sair' });
			setTimeout(() => concluir(fim.current ?? { situacao: 'abandonada' }), 8000);
			return;
		}
		if (!fim.current) await chamar.sair();
		const r = fim.current ?? { situacao: 'abandonada' as const };
		if (blocker.state === 'blocked') { terminou.current = true; setFase('terminou'); motor.current?.fechar(); blocker.proceed(); }
		else concluir(r.situacao === 'avaliada' ? r : { situacao: 'abandonada' });
	}

	return (
		<>
			<SessaoVozView ficha={ficha} turnos={turnos} parcial={parcial} fase={fase} segundos={seg} limite={limite} mudo={mudo} nivel={nv} erro={erro} aviso={aviso}
				quem={quem} resultadoPronto={!!fim.current && fim.current.situacao === 'avaliada'}
				onMudo={() => { const v = !mudo; setMudo(v); motor.current?.setMudo(v); }}
				onEncerrarLigacao={() => setConfirmar(true)} onSair={() => setConfirmar(true)}
				onVerResultado={() => { pediuResultado.current = true; if (fim.current) concluir(fim.current); else setFase('avaliando'); }} />
			{confirmar && (
				<Modal titulo={fase === 'ligacao' ? 'Encerrar a ligação?' : 'Sair do treino?'}
					texto="Se encerrar, a conversa é avaliada pelo checklist e conta como tentativa. Se sair sem contar, nada é avaliado e a tentativa não conta."
					onFechar={() => { setConfirmar(false); if (blocker.state === 'blocked') blocker.reset(); }}
					acoes={<>
						<Botao tipo="secundario" onClick={() => { setConfirmar(false); if (blocker.state === 'blocked') blocker.reset(); }}>Continuar treinando</Botao>
						<Botao tipo="secundario" onClick={() => void sair()}>Sair sem contar</Botao>
						<Botao onClick={encerrar}>Encerrar e ver a nota</Botao>
					</>} />
			)}
		</>
	);
}

/** A tela da sessão por voz (sem rede e sem áudio: é o que os testes renderizam). */
export function SessaoVozView({ ficha, turnos, parcial, fase, segundos, limite, mudo, nivel: nv, erro, aviso, quem, resultadoPronto, onMudo, onEncerrarLigacao, onVerResultado, onSair }: {
	ficha: FichaSessao; turnos: Turno[]; parcial: string; fase: FaseVoz; segundos: number; limite: number; mudo: boolean; nivel: number; erro: string; aviso: string;
	quem: 'operador' | 'qualidade'; resultadoPronto: boolean; onMudo: () => void; onEncerrarLigacao: () => void; onVerResultado: () => void; onSair: () => void;
}) {
	const fimRef = useRef<HTMLDivElement>(null);
	useEffect(() => { fimRef.current?.scrollIntoView?.({ block: 'end' }); }, [turnos.length, parcial, fase]);
	const sim = /fictícia/.test(ficha.persona) ? 'Cliente simulada' : 'Cliente simulado';
	const d = ficha.divida ?? {};
	const linhaFicha: ReactNode[] = [
		d.produto ? <span key="p">{d.produto}</span> : null,
		d.dias_atraso != null ? <span key="a">{d.dias_atraso} dias de atraso</span> : null,
		<span key="al">alçada: {textoAlcada(d.alcada).toLowerCase()}</span>,
	].filter(Boolean);
	return (
		<div className="fixed inset-0 z-[55] flex flex-col bg-[var(--base-fundo,var(--base-fill))] text-[var(--base-texto)]" role="region" aria-label="Sessão de treino por voz">
			<header className="flex flex-wrap items-center justify-between gap-2 border-b bg-[var(--base-cartao)] px-4 py-2.5" style={{ borderColor: 'var(--base-borda)' }}>
				<div className="min-w-0">
					<h1 tabIndex={-1} className="truncate text-[15px] font-semibold">{ficha.cenario}</h1>
					<p className="truncate text-[12.5px] text-[var(--base-texto-2)]">{sim}: {ficha.persona} · Treino por voz{quem === 'qualidade' ? ' · conduzido pela Qualidade' : ''}</p>
				</div>
				<div className="flex items-center gap-2">
					<span className="tnum rounded-lg bg-[var(--base-fill)] px-2 py-1 text-[13px] font-semibold" aria-label={`Tempo: ${relogio(segundos)} de ${relogio(limite)}`}>{relogio(segundos)} / {relogio(limite)}</span>
					<Botao tipo="secundario" pequeno onClick={onSair}>Sair</Botao>
				</div>
			</header>
			<div className="border-b bg-[var(--base-cartao)] px-4 py-2 text-[12.5px] text-[var(--base-texto-2)]" style={{ borderColor: 'var(--base-borda)' }}>
				<span className="font-semibold text-[var(--base-texto)]">Ficha fictícia:</span> {linhaFicha.reduce<ReactNode[]>((a, x, i) => (i ? [...a, ' · ', x] : [x]), [])}
				{ficha.foco.length > 0 && <span className="block truncate">Em foco: {ficha.foco.join(' · ')}</span>}
			</div>
			<div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
				<div className="mx-auto flex max-w-[760px] flex-col gap-2.5" role="log" aria-live="polite" aria-label="Transcrição ao vivo">
					{fase === 'conectando' && <p className="flex items-center gap-2 text-[13px] text-[var(--base-texto-2)]"><Loader2 size={14} className="animate-spin" aria-hidden="true" />Ligando para {ficha.persona}…</p>}
					{turnos.map((t, i) => (
						<div key={i} className={`max-w-[85%] rounded-2xl px-3.5 py-2 text-[14px] leading-relaxed ${t.quem === 'operador' ? 'self-end bg-[var(--destaque)] text-[var(--destaque-texto,#fff)]' : 'self-start bg-[var(--base-cartao)]'}`}
							style={t.quem === 'operador' ? undefined : { boxShadow: '0 0 0 1px var(--base-borda)' }}>
							<span className="sr-only">{t.quem === 'operador' ? 'Você: ' : `${ficha.persona}: `}</span>{t.texto}
						</div>
					))}
					{parcial && fase === 'ligacao' && <p className="self-end max-w-[85%] text-[13px] italic text-[var(--base-texto-3)]" aria-hidden="true">{parcial}…</p>}
					{aviso && <p className="self-center rounded-full bg-[var(--base-fill)] px-3 py-1 text-center text-[12.5px] text-[var(--base-texto-2)]">{aviso}</p>}
					<div ref={fimRef} />
				</div>
			</div>
			<footer className="sticky bottom-0 border-t bg-[var(--base-cartao)] px-4 pb-[max(12px,env(safe-area-inset-bottom))] pt-3" style={{ borderColor: 'var(--base-borda)' }}>
				<div className="mx-auto max-w-[760px] space-y-2">
					{erro && <div role="alert"><Aviso tom="erro">{erro}</Aviso></div>}
					{fase === 'avaliando' ? (
						<p className="flex items-center gap-2 text-[13.5px]" role="status"><Loader2 size={15} className="animate-spin" aria-hidden="true" />Avaliando a conversa pelo checklist… isso leva alguns segundos.</p>
					) : fase === 'ligacao' || fase === 'conectando' ? (
						<div className="flex items-center justify-between gap-2">
							<div className="flex min-w-0 items-center gap-2 text-[12.5px] text-[var(--base-texto-2)]" role="status">
								{fase === 'ligacao' ? <>
									<span className="inline-block h-2 w-2 shrink-0 rounded-full bg-[var(--estado-erro-texto,#c00)]" aria-hidden="true" />
									<span>{mudo ? 'Microfone mudo' : 'Ao vivo'}</span>
									{!mudo && <span className="h-1.5 w-16 overflow-hidden rounded-full bg-[var(--base-fill)]" aria-hidden="true"><span className="block h-full bg-[var(--destaque)]" style={{ width: `${Math.round(nv * 100)}%` }} /></span>}
								</> : <span>Conectando…</span>}
							</div>
							<div className="flex shrink-0 items-center gap-2">
								<Botao tipo="secundario" onClick={onMudo} disabled={fase !== 'ligacao'}>{mudo ? <><MicOff size={15} aria-hidden="true" />Ativar microfone</> : <><Mic size={15} aria-hidden="true" />Mudo</>}</Botao>
								<Botao tipo="perigo" onClick={onEncerrarLigacao} disabled={fase !== 'ligacao'}><PhoneOff size={15} aria-hidden="true" />Encerrar ligação</Botao>
							</div>
						</div>
					) : fase === 'encerrada' ? (
						<div className="flex flex-wrap items-center justify-between gap-2">
							<Pilula tom="info">Ligação encerrada</Pilula>
							<Botao onClick={onVerResultado}>{quem === 'operador' ? 'Ver meu resultado' : 'Ver o resultado'}{!resultadoPronto && <span className="sr-only"> (a avaliação está terminando)</span>}</Botao>
						</div>
					) : null}
					<small className="block text-[11.5px] text-[var(--base-texto-3)]">O áudio não é guardado. CPF, telefone e e-mail viram *** na transcrição.</small>
				</div>
			</footer>
		</div>
	);
}
