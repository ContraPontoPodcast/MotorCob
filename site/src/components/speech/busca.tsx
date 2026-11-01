// Speech Analytics › Busca. Semântica (pelo assunto) e por termo exato, só nas transcrições mascaradas e só dentro da
// retenção. Exige ver_transcricoes. Recusa CPF, telefone e e-mail no termo (aqui e no banco). Cada busca fica
// registrada (quem, termo, modo, hora, resultados) e aparece na Auditoria. A semântica fica "pendente" até a VM
// calcular o embedding da pergunta; a tela consulta de novo a cada 2 segundos.
// Redesign v2: entra por "Buscar nas conversas" no fim da barra de abas; modos com nomes simples (Pelo assunto,
// Palavra exata); privacidade e o Registro de buscas (Admin) ficam no selo "Privacidade da busca".
import { useEffect, useRef, useState } from 'react';
import { Play, Search } from 'lucide-react';
import { usePermissao } from '@/components/app-shell';
import { useMotorAuth } from '@/components/auth-provider';
import { supabase, friendlyError } from '@/lib/supabase';
import { AVISO_BUSCA, PERIODOS, PERM_SA, dataBR, dataHoraBR, dc, marcarTermo, termoProibido } from '@/lib/speech';
import { Aviso, BotaoLink, Botao, Cartao, Estado, SeloRegras, Segmentos, campoCls, campoStyle } from '@/components/ds';
import { Bloqueio, Trecho, type Filtros } from './comum';
import type { DefinirAcoes } from './speech-analytics';

type Res = { trecho_id: number; gravacao_id: number; id_cliente: string; credor: string | null; origem: string; falante: string; em: string; texto: string; similaridade: number | null };
type Resp = { busca_id: number; situacao: 'pendente' | 'pronta' | 'erro'; resultados: Res[] };
type Log = { termo: string; modo: string; quem: string; em: string; resultados: number };
const EXEMPLOS = ['boleto falso', 'pagar no dia do salário', 'procon', 'prefiro WhatsApp', 'comprovante'];

