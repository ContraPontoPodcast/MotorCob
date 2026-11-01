// Speech Analytics › Alertas. Procon, advogado ou processo, ameaça, linguagem abusiva e vulnerabilidade.
// Alerta só avisa: nada pausa, muda régua ou bloqueia cliente. Vulnerabilidade mostra só o sinal (nunca o trecho; saúde
// sem detalhe nenhum). Exige ver_alertas; o trecho dos outros tipos exige também ver_transcricoes.
import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { toast } from 'sonner';
import { Heart, Play } from 'lucide-react';
import { Loading, Notice, usePermissao } from '@/components/app-shell';
import { supabase, friendlyError } from '@/lib/supabase';
import { ALERTA_TIPOS, DESFECHOS, PERM_SA, SINAIS, dataHoraBR, desfechosDe, nf, textoTemDadoPessoal } from '@/lib/speech';
import { Aviso, Botao, Cartao, Pilula, campoCls, campoStyle } from '@/components/voz/ui';
import { BarraFiltros, Bloqueio, Modal, Segmentos, Trecho, textareaCls, type Filtros } from './comum';

type Alerta = { id: number; tipo: string; sinal: string | null; falante: string | null; origem: string; operador: string | null; id_cliente: string | null; gravacao_id: number | null; credor_id: number | null; criado_em: string; trecho: string | null; situacao: 'novo' | 'revisado'; revisado_por: string | null; revisado_em: string | null; desfecho: string | null; observacao: string | null };
type Contagem = { tipo: string; total: number; abertos: number };
const FALANTE: Record<string, string> = { cliente: 'cliente', agente: 'agente de IA', operador: 'operador' };

