// Speech Analytics › Busca. Semântica (pelo assunto) e por termo exato, só nas transcrições mascaradas e só dentro da
// retenção. Exige ver_transcricoes. Recusa CPF, telefone e e-mail no termo (aqui e no banco). Cada busca fica
// registrada (quem, termo, modo, hora, resultados) e aparece na Auditoria. A semântica fica "pendente" até a VM
// calcular o embedding da pergunta; a tela consulta de novo a cada 2 segundos.
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { Play, Search, ShieldCheck } from 'lucide-react';
import { usePermissao } from '@/components/app-shell';
import { useMotorAuth } from '@/components/auth-provider';
import { supabase, friendlyError } from '@/lib/supabase';
import { AVISO_BUSCA, PERIODOS, PERM_SA, dataBR, dataHoraBR, dc, marcarTermo, termoProibido } from '@/lib/speech';
import { Botao, Cartao, campoCls, campoStyle } from '@/components/voz/ui';
import { Bloqueio, Segmentos, Trecho, type Filtros } from './comum';

type Res = { trecho_id: number; gravacao_id: number; id_cliente: string; credor: string | null; origem: string; falante: string; em: string; texto: string; similaridade: number | null };
type Resp = { busca_id: number; situacao: 'pendente' | 'pronta' | 'erro'; resultados: Res[] };
type Log = { termo: string; modo: string; quem: string; em: string; resultados: number };
const EXEMPLOS = ['boleto falso', 'pagar no dia do salário', 'procon', 'prefiro WhatsApp', 'comprovante'];

