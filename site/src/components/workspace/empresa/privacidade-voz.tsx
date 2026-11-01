// Empresa › Privacidade e gravações (Admin da empresa). Protótipo aprovado, tela 7; Decisões do dono 3a, 3c, 4a e 4b.
// Retenção (mínimo e padrão 90 dias, sem teto), aviso de gravação (desligado por padrão), transcrição a partir de
// N segundos (padrão 5), quem ouve e quem lê (as mesmas permissões de Pessoas e perfis) e pedidos do titular,
// abertos só pelo ID do cliente. Escreve por configurar_voz_empresa e abrir_pedido_titular (SQL 56).
// Redesign v2: os 3 ajustes num cartão, com as consequências recolhidas; "Salvar alterações" é a ação principal;
// "Registrar pedido" abre uma gaveta; pedidos com 4 colunas e o resto na gaveta do pedido.
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router';
import { Download, Plus } from 'lucide-react';
import { Detalhes, Gaveta, ListaRegras, ListaValores, Tabela as TabelaDs } from '@/components/ds';
import { toast } from 'sonner';
import { useMotorAuth } from '@/components/auth-provider';
import { SemPermissao } from '@/components/role-gate';
import { Chave } from '@/components/workspace/console/chave';
import { supabase, friendlyError, dateBR, dateTimeBR, logAccess, today, type Row } from '@/lib/supabase';
import { PERFIS_INFO } from '@/lib/perfis-info';
import { idClienteValido, inteiro } from '@/lib/voz';
import {
	Aviso, Cadeado, Campo, Cartao, Dialogo, Pilula, TabelaRolavel, Vazio, btnLink, btnPrim, btnSec, campoCls, tdCls, thCls,
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

	const botaoSalvar = !admin ? <Cadeado>Só o Admin da empresa muda a privacidade</Cadeado> : (
		<button onClick={() => { if (ajustesSalvar.retencao_dias != null && retN < retAtual) setConfirmaReducao(true); else void salvar(); }} disabled={!podeSalvar || salvando} className={btnPrim}>{salvando ? 'Salvando...' : 'Salvar alterações'}</button>
	);

	return (
		<EmpresaShell>
			<div className="mb-5 flex flex-wrap items-start justify-between gap-3">
				<div className="min-w-0 flex-[1_1_320px]">
					<h2 className="text-[22px] font-bold tracking-tight text-[var(--base-texto)]">Privacidade e gravações</h2>
					<p className="mt-1 text-[14px] text-[var(--base-texto-2)]">Vale para o agente virtual e para as gravações do discador. {equipe ? 'Quem muda é o Admin da empresa; a equipe MotorCX vê em leitura.' : 'Quem muda é o Admin da empresa.'}</p>
				</div>
				<div className="flex flex-wrap items-center gap-2">
					{admin && <button onClick={() => setNovoPedido(true)} className={btnSec}><Plus size={15} /> Registrar pedido</button>}
					{botaoSalvar}
				</div>
			</div>
			{!carregado ? <p className="py-10 text-center text-[14px] text-[var(--base-texto-3)]">Carregando...</p> : (
				<div className="space-y-5">
					{semConfig && <Aviso tom="info">O agente virtual ainda não foi configurado para esta empresa. Os valores abaixo são o padrão e passam a valer quando você salvar ou quando a equipe MotorCX ativar o agente.</Aviso>}
					<Cartao titulo="Gravações e transcrição" desc={mudou ? 'Há mudanças não salvas.' : undefined}>
						<div className="grid gap-5 md:grid-cols-3">
							<Campo htmlFor="voz-ret" rotulo={<>Guardar por (dias) <Pilula className="ml-1">padrão: 90</Pilula></>}
								erro={retErr ? 'O mínimo é 90 dias. Não há limite máximo.' : undefined}
								ajuda={`Áudio, transcrição e códigos por cliente apagam sozinhos depois de ${inteiro(retN)} dias.`}>
								<input id="voz-ret" value={ret} inputMode="numeric" disabled={!admin} onChange={e => setRet(e.target.value.replace(/\D/g, '').slice(0, 5))} className={`${campoCls} max-w-[200px] tnum`} />
							</Campo>
							<Campo htmlFor="voz-trn" rotulo={<>Transcrever a partir de (segundos) <Pilula className="ml-1">padrão: 5</Pilula></>}
								erro={tErr ? 'Use de 0 a 600 segundos.' : undefined}
								ajuda={`Chamadas com ${inteiro(tN)} s ou mais são transcritas; as mais curtas ficam só com o áudio e o resultado.`}>
								<input id="voz-trn" value={transcN} inputMode="numeric" disabled={!admin} onChange={e => setTranscN(e.target.value.replace(/\D/g, '').slice(0, 3))} className={`${campoCls} max-w-[200px] tnum`} />
							</Campo>
							<div className="min-w-0">
								<p className="mb-1 text-[13px] font-semibold text-[var(--base-texto)]">Aviso no início da ligação</p>
								<Chave label={<span className="text-[14px] text-[var(--base-texto)]">Avisar que é gravada <Pilula className="ml-1">padrão: desligado</Pilula></span>}
									checked={aviso} on={setAviso} disabled={!admin} />
								<p className="mt-1 text-[12px] text-[var(--base-texto-3)]">Vale para todas as carteiras e entra na primeira fala.</p>
							</div>
						</div>
						{cfg && cfg.transcrever === false && <div className="mt-3"><Aviso tom="neutro">A transcrição está desligada para esta empresa.</Aviso></div>}
						<div className="mt-4"><Detalhes resumo="O que acontece quando muda">
							<ListaRegras regras={[
								{ titulo: 'O prazo vale também para as gravações que já existem', texto: 'Diminuir apaga as mais antigas na noite seguinte (com confirmação); gravação guardada para disputa não é apagada. Os números agregados continuam.' },
								{ titulo: 'No provedor, a cópia some em até 7 dias', texto: 'O MotorCX copia a gravação para o bucket da empresa, em São Paulo, e apaga no provedor.' },
								{ titulo: 'Transcrição tem custo por minuto', texto: 'As chamadas abaixo do corte (caixa postal, quem desliga logo) não são cobradas como transcrição. Vale para o agente virtual e para o discador.' },
								{ titulo: 'O aviso de gravação é decisão da empresa', texto: 'A apresentação como assistente virtual fica no roteiro de cada carteira.' },
							]} />
						</Detalhes></div>
					</Cartao>

					<Cartao titulo="Quem pode ouvir e ler" desc={<>Mesmas permissões de <Link to="/empresa/pessoas" className="font-semibold text-[var(--destaque)] hover:underline">Pessoas e perfis</Link>. Todo acesso fica registrado na Auditoria, com nome, gravação e hora.</>}
						acoes={!podePerms ? <Cadeado>Só quem gerencia permissões muda</Cadeado> : undefined}>
						<TabelaRolavel minW={300}>
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
														disabled={!podePerms || busyPerm === k} onChange={() => void trocarPerm(pf.id, p.codigo)} className="h-4 w-4 accent-[var(--destaque)]" />
												</td>
											);
										})}
									</tr>
								))}
							</tbody>
						</TabelaRolavel>
					</Cartao>

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

	const [sel, setSel] = useState<Row | null>(null);
	return (
		<Cartao semPad titulo="Pedidos do titular" desc="Cópia ou eliminação dos dados de voz, aberto pelo ID do cliente, com prazo de 15 dias."
			acoes={!admin ? <Cadeado>Só o Admin da empresa registra</Cadeado> : undefined}>
			<TabelaDs rotulo="Pedidos do titular" linhas={pedidos} chave={p => String(p.id)} onAbrir={setSel} selecionada={sel ? String(sel.id) : null}
				vazio={<div className="px-1"><Vazio titulo="Nenhum pedido do titular">Quando alguém pedir cópia ou eliminação das gravações, registre com o ID do cliente.{admin ? <> <button type="button" onClick={onNovo} className={btnLink}>Registrar pedido</button></> : null}</Vazio></div>}
				colunas={[
					{ id: 'cli', titulo: 'ID do cliente', celula: p => <span className="font-mono">{String(p.id_cliente)}</span> },
					{ id: 'tipo', titulo: 'Pedido', celula: p => (p.tipo === 'eliminar' ? 'Eliminar' : 'Exportar') },
					{ id: 'prazo', titulo: 'Prazo', celula: p => <span className="tnum">{dateBR(p.prazo)}</span> },
					{ id: 'sit', titulo: 'Situação', celula: p => { const x = situacaoPedido(p, hoje); return <Pilula tom={x.tom}>{x.txt}</Pilula>; } },
				]}
				celular={p => { const x = situacaoPedido(p, hoje); return { titulo: <span className="font-mono">{String(p.id_cliente)}</span>, valor: <Pilula tom={x.tom}>{x.txt}</Pilula>, resumo: `${p.tipo === 'eliminar' ? 'Eliminar' : 'Exportar'} · prazo ${dateBR(p.prazo)}` }; }} />
			<Gaveta aberta={!!sel} onFechar={() => setSel(null)} titulo={sel ? `Pedido de ${String(sel.id_cliente)}` : ''} subtitulo={sel ? (sel.tipo === 'eliminar' ? 'Eliminar os dados de voz' : 'Exportar os dados de voz') : undefined}>
				{sel && <>
					<ListaValores itens={[['Aberto em', dateBR(sel.aberto_em)], ['Prazo', dateBR(sel.prazo)], ['Situação', situacaoPedido(sel, hoje).txt], ['Concluído em', sel.concluido_em ? dateTimeBR(sel.concluido_em) : '—']]} />
					{acao(sel)}
					<p className="text-[12px] text-[var(--base-texto-3)]">Eliminar apaga áudios, transcrições, códigos por cliente e a cópia no provedor. Com gravação guardada para disputa, a eliminação fica bloqueada até o Admin tirar a guarda.</p>
				</>}
			</Gaveta>
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
		<Gaveta aberta titulo="Registrar pedido do titular" subtitulo="Use o ID do cliente; não digite nome nem CPF aqui. O prazo é de 15 dias." onFechar={() => !busy && onClose()}
			rodape={<>
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
				<Detalhes resumo="Regras de eliminação">
					<ListaRegras regras={[
						{ titulo: 'Eliminar apaga áudios, transcrições, códigos por cliente e a cópia no provedor' },
						{ titulo: 'Gravação guardada para disputa bloqueia a eliminação', texto: 'Até o Admin tirar a guarda.' },
						{ titulo: 'Exportar gera um arquivo com link de 5 minutos', texto: 'O download fica registrado.' },
					]} />
				</Detalhes>
			</div>
		</Gaveta>
	);
}