export function Alertas({ f, setDias }: { f: Filtros; setDias: (d: number) => void }) {
	const pode = usePermissao(PERM_SA.verAlertas);
	const [tipo, setTipo] = useState('');
	const [sit, setSit] = useState<'novo' | 'revisado' | ''>('novo');
	const [lista, setLista] = useState<Alerta[]>([]);
	const [cont, setCont] = useState<Contagem[]>([]);
	const [erro, setErro] = useState('');
	const [loading, setLoading] = useState(true);
	const [rev, setRev] = useState<Alerta | null>(null);
	const [desf, setDesf] = useState('tratado');
	const [obs, setObs] = useState('');
	const [ocupado, setOcupado] = useState(false);
	const [recarga, setRecarga] = useState(0);

	useEffect(() => {
		if (!supabase || !pode) { setLoading(false); return; }
		const sb = supabase;
		let ativo = true;
		setLoading(true); setErro('');
		(async () => {
			const [l, c] = await Promise.all([
				sb.rpc('alertas_voz', { empresa: f.empresaId, filtro_tipo: tipo || null, filtro_situacao: sit || null, de: f.de, ate: f.ate, limite: 100 }),
				sb.rpc('contagem_alertas_voz', { empresa: f.empresaId, de: f.de, ate: f.ate }),
			]);
			if (!ativo) return;
			if (l.error) { setErro(friendlyError(l.error)); setLoading(false); return; }
			setLista(((l.data ?? []) as Alerta[]).filter(a => f.credorId == null || a.credor_id === f.credorId));
			setCont((c.data ?? []) as Contagem[]);
			setLoading(false);
		})();
		return () => { ativo = false; };
	}, [pode, f.empresaId, f.credorId, f.de, f.ate, tipo, sit, recarga]);

	async function revisar() {
		if (!supabase || !rev) return;
		setOcupado(true);
		const { error } = await supabase.rpc('revisar_alerta_voz', { alerta: rev.id, desfecho: desf, observacao: obs.trim() || null });
		setOcupado(false);
		if (error) { toast.error(friendlyError(error)); return; }
		toast.success('Alerta marcado como revisado.');
		setRev(null); setObs(''); setRecarga(x => x + 1);
	}

	const filtros = <BarraFiltros dias={f.dias} setDias={setDias} origem="" setOrigem={() => {}} credorNome={f.credorNome} semOrigem />;
	if (!pode) return <Bloqueio titulo="Seu perfil não vê os alertas das ligações.">A fila mostra situações sensíveis (Procon, jurídico, ameaça, vulnerabilidade) e exige a permissão ver_alertas. Quem libera é o Admin, em Empresa › Pessoas e perfis.</Bloqueio>;
	const total = cont.reduce((t, c) => t + Number(c.total), 0);
	const abertos = cont.reduce((t, c) => t + Number(c.abertos), 0);

	return (
		<>
			{filtros}
			<div className="space-y-4">
				<Aviso tom="info" titulo="Alerta só avisa.">Nenhum alerta pausa, muda régua ou bloqueia cliente sozinho. Quem revisa decide o que fazer, e o nome e a hora de quem revisou ficam registrados.</Aviso>
				<div className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-6">
					{[['', 'Todos', total, `${nf(abertos)} abertos`], ...Object.entries(ALERTA_TIPOS).map(([k, n]) => { const c = cont.find(x => x.tipo === k); return [k, n, Number(c?.total ?? 0), k === 'vulnerabilidade' ? 'só sinalização' : `${nf(c?.abertos ?? 0)} abertos`]; })].map(([k, n, v, s]) => (
						<button key={String(k)} type="button" aria-pressed={tipo === k} onClick={() => setTipo(String(k))} className="rounded-2xl bg-[var(--base-cartao)] p-3 text-left" style={{ boxShadow: `0 0 0 ${tipo === k ? 2 : 1}px ${tipo === k ? 'var(--destaque)' : 'var(--base-borda)'}` }}>
							<span className="block text-[12px] font-medium text-[var(--base-texto-3)]">{n}</span>
							<b className="block text-[20px] tnum">{nf(v)}</b>
							<small className="text-[11.5px] text-[var(--base-texto-3)]">{s}</small>
						</button>
					))}
				</div>
				<Cartao semPadding titulo="Fila" linha={`${lista.length} ${lista.length === 1 ? 'alerta' : 'alertas'}`} direita={<Segmentos rotulo="Situação" itens={[{ v: 'novo', n: 'Abertos' }, { v: 'revisado', n: 'Revisados' }, { v: '', n: 'Todos' }]} valor={sit} onTrocar={setSit} />}>
					{erro ? <div className="px-4 pb-4"><Notice>{erro}</Notice></div> : loading ? <div className="px-4 pb-4"><Loading /></div> : lista.length === 0 ? <p className="px-4 pb-4 text-[13px] text-[var(--base-texto-2)] sm:px-5">Nada nesta fila.</p> : (
						<div className="divide-y" style={{ borderColor: 'var(--base-borda)' }}>
							{lista.map(a => (
								<div key={a.id} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-start sm:justify-between sm:px-5" style={{ borderColor: 'var(--base-borda)' }}>
									<div className="min-w-0 flex-1">
										<div className="flex flex-wrap items-center gap-2 text-[12px] text-[var(--base-texto-2)]">
											<b className="text-[var(--base-texto)]">AL-{a.id}</b>
											<Pilula tom={a.tipo === 'vulnerabilidade' ? 'neutro' : 'erro'}>{ALERTA_TIPOS[a.tipo] ?? a.tipo}</Pilula>
											{a.id_cliente && <span>{a.id_cliente}</span>}
											<span>{a.origem === 'ia' ? 'Agente de IA' : 'Discador'}</span>
											<span>{dataHoraBR(a.criado_em)}</span>
										</div>
										{a.tipo === 'vulnerabilidade' ? (
											<div className="mt-1.5 flex items-start gap-2 rounded-lg bg-[var(--base-fill)] px-3 py-2 text-[13px] text-[var(--base-texto-2)]"><Heart size={15} className="mt-0.5 shrink-0" /><span><b className="text-[var(--base-texto)]">Sinal: {SINAIS[a.sinal ?? ''] ?? a.sinal}.</b> O trecho não aparece aqui{a.sinal === 'saude' ? ' e nenhum detalhe de saúde é guardado' : ''}. Se precisar, ouça a gravação (o acesso fica registrado). Nada foi pausado: se quiser mudar algo para este cliente, faça no Extrato.</span></div>
										) : (
											<>{a.trecho ? <Trecho>{a.trecho}</Trecho> : <p className="mt-1.5 text-[12px] text-[var(--base-texto-3)]">{a.id_cliente ? 'O trecho exige a permissão ver_transcricoes.' : 'Trecho apagado com a gravação: o alerta fica só como contagem.'}</p>}
												{a.falante && <p className="mt-1 text-[12px] text-[var(--base-texto-3)]">Quem falou: {FALANTE[a.falante] ?? a.falante}{a.operador ? ` (${a.operador})` : ''}</p>}</>
										)}
										{a.situacao === 'revisado' && <p className="mt-1.5 text-[12px] text-[var(--estado-pronto-texto)]">Revisado por <b>{a.revisado_por}</b> em {dataHoraBR(a.revisado_em)} · {DESFECHOS[a.desfecho ?? ''] ?? a.desfecho}{a.observacao ? ` · "${a.observacao}"` : ''}</p>}
									</div>
									<div className="flex shrink-0 flex-wrap gap-2">
										{a.situacao === 'novo' ? <Botao onClick={() => { setRev(a); setDesf('tratado'); setObs(''); }}>Marcar como revisado</Botao> : <Pilula tom="ok">Revisado</Pilula>}
										{a.id_cliente && <Link to={`/gravacoes?cliente=${encodeURIComponent(a.id_cliente)}`} className="inline-flex h-9 items-center gap-1.5 rounded-lg border px-3 text-[13px] font-semibold" style={{ borderColor: 'var(--base-borda)' }}><Play size={14} />Ouvir</Link>}
										{a.id_cliente && <Link to={`/cliente?id=${encodeURIComponent(a.id_cliente)}`} className="inline-flex h-9 items-center rounded-lg border px-3 text-[13px] font-semibold" style={{ borderColor: 'var(--base-borda)' }}>Extrato</Link>}
									</div>
								</div>
							))}
						</div>
					)}
					<p className="border-t px-4 py-3 text-[12px] text-[var(--base-texto-3)] sm:px-5" style={{ borderColor: 'var(--base-borda)' }}>Mostrando os mais recentes. O trecho é apagado junto com a gravação (90 dias ou a retenção da empresa); o alerta fica como contagem.</p>
				</Cartao>
			</div>
			{rev && (
				<Modal titulo={`Revisar AL-${rev.id}`} texto="Fica registrado quem revisou e quando. Não escreva nome, CPF, telefone nem detalhe de saúde na observação." confirmar="Marcar como revisado" ocupado={ocupado} desabilitado={textoTemDadoPessoal(obs)} onFechar={() => setRev(null)} onConfirmar={() => void revisar()}>
					<select aria-label="Desfecho" value={desf} onChange={e => setDesf(e.target.value)} className={`${campoCls} w-full`} style={campoStyle}>{desfechosDe(rev.tipo).map(d => <option key={d} value={d}>{DESFECHOS[d]}</option>)}</select>
					<textarea aria-label="Observação" maxLength={200} rows={3} value={obs} onChange={e => setObs(e.target.value)} placeholder="Observação (opcional, até 200 caracteres)" className={textareaCls} style={campoStyle} />
					{textoTemDadoPessoal(obs) && <p className="text-[12px] text-[var(--estado-erro-texto)]">Tire o CPF, telefone ou e-mail da observação.</p>}
				</Modal>
			)}
		</>
	);
}