export function Busca({ f, setAcoes }: { f: Filtros; setAcoes: DefinirAcoes }) {
	useEffect(() => { setAcoes(null); }, [setAcoes]);
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

	if (!pode) return <Bloqueio titulo="Seu perfil não busca em transcrições." acao={<BotaoLink tipo="primario" to="/suporte/novo">Pedir acesso ao Admin</BotaoLink>}>A busca mostra trechos de conversas e exige a permissão Ver transcrições, a mesma de ler a transcrição em Gravações. Quem libera é o Admin, em Empresa › Privacidade e gravações.</Bloqueio>;
	const res = resp?.resultados ?? [];
	const selo = (
		<SeloRegras rotulo="Privacidade da busca" regras={[
			{ titulo: 'Cada busca fica registrada', texto: 'Seu nome, o termo, o modo e a hora; aparece na Auditoria.' },
			{ titulo: 'CPF, telefone e e-mail são recusados no termo', texto: 'Aqui e no banco.' },
			{ titulo: 'Só dentro da retenção (até 90 dias)', texto: 'Transcrições além do prazo já foram apagadas e não aparecem.' },
			{ titulo: 'Só trechos mascarados', texto: 'Exige a permissão Ver transcrições.' },
		]}>
			{admin && <div>
				<h3 className="mb-1 text-[13px] font-semibold">Registro de buscas <small className="font-normal text-[var(--base-texto-3)]">· visível para o Admin</small></h3>
				{log.length === 0 ? <p className="text-[13px] text-[var(--base-texto-2)]">Nenhuma busca ainda.</p> : log.map((l, i) => (
					<div key={i} className="flex items-start justify-between gap-3 border-b py-2 text-[13px] last:border-0" style={{ borderColor: 'var(--base-borda)' }}>
						<span className="min-w-0"><b className="block truncate">{l.termo}</b><small className="text-[var(--base-texto-3)]">{l.quem} · {l.modo === 'semantica' ? 'Pelo assunto' : 'Palavra exata'}</small></span>
						<small className="whitespace-nowrap text-[var(--base-texto-3)]">{dataHoraBR(l.em)} · {l.resultados} trechos</small>
					</div>
				))}
			</div>}
		</SeloRegras>
	);

	return (
		<div className="space-y-4">
			<Cartao>
				<form className="flex flex-col gap-2 lg:flex-row lg:items-center" onSubmit={e => { e.preventDefault(); void buscar(); }}>
					<label className="flex min-w-0 flex-1 items-center gap-2 rounded-lg border bg-[var(--base-cartao)] px-3" style={campoStyle}>
						<Search size={16} className="shrink-0 text-[var(--base-texto-3)]" aria-hidden="true" />
						<input aria-label="Buscar nas conversas" maxLength={120} value={q} onChange={e => setQ(e.target.value)} placeholder={modo === 'semantica' ? 'Descreva o assunto, ex.: quer pagar quando o salário cair' : 'Palavra ou frase exata, ex.: procon'} className="h-9 min-w-0 flex-1 bg-transparent text-[13px] outline-none" />
					</label>
					<div className="flex flex-wrap items-center gap-2">
						<Segmentos rotulo="Modo" itens={[{ v: 'semantica', n: 'Pelo assunto' }, { v: 'termo', n: 'Palavra exata' }]} valor={modo} onTrocar={setModo} />
						<select aria-label="Período" value={dias} onChange={e => setDias(Number(e.target.value))} className={campoCls} style={campoStyle}>{PERIODOS.map(p => <option key={p.d} value={p.d}>{p.d === 90 ? 'Até 90 dias (limite)' : p.n}</option>)}</select>
						<Botao type="submit" disabled={ocupado}>{ocupado ? 'Buscando…' : 'Buscar'}</Botao>
					</div>
				</form>
				{erro && <div className="mt-2"><Aviso tom="erro">{erro}</Aviso></div>}
				<div className="mt-3 flex flex-wrap items-center gap-2">
					{EXEMPLOS.map(e => <button key={e} type="button" onClick={() => { setQ(e); void buscar(e); }} className="rounded-full border px-3 py-1 text-[12.5px] text-[var(--base-texto-2)] hover:bg-[var(--base-fill)]" style={{ borderColor: 'var(--base-borda)' }}>{e}</button>)}
					<span className="ml-auto">{selo}</span>
				</div>
			</Cartao>
			<Cartao semPadding titulo="Resultados" linha={feita ? (ocupado ? `Buscando "${feita}"…` : `${res.length} ${res.length === 1 ? 'trecho' : 'trechos'} para "${feita}"`) : undefined}>
				{!feita ? <div className="px-4 pb-4 sm:px-5"><Estado tipo="vazio" compacto titulo="Faça uma busca.">"Pelo assunto" acha o tema mesmo com outras palavras ("dia do salário" acha "o INSS mudou a data do meu benefício"). "Palavra exata" acha só o termo.</Estado></div>
					: ocupado && res.length === 0 ? <div className="px-4 pb-4 sm:px-5"><Estado tipo="carregando" compacto titulo="Buscando…" /></div>
					: res.length === 0 ? <div className="px-4 pb-4 sm:px-5"><Estado tipo="vazio" compacto titulo="Nada encontrado.">{modo === 'termo' ? 'Tente "Pelo assunto".' : 'Tente outro período ou outras palavras.'}</Estado></div> : (
						<div className="divide-y [&>*]:border-[var(--base-borda)]">
							{res.map(r => (
								<div key={r.trecho_id} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-start sm:justify-between sm:px-5">
									<div className="min-w-0 flex-1">
										<div className="flex flex-wrap items-center gap-2 text-[12px] text-[var(--base-texto-2)]"><b className="text-[var(--base-texto)]">{r.id_cliente}</b><span>{dataBR(r.em)}</span><span>{r.origem === 'ia' ? 'Agente de IA' : 'Discador'}</span>{r.credor && <span>{r.credor}</span>}{r.similaridade != null && <span className="rounded-full bg-[var(--base-fill)] px-2">similaridade {dc(r.similaridade, 2)}</span>}</div>
										<Trecho>{modo === 'termo' ? marcarTermo(r.texto, feita).map(([t, m], i) => (m ? <mark key={i} className="rounded bg-[var(--estado-atencao-fundo)] px-0.5 text-[var(--base-texto)]">{t}</mark> : <span key={i}>{t}</span>)) : r.texto}</Trecho>
									</div>
									<BotaoLink pequeno to={`/gravacoes?cliente=${encodeURIComponent(r.id_cliente)}`}><Play size={13} aria-hidden="true" />Abrir em Gravações</BotaoLink>
								</div>
							))}
						</div>
					)}
			</Cartao>
		</div>
	);
}
