// Console › Fornecedores e rotas › Agente virtual (equipe MotorCX). Protótipo aprovado, tela 1, e SQL 56.
// Global: conexão do provedor (só se funciona, nunca a chave) e concorrência contratada dividida entre as empresas.
// Por empresa: provedor de voz, troncos SIP, IPs de saída, rotas com vigência (e o alerta de rota sem cadastro),
// calculadora de tarifação sem carência, transferência para o discador, pico, Alô fake e o caminho
// Simulado → Só números de teste → Real com o checklist. Troncos, rotas e configuração: gerenciar_troncos_voz.
// Ligar de verdade: ligar_voz_real. Quem não tem a permissão vê o cadeado.
// Redesign v2: abas Empresa (padrão: caminho Simulado → Teste → Real, KPIs de prontidão, "Antes de ligar de verdade" e a
// configuração em 5 linhas que abrem gavetas), Troncos e rotas, Transferência e Todas as empresas (o global, separado).
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { ChevronRight, KeyRound, Pencil, Phone, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { useMotorAuth } from '@/components/auth-provider';
import { supabase, friendlyError, dateBR, dateTimeBR, today, type Row } from '@/lib/supabase';
import {
	FORMATOS_DISCAGEM, IPS_SAIDA_MOTORCX, MODOS_VOZ, PROVEDORES_VOZ, TIPOS_ROTA, binaMascara, cadenciaTxt, inteiro, reais,
	segundosTarifados, custoVoz,
} from '@/lib/voz';
import { Cadeado, Cartao, Dialogo, Pilula, Ponto, Subtitulo, Trava, Vazio, btnLink, btnPrim, btnSec, campoCls } from '@/components/comuns/voz-ui';
import { Abas, Aviso as AvisoDs, Detalhes, Gaveta, Kpis, ListaValores, Passos, SeloRegras, Tabela } from '@/components/ds';
import { textoTemDadoPessoal } from '@/lib/speech';
import { useConsolePerms } from './console-perms';
import { NumerosTesteDialogo, RotaGaveta, TransferenciaGaveta, TroncoGaveta } from './console-voz-gavetas';

const SEM_PERM_TRONCOS = 'Só a equipe com a permissão de troncos de voz';
const SEM_PERM_LIGAR = 'Só quem tem a permissão de ligar o agente de voz';

const ROTULO_SAUDE: Record<string, string> = {
	chave_api: 'Chave de API',
	webhook: 'Retorno das chamadas (webhook)',
	conexao: 'Conexão',
	sip: 'Ligação SIP com o Asterisk',
};
const rotuloSaude = (item: string) => ROTULO_SAUDE[item] ?? item.replace(/_/g, ' ').replace(/^./, c => c.toUpperCase());

function erroRpc(e: unknown): string {
	const x = e as { code?: string; message?: string } | null;
	if (x?.code === 'P0001' && x.message) return x.message.charAt(0).toUpperCase() + x.message.slice(1) + '.';
	return friendlyError(e);
}

export function AgenteVirtualConsole() {
	const { can } = useConsolePerms();
	const { empresa: empresaAtual, empresas } = useMotorAuth();
	const podeTroncos = can('gerenciar_troncos_voz');
	const podeLigar = can('ligar_voz_real');

	const [divisao, setDivisao] = useState<Row[]>([]);
	const [contrato, setContrato] = useState<Row | null>(null);
	const [fornecedores, setFornecedores] = useState<Row[]>([]);
	const [saudeGlobal, setSaudeGlobal] = useState<Row[]>([]);
	const [loading, setLoading] = useState(true);
	const [empresaId, setEmpresaId] = useState<string>('');

	const nomeEmpresa = useCallback((id: unknown) => empresas.find(e => String(e.id) === String(id))?.nome ?? `Empresa ${String(id)}`, [empresas]);

	const recarregarGlobal = useCallback(async () => {
		if (!supabase) { setLoading(false); return; }
		const [d, c, f, s] = await Promise.all([
			supabase.from('voz_divisao_concorrencia').select('*'),
			supabase.from('voz_contrato').select('concorrencia_contratada,atualizado_em').maybeSingle(),
			supabase.from('mensageria_fornecedores').select('codigo,nome,segredo_ref,ativo,canais').contains('canais', ['agente_voz']),
			supabase.from('fornecedor_saude').select('fornecedor,item,ok,verificado_em,detalhe,contagem').is('empresa_id', null),
		]);
		setDivisao((d.data ?? []) as Row[]);
		setContrato((c.data as Row | null) ?? null);
		setFornecedores((f.data ?? []) as Row[]);
		setSaudeGlobal((s.data ?? []) as Row[]);
		setLoading(false);
	}, []);
	useEffect(() => { void recarregarGlobal(); }, [recarregarGlobal]);

	// Empresa escolhida: a do topo; senão a primeira com tronco; senão a primeira da lista.
	useEffect(() => {
		if (empresaId) return;
		const ini = empresaAtual?.id ?? (divisao[0]?.empresa_id != null ? String(divisao[0].empresa_id) : empresas[0]?.id);
		if (ini) setEmpresaId(String(ini));
	}, [empresaAtual?.id, divisao, empresas, empresaId]);

	const opcoesEmpresa = useMemo(() => {
		const ids = new Set<string>(empresas.map(e => String(e.id)));
		divisao.forEach(r => ids.add(String(r.empresa_id)));
		return [...ids].map(id => ({ id, nome: nomeEmpresa(id) })).sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
	}, [empresas, divisao, nomeEmpresa]);

	const [aba, setAba] = useState<AbaVoz>('empresa');
	return (
		<div className="space-y-5">
			<div>
				<h2 className="text-[22px] font-bold tracking-tight text-[var(--base-texto)]">Agente virtual</h2>
				<p className="mt-1 text-[14px] text-[var(--base-texto-2)]">Configuração do canal por empresa e o que vale para todas. A chave não aparece aqui, só se ela funciona.</p>
			</div>
			<Abas rotulo="Seções do agente virtual" atual={aba} onTrocar={id => setAba(id as AbaVoz)} itens={[
				{ id: 'empresa', nome: 'Empresa' }, { id: 'troncos', nome: 'Troncos e rotas' }, { id: 'transferencia', nome: 'Transferência' }, { id: 'todas', nome: 'Todas as empresas' },
			]} />

			{aba === 'todas' ? <>
				<ConexaoProvedor fornecedores={fornecedores} saude={saudeGlobal} loading={loading} />
				<Concorrencia divisao={divisao} contrato={contrato} nomeEmpresa={nomeEmpresa} podeTroncos={podeTroncos} loading={loading}
					onSalvo={() => void recarregarGlobal()} onEscolher={id => { setEmpresaId(id); setAba('empresa'); }} />
			</> : <div>
				<div className="mb-4 flex flex-wrap items-center gap-3">
					<label htmlFor="voz-emp" className="text-[13px] font-semibold text-[var(--base-texto-2)]">Empresa</label>
					<select id="voz-emp" value={empresaId} onChange={e => setEmpresaId(e.target.value)} className={`${campoCls} h-9 max-w-[320px] flex-1`}>
						{opcoesEmpresa.length === 0 && <option value="">Nenhuma empresa</option>}
						{opcoesEmpresa.map(o => <option key={o.id} value={o.id}>{o.nome}</option>)}
					</select>
				</div>
				{empresaId ? (
					<EmpresaVoz key={empresaId} aba={aba} empresaId={empresaId} empresaNome={nomeEmpresa(empresaId)}
						divisaoLinha={divisao.find(r => String(r.empresa_id) === empresaId) ?? null}
						podeTroncos={podeTroncos} podeLigar={podeLigar} onMudouTroncos={() => void recarregarGlobal()} />
				) : (
					<Vazio titulo="Nenhuma empresa para configurar">Quando houver empresa ativa, o agente virtual dela é configurado aqui.</Vazio>
				)}
			</div>}
		</div>
	);
}

type AbaVoz = 'empresa' | 'troncos' | 'transferencia' | 'todas';

// ============================================================== conexão do provedor
function ConexaoProvedor({ fornecedores, saude, loading }: { fornecedores: Row[]; saude: Row[]; loading: boolean }) {
	return (
		<Cartao titulo="Conexão com o provedor (vale para todas as empresas)"
			desc="Quem digita a chave é o dono, direto no cofre (Google Secret Manager). Esta tela nunca recebe a chave: mostra só o nome no cofre e o resultado do último teste da VM.">
			{loading ? <p className="py-4 text-center text-[13px] text-[var(--base-texto-3)]">Carregando...</p> : fornecedores.length === 0 ? (
				<Vazio titulo="Nenhum provedor de voz cadastrado">O provedor do canal Agente virtual aparece aqui quando estiver em Fornecedores.</Vazio>
			) : (
				<div className="grid gap-3 md:grid-cols-2">
					{fornecedores.map(f => {
						const itens = saude.filter(s => s.fornecedor === f.codigo);
						const ruim = itens.some(s => s.ok === false);
						const tom = itens.length === 0 ? 'neutro' : ruim ? 'erro' : 'ok';
						return (
							<div key={String(f.codigo)} className="rounded-xl border border-[var(--base-borda)] p-4">
								<div className="flex flex-wrap items-center justify-between gap-2">
									<span className="flex items-center gap-2 text-[15px] font-semibold text-[var(--base-texto)]"><KeyRound size={15} className="text-[var(--base-texto-2)]" /> {String(f.nome)}</span>
									<Pilula tom={tom}>{itens.length === 0 ? 'Sem teste ainda' : ruim ? 'Com problema' : 'Funcionando'}</Pilula>
								</div>
								<p className="mt-1 text-[12.5px] text-[var(--base-texto-2)]">
									{f.segredo_ref ? <>Nome no cofre: <span className="font-mono">{String(f.segredo_ref)}</span></> : 'Sem segredo no cofre: as ligações ficam simuladas.'}
									{f.ativo === false && ' · desativado'}
								</p>
								{itens.length > 0 && (
									<ul className="mt-3 space-y-1.5">
										{itens.map((s, i) => (
											<li key={i} className="flex items-start gap-2 text-[13px]">
												<span className="mt-1.5"><Ponto tom={s.ok ? 'ok' : 'erro'} /></span>
												<span className="min-w-0">
													<b className="font-semibold text-[var(--base-texto)]">{rotuloSaude(String(s.item))}</b>
													<span className="text-[var(--base-texto-2)]"> · {s.ok ? 'ok' : 'falhou'} · {dateTimeBR(s.verificado_em)}{s.detalhe ? ` · ${String(s.detalhe)}` : ''}</span>
												</span>
											</li>
										))}
									</ul>
								)}
							</div>
						);
					})}
				</div>
			)}
		</Cartao>
	);
}

// ============================================================== concorrência contratada
function Concorrencia({ divisao, contrato, nomeEmpresa, podeTroncos, loading, onSalvo, onEscolher }: {
	divisao: Row[]; contrato: Row | null; nomeEmpresa: (id: unknown) => string; podeTroncos: boolean; loading: boolean;
	onSalvo: () => void; onEscolher: (id: string) => void;
}) {
	const atual = Number(contrato?.concorrencia_contratada ?? divisao[0]?.contratado ?? 0);
	const [valor, setValor] = useState(String(atual));
	const [busy, setBusy] = useState(false);
	const [como, setComo] = useState(false);
	useEffect(() => { setValor(String(atual)); }, [atual]);

	const n = Number(valor);
	const valido = Number.isInteger(n) && n >= 0 && n <= 1000000;
	const mudou = valido && n !== atual;
	const totCanais = divisao.reduce((t, r) => t + Number(r.canais ?? 0), 0);
	const totLimite = divisao.reduce((t, r) => t + Number(r.limite ?? 0), 0);
	const linhas = [...divisao].sort((a, b) => Number(b.canais) - Number(a.canais));

	async function salvar() {
		if (!supabase || !mudou) return;
		setBusy(true);
		const { error } = await supabase.rpc('definir_concorrencia_contratada', { n });
		setBusy(false);
		if (error) { toast.error(erroRpc(error)); return; }
		toast.success('Concorrência salva. A divisão entre as empresas foi refeita.');
		onSalvo();
	}

	return (
		<Cartao semPad titulo="Concorrência contratada"
			desc="Total de ligações ao mesmo tempo no contrato com o provedor de voz, dividido entre as empresas pelos canais dos troncos ativos."
			acoes={<button type="button" onClick={() => setComo(true)} className={btnLink}>Como dividimos</button>}>
			<div className="px-5 pb-2 sm:px-6">
				<div className="flex flex-wrap items-end gap-3">
					<div className="w-full max-w-[280px]">
						<label htmlFor="voz-contr" className="mb-1 block text-[13px] font-semibold text-[var(--base-texto)]">Total contratado (ao mesmo tempo)</label>
						<input id="voz-contr" value={valor} inputMode="numeric" disabled={!podeTroncos} onChange={e => setValor(e.target.value.replace(/\D/g, ''))} className={`${campoCls} tnum`} />
					</div>
					{podeTroncos ? (
						<button onClick={() => void salvar()} disabled={!mudou || busy} className={btnPrim}>{busy ? 'Salvando...' : 'Salvar'}</button>
					) : <Cadeado>{SEM_PERM_TRONCOS}</Cadeado>}
				</div>
				<p className="mt-1.5 text-[12px] text-[var(--base-texto-3)]">A divisão é refeita na hora.{contrato?.atualizado_em ? ` Última mudança: ${dateTimeBR(contrato.atualizado_em)}.` : ''}</p>
			</div>
			<div className="pt-2">
				{loading ? <p className="py-4 text-center text-[13px] text-[var(--base-texto-3)]">Carregando...</p> : (
					<Tabela rotulo="Divisão por empresa" linhas={linhas} chave={r => String(r.empresa_id)} onAbrir={r => onEscolher(String(r.empresa_id))}
						vazio="Nenhuma empresa com tronco ativo ainda."
						colunas={[
							{ id: 'emp', titulo: 'Empresa', celula: r => nomeEmpresa(r.empresa_id) },
							{ id: 'can', titulo: 'Canais', num: true, celula: r => inteiro(r.canais) },
							{ id: 'lim', titulo: 'Limite', num: true, celula: r => <b>{inteiro(r.limite)}</b> },
							{ id: 'pico', titulo: 'Pico', celula: r => { const pico = Number(r.pico_multiplo ?? 1); return pico <= 1 ? 'Desligado' : `Até ${pico}× · máx. ${inteiro(r.teto)}`; } },
						]}
						celular={r => ({ titulo: nomeEmpresa(r.empresa_id), valor: `${inteiro(r.limite)} simultâneas`, resumo: `${inteiro(r.canais)} canais` })}
						rodape={<><span>Total</span><span className="tnum">{inteiro(totCanais)} canais · limite {inteiro(totLimite)}</span></>} />
				)}
			</div>
			<Gaveta aberta={como} onFechar={() => setComo(false)} titulo="Como dividimos a concorrência">
				<p className="text-[13px] leading-relaxed text-[var(--base-texto-2)]">Limite da empresa = {inteiro(atual)} × canais dela ÷ {inteiro(totCanais)} canais no total. A sobra do arredondamento vai para as empresas com a maior fração. O pico é opção de cada empresa, vem desligado e nunca passa dos canais do tronco.</p>
				<Trava icone={<Phone size={16} />} titulo='Quem liga é sempre o agente de IA. Se na transferência não houver operador livre no discador do cliente, a chamada é derrubada e registrada como "abandono".'>
					Nada fica em fila esperando. A taxa de abandono aparece em Ligações em curso e freia o lote quando passa do limite da empresa.
				</Trava>
			</Gaveta>
		</Cartao>
	);
}

// ============================================================== por empresa
type Pausa = { id: number; tronco_id: number; motivo: 'sem_credito' | 'bloqueio_originacao' | string; causa_sip: number | null; pausado_em: string };
const MOTIVO_PAUSA: Record<string, string> = { sem_credito: 'sem crédito na operadora', bloqueio_originacao: 'bloqueio de originação' };

type DadosEmpresa = {
	pausas: Pausa[];
	config: Row | null; troncos: Row[]; rotas: Row[]; transferencia: Row | null; saude: Row[]; pedido: Row | null;
	roteiro: Row | null; ligacoesTeste: number; recebeFaturas: number;
};

function EmpresaVoz({ aba, empresaId, empresaNome, divisaoLinha, podeTroncos, podeLigar, onMudouTroncos }: {
	aba: Exclude<AbaVoz, 'todas'>; empresaId: string; empresaNome: string; divisaoLinha: Row | null; podeTroncos: boolean; podeLigar: boolean; onMudouTroncos: () => void;
}) {
	const [d, setD] = useState<DadosEmpresa | null>(null);
	const [gTronco, setGTronco] = useState<{ tronco: Row | null } | null>(null);
	const [gRota, setGRota] = useState<{ base: Row | null; prefixo?: string } | null>(null);
	const [gTransf, setGTransf] = useState(false);
	const [gNumeros, setGNumeros] = useState(false);

	const carregar = useCallback(async () => {
		if (!supabase) { setD({ pausas: [], config: null, troncos: [], rotas: [], transferencia: null, saude: [], pedido: null, roteiro: null, ligacoesTeste: 0, recebeFaturas: 0 }); return; }
		const eid = Number(empresaId);
		const [cfg, tr, ro, tf, sa, pe, rt, lt, cf, pz] = await Promise.all([
			supabase.from('voz_config').select('*').eq('empresa_id', eid).maybeSingle(),
			supabase.from('voz_troncos').select('id,referencia,operadora,host,porta,transporte,autenticacao,usuario,segredo_ref,ddd_origem,bina,formato_discagem,csp,codecs,canais,cps,ativo,testado_em,teste_ok').eq('empresa_id', eid).order('referencia'),
			supabase.from('voz_rotas').select('*').eq('empresa_id', eid).order('vigente_desde', { ascending: false }),
			supabase.from('voz_transferencias').select('*').eq('empresa_id', eid).eq('ativo', true).is('credor_id', null).limit(1),
			supabase.from('fornecedor_saude').select('item,referencia,ok,contagem,detalhe,verificado_em,tronco_id').eq('empresa_id', eid),
			supabase.from('pedidos_envio_real').select('id,pedido_em,chamado_id,situacao').eq('empresa_id', eid).eq('canal', 'agente_voz').eq('situacao', 'aberto').limit(1),
			supabase.from('voz_roteiros').select('id,versao,em_uso_em,credor_id').eq('empresa_id', eid).eq('situacao', 'em_uso').limit(1),
			supabase.from('voz_chamadas').select('id', { count: 'exact', head: true }).eq('empresa_id', eid).eq('modo', 'teste'),
			supabase.from('empresa_contatos').select('id', { count: 'exact', head: true }).eq('empresa_id', eid).eq('recebe_faturas', true),
			// Pausas ativas da rota (SQL 65, PR #162): sem a tabela ainda, a leitura falha e a lista fica vazia.
			supabase.from('voz_troncos_pausas').select('id,tronco_id,motivo,causa_sip,pausado_em').eq('empresa_id', eid).is('retomado_em', null),
		]);
		setD({
			pausas: pz.error ? [] : ((pz.data ?? []) as Pausa[]),
			config: (cfg.data as Row | null) ?? null,
			troncos: (tr.data ?? []) as Row[],
			rotas: (ro.data ?? []) as Row[],
			transferencia: ((tf.data ?? []) as Row[])[0] ?? null,
			saude: (sa.data ?? []) as Row[],
			pedido: ((pe.data ?? []) as Row[])[0] ?? null,
			roteiro: ((rt.data ?? []) as Row[])[0] ?? null,
			ligacoesTeste: lt.count ?? 0,
			recebeFaturas: cf.count ?? 0,
		});
	}, [empresaId]);
	useEffect(() => { void carregar(); }, [carregar]);

	if (!d) return <p className="py-10 text-center text-[14px] text-[var(--base-texto-3)]">Carregando...</p>;

	const salvo = (msg: string, troncos = false) => {
		toast.success(msg);
		setGTronco(null); setGRota(null); setGTransf(false); setGNumeros(false);
		void carregar();
		if (troncos) onMudouTroncos();
	};
	const modo = String(d.config?.modo ?? 'simulado');

	return (
		<div className="space-y-5">
			{aba === 'empresa' && <>
				<LigarDeVerdade empresaId={empresaId} empresaNome={empresaNome} d={d} modo={modo} podeLigar={podeLigar} divisaoLinha={divisaoLinha} onFeito={() => void carregar()} />
				<ConfigEmpresa empresaId={empresaId} empresaNome={empresaNome} config={d.config} divisaoLinha={divisaoLinha} troncos={d.troncos}
					podeTroncos={podeTroncos} modo={modo} onNumeros={() => setGNumeros(true)} onSalvo={m => salvo(m, true)} />
			</>}
			{aba === 'troncos' && <>
				<Troncos troncos={d.troncos} pausas={d.pausas} podeTroncos={podeTroncos} onRetomado={() => salvo('Rota retomada. A VM volta a discar por este tronco no próximo minuto.', true)} onNovo={() => setGTronco({ tronco: null })} onEditar={t => setGTronco({ tronco: t })} />
				<Rotas rotas={d.rotas} troncos={d.troncos} saude={d.saude} podeTroncos={podeTroncos}
					onNova={(base, prefixo) => setGRota({ base, prefixo })} onEncerrada={() => salvo('Rota encerrada. Ela fica no histórico.')} />
			</>}
			{aba === 'transferencia' && <Transferencia atual={d.transferencia} troncos={d.troncos} podeTroncos={podeTroncos} onEditar={() => setGTransf(true)} />}

			{gTronco && <TroncoGaveta empresaId={empresaId} empresaNome={empresaNome} tronco={gTronco.tronco} onClose={() => setGTronco(null)} onSaved={m => salvo(m, true)} />}
			{gRota && <RotaGaveta empresaId={empresaId} troncos={d.troncos} rotaBase={gRota.base} prefixoSugerido={gRota.prefixo} onClose={() => setGRota(null)} onSaved={m => salvo(m)} />}
			{gTransf && <TransferenciaGaveta empresaId={empresaId} troncos={d.troncos} atual={d.transferencia} onClose={() => setGTransf(false)} onSaved={m => salvo(m)} />}
			{gNumeros && <NumerosTesteDialogo empresaId={empresaId} onClose={() => setGNumeros(false)} onSaved={m => salvo(m)} />}
		</div>
	);
}

// ---------------------------------------------------------------- configuração do agente (provedor, pico, Alô fake)
function ConfigEmpresa({ empresaId, empresaNome, config, divisaoLinha, troncos, podeTroncos, modo, onNumeros, onSalvo }: {
	empresaId: string; empresaNome: string; config: Row | null; divisaoLinha: Row | null; troncos: Row[]; podeTroncos: boolean; modo: string;
	onNumeros: () => void; onSalvo: (msg: string) => void;
}) {
	const [busy, setBusy] = useState('');
	const [bucket, setBucket] = useState(String(config?.bucket_gravacoes ?? ''));
	const [aberta, setAberta] = useState<string | null>(null);
	const provedor = String(config?.provedor ?? 'simulador');
	const pico = Number(config?.pico_multiplo ?? 1);
	const aloLib = config?.alo_fake_liberado === true;
	const nTeste = Array.isArray(config?.numeros_teste_hash) ? (config!.numeros_teste_hash as unknown[]).length : 0;
	const limite = Number(divisaoLinha?.limite ?? 0);
	const canais = troncos.filter(t => t.ativo !== false).reduce((s, t) => s + Number(t.canais ?? 0), 0);
	const tetoDe = (m: number) => Math.min(limite * m, canais);

	async function ajustar(chave: string, valor: unknown, msg: string) {
		if (!supabase) return;
		setBusy(chave);
		const { error } = await supabase.rpc('configurar_voz_equipe', { empresa: Number(empresaId), ajustes: { [chave]: valor } });
		setBusy('');
		if (error) { toast.error(erroRpc(error)); return; }
		onSalvo(msg);
	}

	const sel = 'h-9 w-full rounded-lg border border-[var(--base-field-border)] bg-[var(--base-cartao)] px-2.5 text-[13.5px] text-[var(--base-texto)] outline-none focus:border-[var(--destaque)]';
	const provInfo = PROVEDORES_VOZ.find(p => p.id === provedor);

	const linhasCfg: { id: string; nome: string; valor: ReactNode }[] = [
		{ id: 'provedor', nome: 'Provedor de voz', valor: provInfo?.nome ?? provedor },
		{ id: 'pico', nome: 'Pico acima do limite', valor: pico <= 1 ? 'Desligado' : `Até ${pico}× · máx. ${inteiro(tetoDe(pico))}` },
		{ id: 'alo', nome: 'Alô fake', valor: aloLib ? (config?.alo_fake ? `Liberado · ligado, até ${inteiro(config?.alo_fake_max_s)} s` : 'Liberado · desligado pela empresa') : 'Não liberado' },
		{ id: 'numeros', nome: 'Números de teste', valor: nTeste === 0 ? 'Nenhum cadastrado' : `${inteiro(nTeste)} cadastrado${nTeste > 1 ? 's' : ''}` },
		{ id: 'bucket', nome: 'Bucket de gravações', valor: config?.bucket_gravacoes ? <span className="font-mono text-[12.5px]">{String(config.bucket_gravacoes)}</span> : 'Sem bucket' },
	];
	const titulo = linhasCfg.find(l => l.id === aberta)?.nome ?? '';

	return (
		<Cartao semPad titulo="Configuração da empresa" desc={`Quem cadastra é a equipe MotorCX.${config?.atualizado_em ? ` Última mudança ${dateTimeBR(config.atualizado_em)}.` : ''}`}
			acoes={!podeTroncos ? <Cadeado>{SEM_PERM_TRONCOS} muda</Cadeado> : undefined}>
			<ul className="border-t border-[var(--base-borda)]">
				{linhasCfg.map(l => (
					<li key={l.id} className="border-b border-[var(--base-borda)] last:border-0">
						<button type="button" onClick={() => (l.id === 'numeros' && podeTroncos ? onNumeros() : setAberta(l.id))} className="flex w-full items-center gap-3 px-5 py-3 text-left hover:bg-[var(--base-fill)] sm:px-6">
							<span className="min-w-0 flex-1 text-[13.5px] font-semibold text-[var(--base-texto)]">{l.nome}</span>
							<span className="min-w-0 truncate text-right text-[13px] text-[var(--base-texto-2)]">{l.valor}</span>
							<ChevronRight size={16} aria-hidden="true" className="shrink-0 text-[var(--base-texto-3)]" />
						</button>
					</li>
				))}
			</ul>
			<Gaveta aberta={!!aberta} onFechar={() => setAberta(null)} titulo={titulo} subtitulo={empresaNome}>
				{aberta === 'provedor' && <>
					<select aria-label="Provedor de voz" value={provedor} disabled={!podeTroncos || busy === 'provedor'}
						onChange={e => void ajustar('provedor', e.target.value, 'Provedor de voz salvo.')} className={sel}>
						{PROVEDORES_VOZ.map(p => <option key={p.id} value={p.id}>{p.nome}{p.id === 'montagem_motorcx' ? ' (padrão)' : ''}</option>)}
					</select>
					<p className="text-[12.5px] leading-relaxed text-[var(--base-texto-2)]">{provInfo?.desc}{provedor === 'simulador' && modo !== 'simulado' ? ' O Simulador só vale no modo Simulado.' : ''}</p>
					<ListaValores itens={[['Agente no provedor', config?.agent_id ? String(config.agent_id) : 'Ainda não sincronizado'], ['Voz', config?.voz_id ? String(config.voz_id) : '—']]} />
				</>}
				{aberta === 'pico' && <>
					<select aria-label="Pico acima do limite" value={String(pico)} disabled={!podeTroncos || busy === 'pico_multiplo'}
						onChange={e => void ajustar('pico_multiplo', Number(e.target.value), 'Pico salvo.')} className={sel}>
						<option value="1">Desligado (padrão)</option>
						<option value="2">Até 2× · máx. {inteiro(tetoDe(2))}</option>
						<option value="3">Até 3× · máx. {inteiro(tetoDe(3))}</option>
					</select>
					<p className="text-[12.5px] leading-relaxed text-[var(--base-texto-2)]">{pico <= 1 ? `Sem pico: a empresa nunca passa de ${inteiro(limite)}.` : `Até ${inteiro(tetoDe(pico))} ao mesmo tempo. O minuto de IA acima de ${inteiro(limite)} custa o dobro e aparece como item próprio na fatura do MotorCX.${tetoDe(pico) < limite * pico ? ` Travado nos ${inteiro(canais)} canais do tronco.` : ''}`}</p>
				</>}
				{aberta === 'alo' && <>
					<select aria-label="Alô fake" value={aloLib ? '1' : '0'} disabled={!podeTroncos || busy === 'alo_fake_liberado'}
						onChange={e => void ajustar('alo_fake_liberado', e.target.value === '1', e.target.value === '1' ? 'Alô fake liberado para a empresa.' : 'Alô fake não liberado. Se estava ligado na empresa, foi desligado.')} className={sel}>
						<option value="0">Não liberado (padrão)</option>
						<option value="1">Liberado para a empresa</option>
					</select>
					<p className="text-[12.5px] leading-relaxed text-[var(--base-texto-2)]">A equipe libera; quem liga, desliga e define o tempo máximo é a empresa, em Canais › Agente virtual.</p>
				</>}
				{aberta === 'numeros' && <p className="text-[13px] text-[var(--base-texto-2)]">{nTeste === 0 ? 'Nenhum número de teste cadastrado.' : `${inteiro(nTeste)} cadastrado(s).`} Guardamos só o hash. Trocar exige a permissão de troncos de voz.</p>}
				{aberta === 'bucket' && <>
					<div className="flex flex-wrap items-center gap-2">
						<input aria-label="Bucket de gravações" value={bucket} disabled={!podeTroncos} onChange={e => setBucket(e.target.value.toLowerCase())} placeholder="motorcx-voz-empresa" className={`${campoCls} h-9 min-w-0 flex-1 font-mono text-[13px]`} />
						{podeTroncos && <button onClick={() => void ajustar('bucket_gravacoes', bucket.trim() || null, 'Bucket de gravações salvo.')} disabled={busy === 'bucket_gravacoes' || bucket.trim() === String(config?.bucket_gravacoes ?? '') || (!!bucket.trim() && !/^[a-z0-9][a-z0-9_.-]{1,61}[a-z0-9]$/.test(bucket.trim()))} className={btnSec}>Salvar</button>}
					</div>
					<p className="text-[12.5px] leading-relaxed text-[var(--base-texto-2)]">Só o nome. Um bucket por empresa, em São Paulo, com o ciclo de vida da retenção dela.</p>
				</>}
			</Gaveta>
		</Cartao>
	);
}

// ---------------------------------------------------------------- troncos
function situacaoTronco(t: Row): { tom: 'ok' | 'erro' | 'neutro' | 'atencao'; txt: string } {
	if (t.ativo === false) return { tom: 'neutro', txt: 'Inativo' };
	if (t.teste_ok === true) return { tom: 'ok', txt: `No ar · teste ${t.testado_em ? dateTimeBR(t.testado_em) : ''}`.trim() };
	if (t.teste_ok === false) return { tom: 'erro', txt: `Teste falhou${t.testado_em ? ` · ${dateTimeBR(t.testado_em)}` : ''}` };
	return { tom: 'atencao', txt: 'Aguardando teste' };
}
const autenticacaoTxt = (t: Row) => t.autenticacao === 'senha'
	? <>Usuário e senha · <span className="font-mono">{String(t.segredo_ref)}</span> no cofre</>
	: <>Por IP</>;
const formatoTxt = (t: Row) => {
	const f = FORMATOS_DISCAGEM.find(x => x.id === t.formato_discagem)?.nome ?? String(t.formato_discagem ?? '');
	return t.csp ? `${f} · CSP ${String(t.csp)}` : f;
};

function Troncos({ troncos, pausas, podeTroncos, onNovo, onEditar, onRetomado }: { troncos: Row[]; pausas: Pausa[]; podeTroncos: boolean; onNovo: () => void; onEditar: (t: Row) => void; onRetomado: () => void }) {
	const ativos = troncos.filter(t => t.ativo !== false);
	const [sel, setSel] = useState<Row | null>(null);
	const [retomar, setRetomar] = useState<Pausa | null>(null);
	const [nota, setNota] = useState('');
	const [busy, setBusy] = useState(false);
	const pausaDe = (t: Row) => pausas.find(p => String(p.tronco_id) === String(t.id)) ?? null;
	const situacao = (t: Row) => {
		const p = pausaDe(t);
		if (p) return { tom: (p.motivo === 'bloqueio_originacao' ? 'erro' : 'atencao') as 'erro' | 'atencao', txt: `Pausado · ${MOTIVO_PAUSA[p.motivo] ?? p.motivo}` };
		const x = situacaoTronco(t);
		return { tom: x.tom, txt: x.tom === 'ok' ? 'No ar' : x.txt };
	};
	const notaOk = nota.trim().length >= 3 && nota.trim().length <= 300 && !textoTemDadoPessoal(nota);
	async function confirmarRetomar() {
		if (!supabase || !retomar || !notaOk) return;
		setBusy(true);
		const { error } = await supabase.rpc('retomar_tronco_voz', { pausa: retomar.id, nota: nota.trim() });
		setBusy(false);
		if (error) { toast.error(erroRpc(error)); return; }
		setRetomar(null); setNota(''); setSel(null);
		onRetomado();
	}
	const selPausa = sel ? pausaDe(sel) : null;
	return (
		<Cartao semPad titulo="Troncos SIP da empresa"
			desc="A empresa contrata as operadoras dela; o Asterisk do MotorCX disca por esses troncos e liga o agente de IA quando a pessoa atende."
			acoes={<>
				<SeloRegras rotulo="Rede e cobrança" regras={[
					{ titulo: <>IPs de saída do MotorCX: <span className="font-mono">{IPS_SAIDA_MOTORCX[0]}</span> e <span className="font-mono">{IPS_SAIDA_MOTORCX[1]}</span></>, texto: 'IPs fixos do Asterisk em São Paulo. A operadora que autentica por IP só precisa liberar estes dois; as que pedem usuário e senha têm a senha no cofre.' },
					{ titulo: 'Serviço pago ao MotorCX: cadastro e gestão do tronco SIP', texto: 'Item "Gestão de tronco SIP" na fatura mensal. O minuto de telefonia a empresa paga direto à operadora; aqui ele só aparece como estimativa.' },
				]} />
				{podeTroncos ? <button onClick={onNovo} className={btnSec}><Plus size={15} /> Novo tronco</button> : <Cadeado>{SEM_PERM_TRONCOS} cadastra</Cadeado>}
			</>}>
			{pausas.length > 0 && <div className="px-5 pb-3 sm:px-6">
				<AvisoDs tom={pausas.some(p => p.motivo === 'bloqueio_originacao') ? 'erro' : 'atencao'} titulo={pausas.length === 1 ? 'Uma rota está pausada e não disca.' : `${pausas.length} rotas estão pausadas e não discam.`}>
					A VM parou de discar por {pausas.length === 1 ? 'este tronco' : 'estes troncos'} ({pausas.map(p => MOTIVO_PAUSA[p.motivo] ?? p.motivo).join(', ')}). Resolva com a operadora e retome a rota no tronco.
				</AvisoDs>
			</div>}
			<Tabela rotulo="Troncos" linhas={troncos} chave={t => String(t.id)} onAbrir={setSel} selecionada={sel ? String(sel.id) : null}
				vazio={<Vazio titulo="Nenhum tronco cadastrado">Sem tronco, o agente só funciona no modo Simulado. Cadastre o primeiro com os dados do contrato da empresa com a operadora.</Vazio>}
				colunas={[
					{ id: 'ref', titulo: 'Tronco', celula: t => <span className={`font-mono ${t.ativo === false ? 'opacity-60' : ''}`}>{String(t.referencia)}</span> },
					{ id: 'op', titulo: 'Operadora', celula: t => String(t.operadora) },
					{ id: 'can', titulo: 'Canais', num: true, celula: t => inteiro(t.canais) },
					{ id: 'cps', titulo: 'CPS', num: true, celula: t => inteiro(t.cps) },
					{ id: 'sit', titulo: 'Situação', celula: t => { const x = situacao(t); const p = pausaDe(t); return <span><Pilula tom={x.tom}>{x.txt}</Pilula>{p && <small className="block text-[11.5px] text-[var(--base-texto-3)]">desde {dateTimeBR(p.pausado_em)}</small>}</span>; } },
				]}
				celular={t => { const x = situacao(t); const p = pausaDe(t); return { titulo: <span className="font-mono">{String(t.referencia)}</span>, valor: <Pilula tom={x.tom}>{p ? 'Pausado' : x.txt}</Pilula>, resumo: p ? `${MOTIVO_PAUSA[p.motivo] ?? p.motivo} · desde ${dateTimeBR(p.pausado_em)}` : `${String(t.operadora)} · ${inteiro(t.canais)} canais` }; }}
				rodape={<><span>Total dos troncos ativos</span><span className="tnum">{inteiro(ativos.reduce((x, t) => x + Number(t.canais ?? 0), 0))} canais · {inteiro(ativos.reduce((x, t) => x + Number(t.cps ?? 0), 0))} CPS</span></>} />
			<Gaveta aberta={!!sel} onFechar={() => setSel(null)} titulo={sel ? `Tronco ${String(sel.referencia)}` : ''} subtitulo={sel ? situacao(sel).txt : undefined}
				rodape={podeTroncos && sel ? <>
					<button type="button" onClick={() => { const t = sel; setSel(null); onEditar(t); }} className={selPausa ? btnSec : btnPrim}><Pencil size={14} /> Editar</button>
					{selPausa && <button type="button" onClick={() => { setNota(''); setRetomar(selPausa); }} className={btnPrim}>Retomar rota</button>}
				</> : undefined}>
				{selPausa && <AvisoDs tom={selPausa.motivo === 'bloqueio_originacao' ? 'erro' : 'atencao'} titulo={`Pausado por ${MOTIVO_PAUSA[selPausa.motivo] ?? selPausa.motivo}`}>
					Desde {dateTimeBR(selPausa.pausado_em)}{selPausa.causa_sip ? ` (resposta SIP ${selPausa.causa_sip})` : ''}. A VM não disca por este tronco até alguém da equipe retomar.{!podeTroncos ? ` ${SEM_PERM_TRONCOS} retoma.` : ''}
				</AvisoDs>}
				{sel && <ListaValores itens={[
					['Operadora', String(sel.operadora)],
					['Endereço', <span key="e" className="break-all font-mono text-[12.5px]">{String(sel.host)}:{String(sel.porta)} · {String(sel.transporte).toUpperCase()}</span>],
					['Autenticação', autenticacaoTxt(sel)],
					['Bina', <span key="b" className="tnum">{binaMascara(sel.bina)}</span>],
					['DDD de origem', String(sel.ddd_origem)],
					['Discagem', formatoTxt(sel)],
					['Canais · CPS', `${inteiro(sel.canais)} · ${inteiro(sel.cps)}`],
				]} />}
			</Gaveta>
			{retomar && (
				<Dialogo titulo="Retomar a rota?" onClose={() => !busy && setRetomar(null)}
					texto="A VM volta a discar por este tronco no próximo minuto, sem reiniciar nada. Fica registrado quem retomou, quando e a nota."
					acoes={<>
						<button onClick={() => setRetomar(null)} disabled={busy} className={btnSec}>Cancelar</button>
						<button onClick={() => void confirmarRetomar()} disabled={busy || !notaOk} className={btnPrim}>{busy ? 'Retomando...' : 'Retomar rota'}</button>
					</>}>
					<label htmlFor="nota-retomar" className="mb-1 block text-[13px] font-semibold text-[var(--base-texto)]">O que foi resolvido</label>
					<textarea id="nota-retomar" value={nota} onChange={e => setNota(e.target.value)} rows={3} maxLength={300} placeholder="Ex.: crédito recarregado com a operadora."
						className="w-full resize-none rounded-lg border border-[var(--base-field-border)] bg-[var(--base-cartao)] px-3 py-2 text-[14px] text-[var(--base-texto)] outline-none focus:border-[var(--destaque)]" />
					<p className="mt-1 text-[12px] tnum" style={{ color: textoTemDadoPessoal(nota) ? 'var(--estado-erro-texto)' : 'var(--base-texto-3)' }}>{textoTemDadoPessoal(nota) ? 'Tire o CPF, telefone ou e-mail da nota.' : `${nota.trim().length}/300 · mínimo 3 caracteres · sem CPF, telefone ou e-mail`}</p>
				</Dialogo>
			)}
		</Cartao>
	);
}

// ---------------------------------------------------------------- rotas e calculadora
function Rotas({ rotas, troncos, saude, podeTroncos, onNova, onEncerrada }: {
	rotas: Row[]; troncos: Row[]; saude: Row[]; podeTroncos: boolean; onNova: (base: Row | null, prefixo?: string) => void; onEncerrada: () => void;
}) {
	const hoje = today();
	const [hist, setHist] = useState(false);
	const [encerrar, setEncerrar] = useState<Row | null>(null);
	const [ate, setAte] = useState(hoje);
	const [busy, setBusy] = useState(false);
	const [sel, setSel] = useState<{ r: Row; sit: 'vigor' | 'futura' | 'encerrada' } | null>(null);
	const [como, setComo] = useState(false);
	const vigentes = rotas.filter(r => r.vigente_desde <= hoje && (!r.vigente_ate || r.vigente_ate >= hoje))
		.sort((a, b) => String(a.tipo).localeCompare(String(b.tipo)) || Number(a.prioridade) - Number(b.prioridade));
	const futuras = rotas.filter(r => r.vigente_desde > hoje);
	const encerradas = rotas.filter(r => r.vigente_ate && r.vigente_ate < hoje);
	const prefixosVigentes = new Set(vigentes.map(r => String(r.tech_prefix)));
	const semCadastro = saude.filter(s => s.item === 'rota_sem_cadastro' && s.ok === false && !prefixosVigentes.has(String(s.referencia)));
	const refTronco = (id: unknown) => String(troncos.find(t => String(t.id) === String(id))?.referencia ?? '—');

	async function confirmarEncerrar() {
		if (!supabase || !encerrar) return;
		setBusy(true);
		const { error } = await supabase.rpc('encerrar_rota_voz', { rota: Number(encerrar.id), ate });
		setBusy(false);
		if (error) { toast.error(erroRpc(error)); return; }
		setEncerrar(null); setSel(null);
		onEncerrada();
	}

	type Linha = { r: Row; sit: 'vigor' | 'futura' | 'encerrada' };
	const lista: Linha[] = [...vigentes.map(r => ({ r, sit: 'vigor' as const })), ...futuras.map(r => ({ r, sit: 'futura' as const })), ...(hist ? encerradas.map(r => ({ r, sit: 'encerrada' as const })) : [])];
	const pilula = (l: Linha) => l.sit === 'vigor' ? <Pilula tom="ok">Em vigor</Pilula> : l.sit === 'futura' ? <Pilula tom="info">A partir de {dateBR(l.r.vigente_desde)}</Pilula> : <Pilula>Encerrada</Pilula>;
	const somaSem = semCadastro.reduce((t, x) => t + Number(x.contagem ?? 0), 0);

	return (
		<Cartao semPad titulo="Rotas"
			desc="O tipo do número escolhe a rota; a rota diz por qual tronco sai e qual prefixo vai na frente. Se a 1ª falhar ou estiver cheia, sai pela 2ª."
			acoes={<>
				<button type="button" onClick={() => setComo(true)} className={btnLink}>Como é tarifado</button>
				{podeTroncos ? <button onClick={() => onNova(null)} disabled={troncos.every(t => t.ativo === false)} className={btnSec}><Plus size={15} /> Nova rota</button> : <Cadeado>{SEM_PERM_TRONCOS} cadastra</Cadeado>}
			</>}>
			{semCadastro.length > 0 && <div className="px-5 pb-3 sm:px-6">
				<AvisoDs titulo={`${semCadastro.length === 1 ? `Prefixo ${String(semCadastro[0].referencia)}` : `${semCadastro.length} prefixos`} sem rota cadastrada:`}
					acao={podeTroncos ? <button onClick={() => onNova(null, String(semCadastro[0].referencia))} className={btnLink}>Cadastrar a rota {String(semCadastro[0].referencia)}</button> : undefined}>
					{inteiro(somaSem)} tentativa{somaSem === 1 ? '' : 's'} sem custo calculado. O sistema não inventa preço.
				</AvisoDs>
			</div>}
			<Tabela rotulo="Rotas" linhas={lista} chave={l => String(l.r.id)} onAbrir={l => setSel(l)} selecionada={sel ? String(sel.r.id) : null}
				vazio={rotas.length === 0 ? <Vazio titulo="Nenhuma rota cadastrada">{troncos.length === 0 ? 'Cadastre um tronco primeiro. Depois, uma rota por tipo de número.' : 'Cadastre uma rota por tipo de número, com o prefixo, a cadência e o preço do contrato.'}</Vazio> : 'Nenhuma rota em vigor hoje.'}
				colunas={[
					{ id: 'pre', titulo: 'Prefixo', celula: l => <span className={`font-mono ${l.sit === 'encerrada' ? 'opacity-70' : ''}`}>{String(l.r.tech_prefix)}</span> },
					{ id: 'tipo', titulo: 'Tipo', celula: l => TIPOS_ROTA[String(l.r.tipo)] ?? String(l.r.tipo) },
					{ id: 'tr', titulo: 'Tronco e prioridade', celula: l => <><span className="font-mono text-[12.5px]">{refTronco(l.r.tronco_id)}</span> · {String(l.r.prioridade)}ª</> },
					{ id: 'preco', titulo: 'Preço/min', num: true, celula: l => reais(l.r.preco_minuto, 3) },
					{ id: 'sit', titulo: 'Situação', celula: pilula },
				]}
				celular={l => ({ titulo: <><span className="font-mono">{String(l.r.tech_prefix)}</span> · {TIPOS_ROTA[String(l.r.tipo)] ?? ''}</>, valor: pilula(l), resumo: `${refTronco(l.r.tronco_id)} · ${String(l.r.prioridade)}ª · ${reais(l.r.preco_minuto, 3)}/min` })}
				rodape={rotas.length > 0 ? <><span>Mudou preço ou cadência? Crie uma nova vigência: as chamadas antigas mantêm o preço do dia.</span>{encerradas.length > 0 && <button onClick={() => setHist(h => !h)} className={btnLink}>{hist ? 'Esconder histórico' : `Ver histórico (${encerradas.length})`}</button>}</> : undefined} />

			<Gaveta aberta={!!sel} onFechar={() => setSel(null)} titulo={sel ? `Prefixo ${String(sel.r.tech_prefix)}` : ''} subtitulo={sel ? TIPOS_ROTA[String(sel.r.tipo)] : undefined}
				rodape={podeTroncos && sel && sel.sit !== 'encerrada' ? <>
					<button type="button" onClick={() => { setEncerrar(sel.r); setAte(hoje); }} className={btnSec}>Encerrar</button>
					<button type="button" onClick={() => { const r = sel.r; setSel(null); onNova(r); }} className={btnPrim}>Nova vigência</button>
				</> : undefined}>
				{sel && <>
					<div>{pilula(sel)}</div>
					<ListaValores itens={[
						['Tronco', refTronco(sel.r.tronco_id)], ['Prioridade', `${String(sel.r.prioridade)}ª`],
						['Cadência', cadenciaTxt(sel.r.cadencia_inicial_s, sel.r.cadencia_incremento_s)], ['Preço do minuto', reais(sel.r.preco_minuto, 3)],
						['Vigência', `${dateBR(sel.r.vigente_desde)} → ${sel.r.vigente_ate ? dateBR(sel.r.vigente_ate) : 'em vigor'}`],
					]} />
					<p className="text-[12.5px] text-[var(--base-texto-2)]">Cadência e preço são do contrato com a operadora e servem só para a empresa ver o custo de telefonia: não entram na fatura do MotorCX.</p>
				</>}
			</Gaveta>
			<Gaveta aberta={como} onFechar={() => setComo(false)} titulo="Como a ligação é tarifada"><Calculadora vigentes={vigentes} /></Gaveta>

			{encerrar && (
				<Dialogo titulo={`Encerrar a rota ${String(encerrar.tech_prefix)}`} onClose={() => !busy && setEncerrar(null)}
					texto="A rota deixa de valer depois do dia escolhido e vai para o histórico. Tentativas depois disso, sem outra rota, ficam sem custo e geram alerta."
					acoes={<>
						<button onClick={() => setEncerrar(null)} disabled={busy} className={btnSec}>Cancelar</button>
						<button onClick={() => void confirmarEncerrar()} disabled={busy || !ate || ate < String(encerrar.vigente_desde)} className={btnPrim}>{busy ? 'Encerrando...' : 'Encerrar'}</button>
					</>}>
					<label htmlFor="voz-ate" className="mb-1 block text-[13px] font-semibold text-[var(--base-texto)]">Último dia da rota</label>
					<input id="voz-ate" type="date" value={ate} min={String(encerrar.vigente_desde)} onChange={e => setAte(e.target.value)} className={`${campoCls} tnum`} />
				</Dialogo>
			)}
		</Cartao>
	);
}

function Calculadora({ vigentes }: { vigentes: Row[] }) {
	const opcoes = useMemo(() => {
		const m = new Map<string, { ini: number; inc: number; preco: number | null; rot: string }>();
		vigentes.forEach(r => {
			const k = `r${String(r.id)}`;
			m.set(k, { ini: Number(r.cadencia_inicial_s), inc: Number(r.cadencia_incremento_s), preco: Number(r.preco_minuto), rot: `${String(r.tech_prefix)} · ${TIPOS_ROTA[String(r.tipo)] ?? ''} · ${cadenciaTxt(r.cadencia_inicial_s, r.cadencia_incremento_s)}` });
		});
		for (const [ini, inc] of [[30, 6], [60, 60], [1, 1]]) m.set(`c${ini}/${inc}`, { ini, inc, preco: null, rot: `${ini}/${inc}` });
		return [...m.entries()];
	}, [vigentes]);
	const [seg, setSeg] = useState('47');
	const [op, setOp] = useState(opcoes[0]?.[0] ?? 'c30/6');
	const esc = opcoes.find(o => o[0] === op)?.[1] ?? { ini: 30, inc: 6, preco: null, rot: '30/6' };
	const s = Math.max(0, Number(seg) || 0);
	const t = segundosTarifados(s, esc.ini, esc.inc);

	return (
		<div>
			<Subtitulo desc="Sem carência: qualquer segundo atendido é cobrado pela operadora. Até o mínimo inicial, cobra o mínimo; depois, de incremento em incremento.">Como a ligação é tarifada</Subtitulo>
			<div className="flex flex-wrap items-center gap-2 text-[13.5px] text-[var(--base-texto)]">
				<label className="flex items-center gap-2">Atendida por
					<input aria-label="Segundos atendidos" value={seg} inputMode="numeric" onChange={e => setSeg(e.target.value.replace(/\D/g, '').slice(0, 5))} className="h-9 w-[72px] rounded-lg border border-[var(--base-field-border)] px-2 text-right text-[14px] outline-none tnum focus:border-[var(--destaque)]" /> s
				</label>
				<label className="flex min-w-0 items-center gap-2">em
					<select aria-label="Cadência" value={op} onChange={e => setOp(e.target.value)} className="h-9 min-w-0 max-w-[260px] rounded-lg border border-[var(--base-field-border)] px-2 text-[13.5px] outline-none focus:border-[var(--destaque)]">
						{opcoes.map(([k, o]) => <option key={k} value={k}>{o.rot}</option>)}
					</select>
				</label>
				<b className="tnum">= {inteiro(t)} s tarifados{esc.preco != null ? ` · ${reais(custoVoz(t, esc.preco), 4)}` : ''}</b>
			</div>
			<p className="mt-2 text-[12px] leading-relaxed text-[var(--base-texto-3)]">
				Exemplos em 30/6: 47 s viram {segundosTarifados(47, 30, 6)} s (30 + 3 × 6) · 2 s viram {segundosTarifados(2, 30, 6)} s (o mínimo inicial) · 0 s (não atendeu) não é tarifado. Custo estimado = segundos tarifados ÷ 60 × preço do minuto da vigência do dia.
			</p>
		</div>
	);
}

// ---------------------------------------------------------------- transferência
function Transferencia({ atual, troncos, podeTroncos, onEditar }: { atual: Row | null; troncos: Row[]; podeTroncos: boolean; onEditar: () => void }) {
	const tronco = atual?.tronco_id != null ? troncos.find(t => String(t.id) === String(atual.tronco_id)) : null;
	return (
		<Cartao titulo="Transferência para o discador do cliente" desc="Para onde o agente manda a chamada quando precisa de um operador. A equipe MotorCX configura."
			acoes={podeTroncos ? <button onClick={onEditar} className={btnSec}>{atual ? <><Pencil size={14} /> Editar</> : <><Plus size={15} /> Configurar</>}</button> : <Cadeado>{SEM_PERM_TRONCOS} configura</Cadeado>}>
			{!atual ? (
				<Vazio titulo="Sem transferência configurada">Sem destino, o agente não passa a chamada para um operador. Configure o endereço SIP da fila do discador da empresa.</Vazio>
			) : (
				<div className="space-y-3">
					<ListaValores itens={[
						['Destino SIP', <span key="d" className="break-all font-mono text-[12.5px]">{String(atual.destino_sip)}</span>],
						['Tronco', <span key="t" className="font-mono">{tronco ? String(tronco.referencia) : '—'}</span>],
						['Último teste', <span key="u" className="inline-flex items-center gap-2">{atual.testado_em ? <><Ponto tom={atual.teste_ok ? 'ok' : 'erro'} /> {dateTimeBR(atual.testado_em)} · {atual.teste_ok ? 'operador atendeu' : 'falhou'}</> : <><Ponto tom="atencao" /> Aguardando o teste</>}</span>],
						['Nunca vai', 'CPF, nome, valor ou transcrição'],
					]} />
					<Detalhes resumo="Detalhes técnicos">
						<ListaValores itens={[
							['Como', atual.metodo === 'ponte' ? 'Nova chamada pelo tronco e ponte' : 'SIP REFER (sem REFER: nova chamada e ponte)'],
							['Prefixo', atual.tech_prefix ? <span key="p" className="font-mono">{String(atual.tech_prefix)}</span> : '—'],
							['Cabeçalhos enviados', <span key="c" className="font-mono text-[12.5px]">{(Array.isArray(atual.cabecalhos) ? atual.cabecalhos as string[] : []).join(' · ') || '—'}</span>],
						]} />
					</Detalhes>
				</div>
			)}
		</Cartao>
	);
}

// ---------------------------------------------------------------- Simulado → Só números de teste → Real
function LigarDeVerdade({ empresaId, empresaNome, d, modo, podeLigar, divisaoLinha, onFeito }: {
	empresaId: string; empresaNome: string; d: DadosEmpresa; modo: string; podeLigar: boolean; divisaoLinha: Row | null; onFeito: () => void;
}) {
	const [confirma, setConfirma] = useState<'teste' | 'real' | 'simulado' | null>(null);
	const [devolver, setDevolver] = useState(false);
	const [motivo, setMotivo] = useState('');
	const [busy, setBusy] = useState(false);
	const hoje = today();
	const c = d.config;
	const nTeste = Array.isArray(c?.numeros_teste_hash) ? (c!.numeros_teste_hash as unknown[]).length : 0;
	const troncoOk = d.troncos.find(t => t.ativo !== false && t.teste_ok === true);
	const rotaOk = d.rotas.some(r => !r.vigente_ate || r.vigente_ate >= hoje);
	const grava = c ? c.gravar !== false : true;

	// Mesmos itens de falta_para_voz no banco (o banco confere de novo ao ligar).
	const itens: { id: string; txt: string; sub: string; ok: boolean; para: 'teste' | 'real' }[] = [
		{ id: 'prov', txt: 'Provedor de voz escolhido', sub: c && c.provedor !== 'simulador' ? PROVEDORES_VOZ.find(p => p.id === c.provedor)?.nome ?? String(c.provedor) : 'Ainda no Simulador', ok: !!c && c.provedor !== 'simulador', para: 'teste' },
		{ id: 'rot', txt: `Roteiro aprovado pela ${empresaNome} e em uso`, sub: d.roteiro ? `v${String(d.roteiro.versao)} · em uso desde ${dateBR(d.roteiro.em_uso_em)}` : 'Nenhuma versão em uso', ok: !!d.roteiro, para: 'teste' },
		{ id: 'tro', txt: 'Tronco ativo e testado', sub: troncoOk ? `${String(troncoOk.referencia)} · teste ${dateTimeBR(troncoOk.testado_em)}` : 'Nenhum tronco com teste ok', ok: !!troncoOk, para: 'teste' },
		{ id: 'rota', txt: 'Rota cadastrada', sub: rotaOk ? `${d.rotas.filter(r => !r.vigente_ate || r.vigente_ate >= hoje).length} em vigor ou programada(s)` : 'Nenhuma rota em vigor', ok: rotaOk, para: 'teste' },
		{ id: 'buc', txt: 'Bucket de gravações da empresa', sub: !grava ? 'A empresa não grava' : c?.bucket_gravacoes ? String(c.bucket_gravacoes) : 'Sem bucket', ok: !grava || !!c?.bucket_gravacoes, para: 'teste' },
		{ id: 'num', txt: 'Números de teste cadastrados', sub: nTeste ? `${nTeste} (só o hash)` : 'Nenhum', ok: nTeste > 0, para: 'teste' },
		{ id: 'pas', txt: 'Passou por Só números de teste', sub: modo === 'simulado' ? 'Ainda em Simulado' : 'Feito', ok: modo !== 'simulado', para: 'real' },
		{ id: 'lig', txt: 'Ligação de teste feita', sub: d.ligacoesTeste ? `${inteiro(d.ligacoesTeste)} ligação(ões) de teste` : 'Nenhuma ligação de teste ainda', ok: d.ligacoesTeste > 0, para: 'real' },
		{ id: 'fat', txt: 'Quem recebe as faturas cadastrado', sub: d.recebeFaturas ? 'Empresa › Contatos' : 'Ninguém marcado em Empresa › Contatos', ok: d.recebeFaturas > 0, para: 'real' },
	];
	const okTeste = itens.filter(i => i.para === 'teste').every(i => i.ok);
	const okReal = itens.every(i => i.ok);
	const ordem = ['simulado', 'teste', 'real'];

	async function mudar(para: 'teste' | 'real' | 'simulado') {
		if (!supabase) return;
		setBusy(true);
		const { error } = await supabase.rpc('ligar_voz_real', { empresa: Number(empresaId), modo: para });
		setBusy(false);
		if (error) { toast.error(erroRpc(error)); return; }
		setConfirma(null);
		toast.success(para === 'real' ? 'Ligações reais ligadas. A empresa recebe o aviso no sino.' : para === 'teste' ? 'Agora só os números de teste recebem ligações.' : 'Voltou para o Simulado: nada liga de verdade.');
		onFeito();
	}
	async function recusar() {
		if (!supabase) return;
		setBusy(true);
		const { error } = await supabase.rpc('recusar_voz_real', { empresa: Number(empresaId), motivo: motivo.trim() });
		setBusy(false);
		if (error) { toast.error(erroRpc(error)); return; }
		setDevolver(false); setMotivo('');
		toast.success('Devolvido ao cliente. O chamado ficou "Aguardando cliente".');
		onFeito();
	}

	const textoConfirma = confirma === 'real'
		? `A partir da próxima onda, o agente liga para a Lista do dia da ${empresaNome} dentro das janelas por UF e DDD. Cada minuto de IA entra na fatura do MotorCX; o minuto de telefonia a empresa paga à operadora. A empresa recebe um aviso no sino.`
		: confirma === 'teste'
			? `O agente passa a ligar de verdade, mas só para os ${nTeste} número(s) de teste da equipe. A Lista do dia da ${empresaNome} não recebe ligação.`
			: 'Nada mais liga de verdade: o Simulador responde. As ligações em curso terminam normalmente.';

	const iAtual = Math.max(0, ordem.indexOf(modo));
	const modoInfo = MODOS_VOZ.find(m => m.id === modo);
	const faltam = itens.filter(i => !i.ok && (modo === 'simulado' ? i.para === 'teste' : true));
	const prontos = itens.filter(i => i.ok).length;
	const noAr = d.troncos.filter(t => t.ativo !== false && t.teste_ok === true && !d.pausas.some(p => String(p.tronco_id) === String(t.id))).length;
	const falta = faltam.length ? `falta: ${faltam.map(f => f.txt.toLowerCase()).join(', ')}` : '';
	const acao = !podeLigar ? <Cadeado>{SEM_PERM_LIGAR}</Cadeado>
		: modo === 'simulado' ? <button onClick={() => setConfirma('teste')} disabled={!okTeste} title={okTeste ? undefined : falta} className={btnPrim}>Passar para Só números de teste</button>
		: modo === 'teste' ? <button onClick={() => setConfirma('real')} disabled={!okReal} title={okReal ? undefined : falta} className={btnPrim}>Ligar ligações reais</button>
		: <Pilula tom="ok">Ligações reais ligadas{c?.atualizado_em ? ` em ${dateTimeBR(c.atualizado_em)}` : ''}</Pilula>;

	return (
		<>
			<Cartao titulo="Caminho até as ligações reais" desc={modoInfo?.desc} acoes={acao}>
				<Passos rotulo="Modo do agente" passos={MODOS_VOZ.map(m => m.nome)} atual={iAtual} />
				{podeLigar && modo !== 'real' && faltam.length > 0 && <p className="mt-3 text-[12.5px] text-[var(--base-texto-2)]">O botão libera quando a lista abaixo estiver completa ({falta}). Isso é conferido no banco, não só na tela.</p>}
				{podeLigar && modo !== 'simulado' && <button type="button" onClick={() => setConfirma('simulado')} className="mt-3 text-[13px] font-semibold text-[var(--base-texto-2)] hover:underline">Voltar para Simulado</button>}
			</Cartao>
			<Kpis itens={[
				{ rotulo: 'Modo agora', valor: modoInfo?.nome ?? 'Simulado', tom: modo === 'real' ? 'ok' : undefined },
				{ rotulo: 'Lista pronta', valor: `${prontos} de ${itens.length}`, tom: prontos < itens.length ? 'atencao' : 'ok' },
				{ rotulo: 'Troncos no ar', valor: `${inteiro(noAr)} de ${inteiro(d.troncos.length)}`, tom: d.troncos.length && !noAr ? 'alerta' : undefined },
				{ rotulo: 'Ao mesmo tempo', valor: divisaoLinha ? inteiro(divisaoLinha.limite) : '—', detalhe: divisaoLinha ? `pelos ${inteiro(divisaoLinha.canais)} canais do tronco` : 'precisa de um tronco ativo' },
			]} />
			<Cartao titulo="Antes de ligar de verdade" desc="Os mesmos itens que o banco confere ao mudar de modo.">
				<ul className="space-y-2">
					{itens.map(i => (
						<li key={i.id} className="flex items-start gap-2.5">
							<span aria-hidden className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full text-[11px] font-bold" style={{ backgroundColor: i.ok ? 'var(--estado-pronto-fundo)' : 'var(--estado-atencao-fundo)', color: i.ok ? 'var(--estado-pronto-texto)' : 'var(--estado-atencao-texto)' }}>{i.ok ? '✓' : '!'}</span>
							<span className="min-w-0 text-[13.5px] text-[var(--base-texto)]">{i.txt}<span className="block text-[12px] text-[var(--base-texto-3)]">{i.sub}{i.para === 'real' ? ' · só para o Real' : ''}</span></span>
						</li>
					))}
				</ul>
				<div className="mt-4 border-t border-[var(--base-borda)] pt-3">
					<Subtitulo>Pedido do cliente</Subtitulo>
					<p className="text-[13px] leading-relaxed text-[var(--base-texto-2)]">{d.pedido
						? `A empresa pediu as ligações reais em ${dateTimeBR(d.pedido.pedido_em)}${d.pedido.chamado_id ? ` (chamado ${String(d.pedido.chamado_id)})` : ''}. Mesmo fluxo do "Ligar envio real" da Mensageria.`
						: modo === 'real' ? 'As ligações reais estão ligadas.' : 'Nenhum pedido em aberto. A empresa pede em Canais › Agente virtual quando a lista estiver pronta.'}</p>
					{podeLigar && d.pedido && modo !== 'real' && <button type="button" onClick={() => setDevolver(true)} className={`${btnLink} mt-2`}>Devolver ao cliente</button>}
				</div>
			</Cartao>

			{confirma && (
				<Dialogo titulo={confirma === 'real' ? `Ligar ligações reais da ${empresaNome}?` : confirma === 'teste' ? 'Passar para Só números de teste?' : 'Voltar para Simulado?'} texto={textoConfirma}
					onClose={() => !busy && setConfirma(null)}
					acoes={<>
						<button onClick={() => setConfirma(null)} disabled={busy} className={btnSec}>Cancelar</button>
						<button onClick={() => void mudar(confirma)} disabled={busy} className={btnPrim}>{busy ? 'Aguarde...' : confirma === 'real' ? 'Ligar ligações reais' : confirma === 'teste' ? 'Passar para teste' : 'Voltar para Simulado'}</button>
					</>} />
			)}
			{devolver && (
				<Dialogo titulo="Devolver ao cliente" texto="Diga o que falta. O texto vai para o chamado e o cliente vê esta frase." onClose={() => !busy && setDevolver(false)}
					acoes={<>
						<button onClick={() => setDevolver(false)} disabled={busy} className={btnSec}>Cancelar</button>
						<button onClick={() => void recusar()} disabled={busy || motivo.trim().length < 5} className={btnPrim}>Devolver</button>
					</>}>
					<textarea value={motivo} onChange={e => setMotivo(e.target.value)} rows={3} maxLength={400} autoFocus placeholder="Ex.: falta o teste com os números de teste."
						className="w-full resize-none rounded-lg border border-[var(--base-field-border)] px-3 py-2 text-[14px] outline-none focus:border-[var(--destaque)]" />
					<p className="mt-1 text-[12px] text-[var(--base-texto-3)] tnum">{motivo.length}/400 · mínimo 5 caracteres</p>
				</Dialogo>
			)}
		</>
	);
}

