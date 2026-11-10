// Sessão de treino por TEXTO em tela cheia (sem menu): o operador conversa com o cliente simulado (Edge Function
// `treino` → simulador da VM, SQL 100). Serve ao operador pelo link e à Qualidade (treino lado a lado e teste do cenário).
// Sair, por qualquer caminho (botão "Sair", "Encerrar ligação", ⟵ do navegador ou link interno), pede confirmação:
// "Continuar treinando", "Encerrar e ver a nota" ou "Sair sem contar" (tentativa abandonada não conta). Recarregar ou
// fechar a aba usa o aviso do navegador. Quando o cliente desliga ou o tempo acaba, a caixa de texto dá lugar ao
// botão principal "Ver meu resultado"; "Encerrar ligação" (vermelho) só aparece com a ligação ativa.
// A fala do operador volta mascarada da VM (CPF, telefone, e-mail, nome dito) e é essa que aparece e fica guardada.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useBlocker } from 'react-router';
import { Loader2, Send } from 'lucide-react';
import { Aviso, Botao, Modal, Pilula, textareaCls, campoStyle } from '@/components/ds';
import { textoAlcada, type DividaRP } from '@/lib/roleplay';
import { relogio, type RespostaEncerrar, type RespostaTurno, type Turno } from '@/lib/treino-sessao';

export type ResultadoChamada<T> = { data?: T; erro?: string; status?: number | null };
export type Chamar = {
	turno: (texto?: string) => Promise<ResultadoChamada<RespostaTurno>>;
	encerrar: () => Promise<ResultadoChamada<RespostaEncerrar>>;
	sair: () => Promise<ResultadoChamada<{ situacao: string }>>;
};
export type FichaSessao = { cenario: string; persona: string; divida: DividaRP; foco: string[]; objetivo?: string | null; duracao?: number };
type Fase = 'carregando' | 'ligacao' | 'desligou' | 'tempo' | 'avaliando' | 'terminou';

export function SessaoTexto({ ficha, chamar, onFim, quem = 'operador' }: {
	ficha: FichaSessao; chamar: Chamar; onFim: (r: RespostaEncerrar) => void;
	/** "operador": textos para quem treina; "qualidade": treino lado a lado ou teste (a mesma tela). */
	quem?: 'operador' | 'qualidade';
}) {
	const [fase, setFase] = useState<Fase>('carregando');
	const [turnos, setTurnos] = useState<Turno[]>([]);
	const [texto, setTexto] = useState('');
	const [enviando, setEnviando] = useState(false);
	const [erro, setErro] = useState('');
	const [saldo, setSaldo] = useState<string | null>(null);
	const [seg, setSeg] = useState(0);
	const [dur, setDur] = useState(480);
	const [confirmar, setConfirmar] = useState(false);
	const inicioLocal = useRef(Date.now());
	const ativa = fase === 'ligacao' || fase === 'desligou' || fase === 'tempo';

	const blocker = useBlocker(() => ativa);
	useEffect(() => { if (blocker.state === 'blocked') setConfirmar(true); }, [blocker.state]);
	useEffect(() => {
		if (!ativa) return;
		const aviso = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
		window.addEventListener('beforeunload', aviso);
		return () => window.removeEventListener('beforeunload', aviso);
	}, [ativa]);
	useEffect(() => {
		if (fase !== 'ligacao') return;
		const t = setInterval(() => setSeg(s => s + 1), 1000);
		return () => clearInterval(t);
	}, [fase]);
	useEffect(() => { if (fase === 'ligacao' && seg >= dur) setFase('tempo'); }, [seg, dur, fase]);

	// Começa (ou retoma) a ligação: sem conversa, o cliente atende; com conversa, ela volta para a tela.
	useEffect(() => {
		let ativo = true;
		void chamar.turno().then(r => {
			if (!ativo) return;
			if (r.erro || !r.data) { setErro(r.erro ?? 'Não deu para começar agora.'); setFase(r.status === 409 ? 'terminou' : 'ligacao'); return; }
			aplicar(r.data, true);
		});
		return () => { ativo = false; };
	}, []);   // uma vez por sessão: retomar não reinicia a ligação

	function aplicar(d: RespostaTurno, inicio = false) {
		if (typeof d.duracao_max_s === 'number') setDur(d.duracao_max_s);
		if (typeof d.segundos === 'number' && inicio) { setSeg(d.segundos); inicioLocal.current = Date.now() - d.segundos * 1000; }
		if (d.saldo) setSaldo(d.saldo);
		if (d.turnos) setTurnos(d.turnos);
		else if (d.fala) setTurnos(t => [...t, ...(d.operador ? [{ quem: 'operador' as const, texto: d.operador }] : []), { quem: 'persona' as const, texto: d.fala! }]);
		setFase(d.fim === 'tempo' || d.fim === 'limite' ? 'tempo' : d.desligou ? 'desligou' : 'ligacao');
	}

	async function enviar() {
		const t = texto.trim();
		if (!t || enviando || fase !== 'ligacao') return;
		setEnviando(true); setErro('');
		const r = await chamar.turno(t);
		setEnviando(false);
		if (r.erro || !r.data) { setErro(r.erro ?? 'O cliente simulado não respondeu agora. Tente de novo.'); if (r.status === 409) setFase('terminou'); return; }
		setTexto('');
		aplicar(r.data);
	}

	async function encerrar() {
		setConfirmar(false);
		if (blocker.state === 'blocked') blocker.reset();
		setFase('avaliando'); setErro('');
		const r = await chamar.encerrar();
		if (r.erro || !r.data) { setErro(r.erro ?? 'Não deu para avaliar agora.'); setFase(r.status === 409 ? 'terminou' : 'desligou'); return; }
		setFase('terminou');
		onFim(r.data);
	}

	async function sair() {
		setConfirmar(false);
		setFase('terminou');
		await chamar.sair();
		if (blocker.state === 'blocked') blocker.proceed();
		else onFim({ situacao: 'abandonada' });
	}

	return (
		<>
			<SessaoView ficha={ficha} turnos={turnos} fase={fase} segundos={seg} duracao={dur} saldo={saldo} texto={texto} enviando={enviando} erro={erro} quem={quem}
				onTexto={setTexto} onEnviar={() => void enviar()} onEncerrarLigacao={() => setConfirmar(true)} onVerResultado={() => void encerrar()} onSair={() => setConfirmar(true)} />
			{confirmar && (
				<Modal titulo={fase === 'ligacao' ? 'Encerrar a ligação?' : 'Sair do treino?'}
					texto="Se encerrar, a conversa é avaliada pelo checklist e conta como tentativa. Se sair sem contar, nada é avaliado e a tentativa não conta."
					onFechar={() => { setConfirmar(false); if (blocker.state === 'blocked') blocker.reset(); }}
					acoes={<>
						<Botao tipo="secundario" onClick={() => { setConfirmar(false); if (blocker.state === 'blocked') blocker.reset(); }}>Continuar treinando</Botao>
						<Botao tipo="secundario" onClick={() => void sair()}>Sair sem contar</Botao>
						<Botao onClick={() => void encerrar()}>Encerrar e ver a nota</Botao>
					</>} />
			)}
		</>
	);
}