export function Busca({ f }: { f: Filtros }) {
	const { perfil } = useMotorAuth();
	const pode = usePermissao(PERM_SA.verTranscricoes);
	const admin = perfil?.papel === 'admin' && !perfil?.equipe;
	const [q, setQ] = useState('');
	const [modo, setModo] = useState<'semantica' | 'termo'>('semantica');
	const [dias, setDias] = useState(30);
	const [resp, setResp] = useState<Resp | null>(null);
	const [feita, setFeita] = useState('');
	const [erro, setErro] = useState('');
	const [ocupado, setOcupado] = useState(false);
	const [log, setLog] = useState<Log[]>([]);
	const timer = useRef<number | null>(null);

	const carregarLog = () => {
		if (!supabase || !admin) return;
		void supabase.rpc('buscas_recentes_voz', { empresa: f.empresaId, limite: 6 }).then(({ data }) => setLog((data ?? []) as Log[]));
	};
	useEffect(carregarLog, [admin, f.empresaId]);
	useEffect(() => () => { if (timer.current) window.clearTimeout(timer.current); }, []);

	function esperar(id: number, tentativa = 0) {
		if (!supabase) return;
		timer.current = window.setTimeout(async () => {
			const { data, error } = await supabase!.rpc('resultado_busca_voz', { busca: id });
			if (error) { setErro(friendlyError(error)); setOcupado(false); return; }
			const r = data as Resp;
			if (r.situacao === 'pendente' && tentativa < 30) { esperar(id, tentativa + 1); return; }
			if (r.situacao !== 'pronta') setErro('A busca semântica não respondeu a tempo. Tente de novo ou use o termo exato.');
			setResp(r); setOcupado(false); carregarLog();
		}, 2000);
	}

	async function buscar(termo = q) {
		const t = termo.trim();
		setErro('');
		if (!t) return;
		if (termoProibido(t)) { setErro(AVISO_BUSCA); setResp(null); setFeita(''); return; }
		if (!supabase) return;
		if (timer.current) window.clearTimeout(timer.current);
		setOcupado(true); setFeita(t); setResp(null);
		const de = new Date(Date.now() - (dias - 1) * 86400000).toISOString().slice(0, 10);
		const { data, error } = await supabase.rpc('buscar_trechos_voz', { empresa: f.empresaId, q: t, modo, de, ate: f.ate, credor: f.credorId, origem: null });
		if (error) { setErro(friendlyError(error)); setOcupado(false); return; }
		const r = data as Resp;
		if (r.situacao === 'pendente') { esperar(r.busca_id); return; }
		setResp(r); setOcupado(false); carregarLog();
	}

	if (!pode) return <Bloqueio titulo="Seu perfil não busca em transcrições." acao={<Link to="/suporte/novo" className="inline-flex h-9 items-center rounded-lg px-4 text-[13px] font-semibold text-[var(--destaque-texto)]" style={{ backgroundColor: 'var(--destaque)' }}>Pedir acesso ao Admin</Link>}>A busca mostra trechos de conversas e exige a permissão ver_transcricoes, a mesma de ler a transcrição em Gravações. Quem libera é o Admin, em Empresa › Privacidade e gravações.</Bloqueio>;
	const res = resp?.resultados ?? [];

	return (
		<div className="space-y-4">
			<Cartao>
				<form className="flex flex-col gap-2 lg:flex-row lg:items-center" onSubmit={e => { e.preventDefault(); void buscar(); }}>
					<label className="flex min-w-0 flex-1 items-center gap-2 rounded-lg border bg-[var(--base-cartao)] px-3" style={campoStyle}>
						<Search size={16} className="shrink-0 text-[var(--base-texto-3)]" />
						<input aria-label="Buscar" maxLength={120} value={q} onChange={e => setQ(e.target.value)} placeholder={modo === 'semantica' ? 'Descreva o assunto, ex.: quer pagar quando o salário cair' : 'Palavra ou frase exata, ex.: procon'} className="h-9 min-w-0 flex-1 bg-transparent text-[13px] outline-none" />
					</label>
					<Segmentos rotulo="Modo" itens={[{ v: 'semantica', n: 'Semântica' }, { v: 'termo', n: 'Termo exato' }]} valor={modo} onTrocar={setModo} />
					<select aria-label="Período" value={dias} onChange={e => setDias(Number(e.target.value))} className={campoCls} style={campoStyle}>{PERIODOS.map(p => <option key={p.d} value={p.d}>{p.d === 90 ? 'Até 90 dias (limite)' : p.n}</option>)}</select>
					<Botao type="submit" disabled={ocupado}>{ocupado ? 'Buscando…' : 'Buscar'}</Botao>
				</form>
				{erro && <p role="alert" className="mt-2 rounded-lg px-3 py-2 text-[13px]" style={{ backgroundColor: 'var(--estado-erro-fundo)', color: 'var(--estado-erro-texto)' }}>{erro}</p>}
				<div className="mt-3 flex flex-wrap gap-2">{EXEMPLOS.map(e => <button key={e} type="button" onClick={() => { setQ(e); void buscar(e); }} className="rounded-full border px-3 py-1 text-[12.5px] text-[var(--base-texto-2)] hover:bg-[var(--base-fill)]" style={{ borderColor: 'var(--base-borda)' }}>{e}</button>)}</div>
				<p className="mt-3 flex items-start gap-1.5 text-[12px] text-[var(--base-texto-3)]"><ShieldCheck size={14} className="mt-0.5 shrink-0" />Cada busca fica registrada com seu nome, o termo e a hora, e aparece na Auditoria. Transcrições além da retenção já foram apagadas e não aparecem.</p>
			</Cartao>
			<div className={`grid gap-4 ${admin ? 'lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]' : ''}`}>
				<Cartao semPadding titulo="Resultados" linha={feita ? (ocupado ? `Buscando "${feita}"…` : `${res.length} ${res.length === 1 ? 'trecho' : 'trechos'} para "${feita}"`) : 'Faça uma busca'}>
					{!feita ? <p className="px-4 pb-4 text-[13px] text-[var(--base-texto-2)] sm:px-5">A busca semântica acha o assunto mesmo com outras palavras ("dia do salário" acha "o INSS mudou a data do meu benefício"). A de termo acha a palavra exata.</p>
						: !ocupado && res.length === 0 ? <p className="px-4 pb-4 text-[13px] text-[var(--base-texto-2)] sm:px-5">Nada encontrado {modo === 'termo' ? 'com esse termo exato. Tente a busca semântica.' : 'nesse período.'}</p> : (
							<div className="divide-y" style={{ borderColor: 'var(--base-borda)' }}>
								{res.map(r => (
									<div key={r.trecho_id} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-start sm:justify-between sm:px-5" style={{ borderColor: 'var(--base-borda)' }}>
										<div className="min-w-0 flex-1">
											<div className="flex flex-wrap items-center gap-2 text-[12px] text-[var(--base-texto-2)]"><b className="text-[var(--base-texto)]">{r.id_cliente}</b><span>{dataBR(r.em)}</span><span>{r.origem === 'ia' ? 'Agente de IA' : 'Discador'}</span>{r.credor && <span>{r.credor}</span>}{r.similaridade != null && <span className="rounded-full bg-[var(--base-fill)] px-2">similaridade {dc(r.similaridade, 2)}</span>}</div>
											<Trecho>{modo === 'termo' ? marcarTermo(r.texto, feita).map(([t, m], i) => (m ? <mark key={i} className="rounded bg-[var(--estado-atencao-fundo)] px-0.5 text-[var(--base-texto)]">{t}</mark> : <span key={i}>{t}</span>)) : r.texto}</Trecho>
										</div>
										<Link to={`/gravacoes?cliente=${encodeURIComponent(r.id_cliente)}`} className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg border px-3 text-[13px] font-semibold" style={{ borderColor: 'var(--base-borda)' }}><Play size={14} />Abrir em Gravações</Link>
									</div>
								))}
							</div>
						)}
				</Cartao>
				{admin && <Cartao titulo="Registro de buscas" linha="Visível para o Admin">
					{log.length === 0 ? <p className="text-[13px] text-[var(--base-texto-2)]">Nenhuma busca ainda.</p> : log.map((l, i) => (
						<div key={i} className="flex items-start justify-between gap-3 border-b py-2 text-[13px] last:border-0" style={{ borderColor: 'var(--base-borda)' }}>
							<span className="min-w-0"><b className="block truncate">{l.termo}</b><small className="text-[var(--base-texto-3)]">{l.quem} · {l.modo === 'semantica' ? 'Semântica' : 'Termo'}</small></span>
							<small className="whitespace-nowrap text-[var(--base-texto-3)]">{dataHoraBR(l.em)} · {l.resultados} trechos</small>
						</div>
					))}
				</Cartao>}
			</div>
		</div>
	);
}
