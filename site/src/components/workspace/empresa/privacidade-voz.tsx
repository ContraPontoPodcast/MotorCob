// Empresa › Privacidade e gravações (Admin da empresa). Protótipo aprovado, tela 7; Decisões do dono 3a, 3c, 4a e 4b.
// Retenção (mínimo e padrão 90 dias, sem teto), aviso de gravação (desligado por padrão), transcrição a partir de
// N segundos (padrão 5), quem ouve e quem lê (as mesmas permissões de Pessoas e perfis) e pedidos do titular,
// abertos só pelo ID do cliente. Escreve por configurar_voz_empresa e abrir_pedido_titular (SQL 56).
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router';
import { Download, Plus, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import { useMotorAuth } from '@/components/auth-provider';
import { SemPermissao } from '@/components/role-gate';
import { Chave } from '@/components/workspace/console/chave';
import { supabase, friendlyError, dateBR, dateTimeBR, logAccess, today, type Row } from '@/lib/supabase';
import { PERFIS_INFO } from '@/lib/perfis-info';
import { idClienteValido, inteiro } from '@/lib/voz';
import {
	Aviso, Cadeado, Campo, Cartao, Dialogo, Pilula, Subtitulo, TabelaRolavel, Trava, Vazio, btnLink, btnPrim, btnSec, campoCls, tdCls, thCls,
} from '@/components/comuns/voz-ui';
import { EmpresaShell } from './empresa-shell';

const PADRAO = { retencao_dias: 90, aviso_gravacao: false, transcrever_min_segundos: 5 };
const PERMS_VOZ = [
	{ codigo: 'ouvir_gravacoes', nome: 'Ouvir gravações' },
	{ codigo: 'ver_transcricoes', nome: 'Ler transcrições' },
] as const;

function erroRpc(e: unknown): string {
	const x = e as { code?: string; message?: string } | null;
	if (x?.code === 'P0001' && x.message) return x.message.charAt(0).toUpperCase() + x.message.slice(1) + '.';
	return friendlyError(e);
}

function situacaoPedido(p: Row, hoje: string): { tom: 'ok' | 'atencao' | 'erro' | 'info' | 'neutro'; txt: string } {
	const s = String(p.situacao ?? 'aberto');
	if (s === 'concluido') return { tom: 'ok', txt: p.tipo === 'eliminar' ? 'Eliminado' : 'Pronto' };
	if (s === 'recusado') return { tom: 'erro', txt: 'Recusado' };
	if (p.prazo && String(p.prazo) < hoje) return { tom: 'atencao', txt: 'Fora do prazo' };
	if (s === 'em_execucao') return { tom: 'atencao', txt: 'Em execução' };
	return { tom: 'info', txt: 'Aberto' };
}

export function PrivacidadeVozPage() {
	const { empresa, perfil, permissoes, loading: authLoading } = useMotorAuth();
	const equipe = !!perfil?.equipe;
	const admin = !equipe && perfil?.papel === 'admin';
	const podePerms = !equipe && permissoes.includes('gerenciar_permissoes');

	const [cfg, setCfg] = useState<Row | null>(null);
	const [carregado, setCarregado] = useState(false);
	const [ret, setRet] = useState(String(PADRAO.retencao_dias));
	const [aviso, setAviso] = useState(PADRAO.aviso_gravacao);
	const [transcN, setTranscN] = useState(String(PADRAO.transcrever_min_segundos));
	const [salvando, setSalvando] = useState(false);
	const [confirmaReducao, setConfirmaReducao] = useState(false);

	const [catalogo, setCatalogo] = useState<Row[]>([]);
	const [ajustes, setAjustes] = useState<Record<string, boolean>>({});
	const [busyPerm, setBusyPerm] = useState('');

	const [pedidos, setPedidos] = useState<Row[]>([]);
	const [novoPedido, setNovoPedido] = useState(false);

	const carregar = useCallback(async () => {
		if (!supabase || !empresa) { setCarregado(true); return; }
		const eid = Number(empresa.id);
		const [c, cat, aj, pe] = await Promise.all([
			supabase.from('voz_config').select('retencao_dias,aviso_gravacao,transcrever,transcrever_min_segundos,gravar,atualizado_em').eq('empresa_id', eid).maybeSingle(),
			supabase.from('permissoes_catalogo').select('codigo,nome,admin,planejamento,operacao,gestao').in('codigo', PERMS_VOZ.map(p => p.codigo)),
			supabase.from('permissoes_papel').select('papel,permissao,permitido').eq('empresa_id', eid).in('permissao', PERMS_VOZ.map(p => p.codigo)),
			supabase.from('titular_pedidos').select('id,id_cliente,tipo,aberto_em,prazo,situacao,arquivo,concluido_em').eq('empresa_id', eid).order('aberto_em', { ascending: false }).limit(200),
		]);
		const conf = (c.data as Row | null) ?? null;
		setCfg(conf);
		setRet(String(conf?.retencao_dias ?? PADRAO.retencao_dias));
		setAviso(conf?.aviso_gravacao === true);
		setTranscN(String(conf?.transcrever_min_segundos ?? PADRAO.transcrever_min_segundos));
		setCatalogo((cat.data ?? []) as Row[]);
		const m: Record<string, boolean> = {};
		((aj.data ?? []) as Row[]).forEach(a => { m[`${a.papel}|${a.permissao}`] = a.permitido === true; });
		setAjustes(m);
		setPedidos((pe.data ?? []) as Row[]);
		setCarregado(true);
	}, [empresa?.id]);
	useEffect(() => { void carregar(); }, [carregar]);

	if (authLoading) return null;
	if (!equipe && !admin) return <EmpresaShell><SemPermissao tela="Privacidade e gravações" /></EmpresaShell>;

	const retN = Number(ret), tN = Number(transcN);
	const retErr = !(Number.isInteger(retN) && retN >= 90 && retN <= 36500);
	const tErr = !(Number.isInteger(tN) && tN >= 0 && tN <= 600);
	const retAtual = Number(cfg?.retencao_dias ?? PADRAO.retencao_dias);
	const ajustesSalvar: Record<string, unknown> = {};
	if (!retErr && retN !== retAtual) ajustesSalvar.retencao_dias = retN;
	if (aviso !== (cfg?.aviso_gravacao === true)) ajustesSalvar.aviso_gravacao = aviso;
	if (!tErr && tN !== Number(cfg?.transcrever_min_segundos ?? PADRAO.transcrever_min_segundos)) ajustesSalvar.transcrever_min_segundos = tN;
	const mudou = Object.keys(ajustesSalvar).length > 0;
	const podeSalvar = admin && mudou && !retErr && !tErr;

	async function salvar() {
		if (!supabase || !empresa || !podeSalvar) return;
		setSalvando(true);
		const { error } = await supabase.rpc('configurar_voz_empresa', { empresa: Number(empresa.id), ajustes: ajustesSalvar });
		setSalvando(false);
		setConfirmaReducao(false);
		if (error) { toast.error(erroRpc(error)); return; }
		toast.success('Privacidade salva. A nova retenção vale também para as gravações que já existem.');
		void carregar();
	}

	function valorPerm(papel: string, codigo: string): boolean {
		const k = `${papel}|${codigo}`;
		if (k in ajustes) return ajustes[k];
		return (catalogo.find(c => c.codigo === codigo) as Row | undefined)?.[papel] === true;
	}
	async function trocarPerm(papel: string, codigo: string) {
		if (!supabase || !empresa || !podePerms) return;
		const k = `${papel}|${codigo}`;
		const novo = !valorPerm(papel, codigo);
		const padrao = (catalogo.find(c => c.codigo === codigo) as Row | undefined)?.[papel] === true;
		setBusyPerm(k);
		setAjustes(prev => { const n = { ...prev }; if (novo === padrao) delete n[k]; else n[k] = novo; return n; });
		const { error } = novo === padrao
			? await supabase.from('permissoes_papel').delete().eq('empresa_id', empresa.id).eq('papel', papel).eq('permissao', codigo)
			: await supabase.from('permissoes_papel').upsert({ empresa_id: empresa.id, papel, permissao: codigo, permitido: novo }, { onConflict: 'empresa_id,papel,permissao' });
		setBusyPerm('');
		if (error) { toast.error(friendlyError(error)); void carregar(); }
	}

	const hoje = today();
	const semConfig = carregado && !cfg;

	return (
		<EmpresaShell>
			<div className="mb-5">
				<h2 className="text-[22px] font-bold tracking-tight text-[var(--base-texto)]">Privacidade e gravações</h2>
				<p className="mt-1 text-[14px] text-[var(--base-texto-2)]">Vale para o agente virtual e para as gravações do discador. {equipe ? 'Quem muda é o Admin da empresa; a equipe MotorCX vê em leitura.' : 'Quem muda é o Admin da empresa.'}</p>
			</div>
			{!carregado ? <p className="py-10 text-center text-[14px] text-[var(--base-texto-3)]">Carregando...</p> : (
				<div className="space-y-6">
					{semConfig && <Aviso tom="info">O agente virtual ainda não foi configurado para esta empresa. Os valores abaixo são o padrão e passam a valer assim que você salvar ou quando a equipe MotorCX ativar o agente.</Aviso>}
					<div className="grid gap-6 lg:grid-cols-2">
						<Cartao titulo="Por quanto tempo guardar">
							<Campo htmlFor="voz-ret" rotulo={<>Dias de gravação e transcrição <Pilula className="ml-1">padrão: 90 · pode aumentar</Pilula></>}
								erro={retErr ? 'O mínimo é 90 dias. Não há limite máximo.' : undefined}
								ajuda={`Áudio, transcrição e códigos por cliente apagam sozinhos depois de ${inteiro(retN)} dias. Os números agregados continuam.`}>
								<input id="voz-ret" value={ret} inputMode="numeric" disabled={!admin} onChange={e => setRet(e.target.value.replace(/\D/g, '').slice(0, 5))} className={`${campoCls} max-w-[200px] tnum`} />
							</Campo>
							<p className="mt-3 text-[12px] leading-relaxed text-[var(--base-texto-3)]">Mudar o prazo vale para as gravações novas e para as que já existem. Diminuir apaga as mais antigas na noite seguinte; gravação guardada para disputa não é apagada.</p>

							<div className="mt-5 border-t border-[var(--base-borda)] pt-4">
								<Subtitulo>Aviso no início da ligação</Subtitulo>
								<Chave label={<span className="text-[14px] font-medium text-[var(--base-texto)]">Avisar que a ligação é gravada <Pilula className="ml-1">padrão: desligado</Pilula></span>}
									checked={aviso} on={setAviso} disabled={!admin} />
								<p className="mt-2 text-[12px] leading-relaxed text-[var(--base-texto-3)]">Vale para todas as carteiras e entra na primeira fala. A apresentação como assistente virtual fica no roteiro de cada carteira. A decisão é da empresa.</p>
							</div>
							<Trava className="mt-4" icone={<ShieldCheck size={16} />} titulo="No provedor, a cópia some em até 7 dias.">
								O MotorCX copia a gravação para o bucket da sua empresa, em São Paulo, e apaga no provedor.
							</Trava>
						</Cartao>

						<Cartao titulo="Transcrição">
							<Campo htmlFor="voz-trn" rotulo={<>Transcrever chamadas a partir de quantos segundos <Pilula className="ml-1">padrão: 5</Pilula></>}
								erro={tErr ? 'Use de 0 a 600 segundos.' : undefined}
								ajuda={`Chamadas com ${inteiro(tN)} s ou mais são transcritas. As mais curtas (caixa postal, quem desliga logo) ficam só com o áudio e o resultado e não são cobradas como transcrição. Vale para o agente virtual e para o discador.`}>
								<input id="voz-trn" value={transcN} inputMode="numeric" disabled={!admin} onChange={e => setTranscN(e.target.value.replace(/\D/g, '').slice(0, 3))} className={`${campoCls} max-w-[200px] tnum`} />
							</Campo>
							{cfg && cfg.transcrever === false && <Aviso tom="neutro" className="mt-3">A transcrição está desligada para esta empresa.</Aviso>}

							<div className="mt-5 border-t border-[var(--base-borda)] pt-4">
								<Subtitulo desc={<>Mesmas permissões de <Link to="/empresa/pessoas" className="font-semibold text-[var(--destaque)] hover:underline">Pessoas e perfis</Link>. Todo acesso fica registrado na Auditoria, com nome, gravação e hora.</>}>Quem pode ouvir e ler</Subtitulo>
								<TabelaRolavel minW={320}>
									<thead><tr><th className={thCls}>Perfil</th>{PERMS_VOZ.map(p => <th key={p.codigo} className={`${thCls} text-center`}>{p.nome}</th>)}</tr></thead>
									<tbody>
										{PERFIS_INFO.map(pf => (
											<tr key={pf.id}>
												<td className={tdCls}>{pf.nome}</td>
												{PERMS_VOZ.map(p => {
													const k = `${pf.id}|${p.codigo}`;
													return (
														<td key={p.codigo} className={`${tdCls} text-center`}>
															<input type="checkbox" aria-label={`${pf.nome}: ${p.nome.toLowerCase()}`} checked={valorPerm(pf.id, p.codigo)}
																disabled={!podePerms || busyPerm === k} onChange={() => void trocarPerm(pf.id, p.codigo)} className="h-4 w-4" />
														</td>
													);
												})}
											</tr>
										))}
									</tbody>
								</TabelaRolavel>
								{!podePerms && <div className="mt-2"><Cadeado>Só quem gerencia permissões muda</Cadeado></div>}
							</div>
						</Cartao>
					</div>

					<div className="flex flex-wrap items-center justify-end gap-3">
						{!admin ? <Cadeado>Só o Admin da empresa muda a privacidade</Cadeado> : (
							<>
								{mudou && <span className="text-[13px] text-[var(--base-texto-2)]">Há mudanças não salvas.</span>}
								<button onClick={() => { if (ajustesSalvar.retencao_dias != null && retN < retAtual) setConfirmaReducao(true); else void salvar(); }} disabled={!podeSalvar || salvando} className={btnPrim}>{salvando ? 'Salvando...' : 'Salvar privacidade'}</button>
							</>
						)}
					</div>

					<PedidosTitular pedidos={pedidos} hoje={hoje} admin={admin} empresaId={empresa ? String(empresa.id) : ''} onNovo={() => setNovoPedido(true)} />
				</div>
			)}

			{confirmaReducao && (
				<Dialogo titulo="Diminuir a retenção?" onClose={() => !salvando && setConfirmaReducao(false)}
					texto={`De ${inteiro(retAtual)} para ${inteiro(retN)} dias. Gravações e transcrições com mais de ${inteiro(retN)} dias são apagadas na noite seguinte e não voltam. As guardadas para disputa ficam.`}
					acoes={<>
						<button onClick={() => setConfirmaReducao(false)} disabled={salvando} className={btnSec}>Cancelar</button>
						<button onClick={() => void salvar()} disabled={salvando} className={btnPrim}>{salvando ? 'Salvando...' : 'Diminuir e salvar'}</button>
					</>} />
			)}
			{novoPedido && <NovoPedido onClose={() => setNovoPedido(false)} onFeito={() => { setNovoPedido(false); void carregar(); }} />}
		</EmpresaShell>
	);
}

function PedidosTitular({ pedidos, hoje, admin, empresaId, onNovo }: { pedidos: Row[]; hoje: string; admin: boolean; empresaId: string; onNovo: () => void }) {
	const [baixando, setBaixando] = useState<string>('');
	async function baixar(p: Row) {
		if (!supabase || !p.arquivo) return;
		setBaixando(String(p.id));
		try {
			const { data, error } = await supabase.storage.from('saidas').createSignedUrl(String(p.arquivo), 300);
			if (error || !data?.signedUrl) throw error ?? new Error('arquivo');
			await logAccess('download', String(p.arquivo), empresaId);
			window.open(data.signedUrl, '_blank', 'noopener,noreferrer');
		} catch {
			toast.error('Não foi possível gerar o link agora. Tente de novo em instantes.');
		} finally {
			setBaixando('');
		}
	}
	const acao = (p: Row) => p.situacao === 'concluido' && p.tipo === 'exportar' && p.arquivo
		? <button onClick={() => void baixar(p)} disabled={baixando === String(p.id)} className={`${btnLink} inline-flex items-center gap-1`}><Download size={13} /> {baixando === String(p.id) ? 'Gerando...' : 'Baixar (link de 5 min)'}</button>
		: null;

	return (
		<Cartao titulo="Pedidos do titular" desc="Quando um cliente pede cópia ou eliminação dos dados de voz dele. O pedido é aberto pelo ID do cliente, nunca por nome ou CPF, e tem prazo de 15 dias."
			acoes={admin ? <button onClick={onNovo} className={btnPrim}><Plus size={15} /> Registrar pedido</button> : <Cadeado>Só o Admin da empresa registra</Cadeado>}>
			{pedidos.length === 0 ? (
				<Vazio titulo="Nenhum pedido do titular">Quando alguém pedir cópia ou eliminação das gravações, registre aqui com o ID do cliente.</Vazio>
			) : (
				<>
					<div className="hidden sm:block">
						<TabelaRolavel minW={600}>
							<thead><tr>
								<th className={thCls}>ID do cliente</th><th className={thCls}>Pedido</th><th className={thCls}>Aberto em</th>
								<th className={thCls}>Prazo</th><th className={thCls}>Situação</th><th className={thCls} />
							</tr></thead>
							<tbody>
								{pedidos.map(p => {
									const s = situacaoPedido(p, hoje);
									return (
										<tr key={String(p.id)}>
											<td className={`${tdCls} font-mono`}>{String(p.id_cliente)}</td>
											<td className={tdCls}>{p.tipo === 'eliminar' ? 'Eliminar' : 'Exportar'}</td>
											<td className={`${tdCls} tnum`}>{dateBR(p.aberto_em)}</td>
											<td className={`${tdCls} tnum`}>{dateBR(p.prazo)}</td>
											<td className={tdCls}><Pilula tom={s.tom}>{s.txt}</Pilula>{p.concluido_em ? <div className="mt-0.5 text-[11.5px] text-[var(--base-texto-3)]">{dateTimeBR(p.concluido_em)}</div> : null}</td>
											<td className={`${tdCls} text-right`}>{acao(p)}</td>
										</tr>
									);
								})}
							</tbody>
						</TabelaRolavel>
					</div>
					<div className="space-y-2 sm:hidden">
						{pedidos.map(p => {
							const s = situacaoPedido(p, hoje);
							return (
								<div key={String(p.id)} className="rounded-xl border border-[var(--base-borda)] p-3">
									<div className="flex items-start justify-between gap-2">
										<span className="font-mono text-[13.5px] font-semibold text-[var(--base-texto)]">{String(p.id_cliente)}</span>
										<Pilula tom={s.tom}>{s.txt}</Pilula>
									</div>
									<div className="mt-1 text-[12.5px] text-[var(--base-texto-2)]">{p.tipo === 'eliminar' ? 'Eliminar' : 'Exportar'} · aberto em {dateBR(p.aberto_em)} · prazo {dateBR(p.prazo)}</div>
									{acao(p) && <div className="mt-2">{acao(p)}</div>}
								</div>
							);
						})}
					</div>
				</>
			)}
			<p className="mt-3 text-[12px] leading-relaxed text-[var(--base-texto-3)]">Eliminar apaga áudios, transcrições, códigos por cliente e a cópia no provedor. Enquanto houver gravação guardada para disputa, a eliminação fica bloqueada até o Admin tirar a guarda. A exportação sai por link de 5 minutos.</p>
		</Cartao>
	);
}

function NovoPedido({ onClose, onFeito }: { onClose: () => void; onFeito: () => void }) {
	const [id, setId] = useState('');
	const [tipo, setTipo] = useState<'exportar' | 'eliminar'>('exportar');
	const [busy, setBusy] = useState(false);
	const [erro, setErro] = useState('');
	const valido = idClienteValido(id);

	async function registrar() {
		if (!supabase) return;
		if (!valido) { setErro('Use o ID do cliente da carteira (ex.: CLI-55210). Não digite nome, CPF ou telefone.'); return; }
		setBusy(true); setErro('');
		const { error } = await supabase.rpc('abrir_pedido_titular', { id_cliente: id.trim(), tipo });
		setBusy(false);
		if (error) { setErro(erroRpc(error)); return; }
		toast.success('Pedido registrado. O prazo é de 15 dias.');
		onFeito();
	}

	return (
		<Dialogo titulo="Registrar pedido do titular" texto="Use o ID do cliente; não digite nome nem CPF aqui." onClose={() => !busy && onClose()}
			acoes={<>
				<button onClick={onClose} disabled={busy} className={btnSec}>Cancelar</button>
				<button onClick={() => void registrar()} disabled={busy || !id.trim()} className={btnPrim}>{busy ? 'Registrando...' : 'Registrar'}</button>
			</>}>
			<div className="space-y-3">
				<Campo htmlFor="tit-id" rotulo="ID do cliente" erro={id && !valido ? 'Parece CPF, telefone ou nome. Use o ID do cliente da carteira.' : undefined}>
					<input id="tit-id" value={id} autoFocus autoComplete="off" onChange={e => setId(e.target.value)} placeholder="ID do cliente, ex.: CLI-55210" className={`${campoCls} font-mono`} />
				</Campo>
				<Campo htmlFor="tit-tipo" rotulo="Pedido">
					<select id="tit-tipo" value={tipo} onChange={e => setTipo(e.target.value as 'exportar' | 'eliminar')} className={campoCls}>
						<option value="exportar">Exportar (cópia dos dados de voz)</option>
						<option value="eliminar">Eliminar (apagar os dados de voz)</option>
					</select>
				</Campo>
				{erro && <Aviso tom="erro">{erro}</Aviso>}
			</div>
		</Dialogo>
	);
}