/** A tela da sessão (sem rede e sem roteador de dados: é o que os testes renderizam). */
export function SessaoView({ ficha, turnos, fase, segundos, duracao, saldo, texto, enviando, erro, quem, onTexto, onEnviar, onEncerrarLigacao, onVerResultado, onSair }: {
	ficha: FichaSessao; turnos: Turno[]; fase: Fase; segundos: number; duracao: number; saldo: string | null; texto: string; enviando: boolean; erro: string;
	quem: 'operador' | 'qualidade'; onTexto: (t: string) => void; onEnviar: () => void; onEncerrarLigacao: () => void; onVerResultado: () => void; onSair: () => void;
}) {
	const fim = useRef<HTMLDivElement>(null);
	useEffect(() => { fim.current?.scrollIntoView?.({ block: 'end' }); }, [turnos.length, fase]);
	const sim = /fictícia/.test(ficha.persona) ? 'Cliente simulada' : 'Cliente simulado';
	const resta = Math.max(0, duracao - segundos);
	const d = ficha.divida ?? {};
	const linhaFicha: ReactNode[] = [
		d.produto ? <span key="p">{d.produto}</span> : null,
		d.dias_atraso != null ? <span key="a">{d.dias_atraso} dias de atraso</span> : null,
		saldo ? <span key="s">saldo {saldo}</span> : null,
		<span key="al">alçada: {textoAlcada(d.alcada).toLowerCase()}</span>,
	].filter(Boolean);
	return (
		<div className="fixed inset-0 z-[55] flex flex-col bg-[var(--base-fundo,var(--base-fill))] text-[var(--base-texto)]" role="region" aria-label="Sessão de treino">
			<header className="flex flex-wrap items-center justify-between gap-2 border-b bg-[var(--base-cartao)] px-4 py-2.5" style={{ borderColor: 'var(--base-borda)' }}>
				<div className="min-w-0">
					<h1 tabIndex={-1} className="truncate text-[15px] font-semibold">{ficha.cenario}</h1>
					<p className="truncate text-[12.5px] text-[var(--base-texto-2)]">{sim}: {ficha.persona} · Treino por texto{quem === 'qualidade' ? ' · conduzido pela Qualidade' : ''}</p>
				</div>
				<div className="flex items-center gap-2">
					<span className="tnum rounded-lg bg-[var(--base-fill)] px-2 py-1 text-[13px] font-semibold" aria-label={`Tempo: ${relogio(segundos)} de ${relogio(duracao)}`} title={`Resta ${relogio(resta)}`}>{relogio(segundos)} / {relogio(duracao)}</span>
					<Botao tipo="secundario" pequeno onClick={onSair}>Sair</Botao>
				</div>
			</header>
			<div className="border-b bg-[var(--base-cartao)] px-4 py-2 text-[12.5px] text-[var(--base-texto-2)]" style={{ borderColor: 'var(--base-borda)' }}>
				<span className="font-semibold text-[var(--base-texto)]">Ficha fictícia:</span> {linhaFicha.reduce<ReactNode[]>((a, x, i) => (i ? [...a, ' · ', x] : [x]), [])}
				{ficha.foco.length > 0 && <span className="block truncate">Em foco: {ficha.foco.join(' · ')}</span>}
			</div>
			<div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
				<div className="mx-auto flex max-w-[760px] flex-col gap-2.5" role="log" aria-live="polite" aria-label="Conversa">
					{fase === 'carregando' && <p className="flex items-center gap-2 text-[13px] text-[var(--base-texto-2)]"><Loader2 size={14} className="animate-spin" aria-hidden="true" />Ligando para {ficha.persona}…</p>}
					{turnos.map((t, i) => (
						<div key={i} className={`max-w-[85%] rounded-2xl px-3.5 py-2 text-[14px] leading-relaxed ${t.quem === 'operador' ? 'self-end bg-[var(--destaque)] text-[var(--destaque-texto,#fff)]' : 'self-start bg-[var(--base-cartao)]'}`}
							style={t.quem === 'operador' ? undefined : { boxShadow: '0 0 0 1px var(--base-borda)' }}>
							<span className="sr-only">{t.quem === 'operador' ? 'Você: ' : `${ficha.persona}: `}</span>{t.texto}
						</div>
					))}
					{enviando && <p className="self-start text-[12.5px] text-[var(--base-texto-3)]">{ficha.persona} está respondendo…</p>}
					{fase === 'desligou' && <p className="self-center rounded-full bg-[var(--base-fill)] px-3 py-1 text-[12.5px] text-[var(--base-texto-2)]">{sim === 'Cliente simulada' ? 'A cliente desligou.' : 'O cliente desligou.'}</p>}
					{fase === 'tempo' && <p className="self-center rounded-full bg-[var(--base-fill)] px-3 py-1 text-[12.5px] text-[var(--base-texto-2)]">O tempo da ligação acabou.</p>}
					<div ref={fim} />
				</div>
			</div>
			<footer className="border-t bg-[var(--base-cartao)] px-4 py-3" style={{ borderColor: 'var(--base-borda)' }}>
				<div className="mx-auto max-w-[760px] space-y-2">
					{erro && <div role="alert"><Aviso tom="erro">{erro}</Aviso></div>}
					{fase === 'avaliando' ? (
						<p className="flex items-center gap-2 text-[13.5px]" role="status"><Loader2 size={15} className="animate-spin" aria-hidden="true" />Avaliando a conversa pelo checklist… isso leva alguns segundos.</p>
					) : fase === 'ligacao' || fase === 'carregando' ? (
						<>
							<div className="flex items-end gap-2">
								<label className="sr-only" htmlFor="fala-treino">Sua fala</label>
								<textarea id="fala-treino" rows={2} maxLength={600} value={texto} disabled={fase !== 'ligacao' || enviando} placeholder="Escreva o que você diria na ligação"
									onChange={e => onTexto(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); onEnviar(); } }}
									className={`${textareaCls} min-h-[44px] flex-1 resize-none`} style={campoStyle} />
								<Botao onClick={onEnviar} disabled={!texto.trim() || enviando || fase !== 'ligacao'}><Send size={14} aria-hidden="true" />Enviar</Botao>
							</div>
							<div className="flex flex-wrap items-center justify-between gap-2">
								<small className="text-[11.5px] text-[var(--base-texto-3)]">Enter envia · Shift+Enter quebra a linha · CPF, telefone e e-mail viram *** na conversa</small>
								<Botao tipo="perigo" pequeno onClick={onEncerrarLigacao} disabled={fase !== 'ligacao'}>Encerrar ligação</Botao>
							</div>
						</>
					) : fase === 'desligou' || fase === 'tempo' ? (
						<div className="flex flex-wrap items-center justify-between gap-2">
							<Pilula tom="info">{fase === 'tempo' ? 'Tempo esgotado' : 'Ligação encerrada'}</Pilula>
							<Botao onClick={onVerResultado}>{quem === 'operador' ? 'Ver meu resultado' : 'Ver o resultado'}</Botao>
						</div>
					) : null}
				</div>
			</footer>
		</div>
	);
}
