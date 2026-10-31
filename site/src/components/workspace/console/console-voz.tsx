// Console › Fornecedores e rotas › Agente virtual (equipe MotorCX). Protótipo aprovado, tela 1, e SQL 56.
// Global: conexão do provedor (só se funciona, nunca a chave) e concorrência contratada dividida entre as empresas.
// Por empresa: provedor de voz, troncos SIP, IPs de saída, rotas com vigência (e o alerta de rota sem cadastro),
// calculadora de tarifação sem carência, transferência para o discador, pico, Alô fake e o caminho
// Simulado → Só números de teste → Real com o checklist. Troncos, rotas e configuração: gerenciar_troncos_voz.
// Ligar de verdade: ligar_voz_real. Quem não tem a permissão vê o cadeado.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Coins, KeyRound, Pencil, Phone, Plus, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import { useMotorAuth } from '@/components/auth-provider';
import { supabase, friendlyError, dateBR, dateTimeBR, today, type Row } from '@/lib/supabase';
import {
	FORMATOS_DISCAGEM, IPS_SAIDA_MOTORCX, MODOS_VOZ, PROVEDORES_VOZ, TIPOS_ROTA, binaMascara, cadenciaTxt, inteiro, reais,
	segundosTarifados, custoVoz,
} from '@/lib/voz';
import {
	Aviso, Cadeado, Cartao, Dialogo, Pilula, Ponto, Subtitulo, TabelaRolavel, Trava, Vazio, btnLink, btnPrim, btnSec, campoCls,
	tdCls, thCls,
} from '@/components/comuns/voz-ui';
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

	return (
		<div className="space-y-6">
			<div>
				<h2 className="text-[22px] font-bold tracking-tight text-[#1D1D1F]">Agente virtual</h2>
				<p className="mt-1 text-[14px] text-[#6E6E73]">Fornecedor do canal Agente virtual. A chave não aparece aqui, só se ela funciona.</p>
			</div>

			<ConexaoProvedor fornecedores={fornecedores} saude={saudeGlobal} loading={loading} />
			<Concorrencia divisao={divisao} contrato={contrato} nomeEmpresa={nomeEmpresa} podeTroncos={podeTroncos} loading={loading}
				onSalvo={() => void recarregarGlobal()} onEscolher={id => { setEmpresaId(id); document.getElementById('voz-empresa')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }} />

			<div id="voz-empresa" className="scroll-mt-4">
				<div className="mb-3 flex flex-wrap items-center gap-3">
					<label htmlFor="voz-emp" className="text-[13px] font-semibold text-[#6E6E73]">Empresa</label>
					<select id="voz-emp" value={empresaId} onChange={e => setEmpresaId(e.target.value)} className={`${campoCls} h-9 max-w-[320px] flex-1`}>
						{opcoesEmpresa.length === 0 && <option value="">Nenhuma empresa</option>}
						{opcoesEmpresa.map(o => <option key={o.id} value={o.id}>{o.nome}</option>)}
					</select>
				</div>
				{empresaId ? (
					<EmpresaVoz key={empresaId} empresaId={empresaId} empresaNome={nomeEmpresa(empresaId)}
						divisaoLinha={divisao.find(r => String(r.empresa_id) === empresaId) ?? null}
						podeTroncos={podeTroncos} podeLigar={podeLigar} onMudouTroncos={() => void recarregarGlobal()} />
				) : (
					<Vazio titulo="Nenhuma empresa para configurar">Quando houver empresa ativa, o agente virtual dela é configurado aqui.</Vazio>
				)}
			</div>
		</div>
	);
}

// ============================================================== conexão do provedor
function ConexaoProvedor({ fornecedores, saude, loading }: { fornecedores: Row[]; saude: Row[]; loading: boolean }) {
	return (
		<Cartao titulo="Conexão com o provedor (vale para todas as empresas)"
			desc="Quem digita a chave é o dono, direto no cofre (Google Secret Manager). Esta tela nunca recebe a chave: mostra só o nome no cofre e o resultado do último teste da VM.">
			{loading ? <p className="py-4 text-center text-[13px] text-[#8E8E93]">Carregando...</p> : fornecedores.length === 0 ? (
				<Vazio titulo="Nenhum provedor de voz cadastrado">O provedor do canal Agente virtual aparece aqui quando estiver em Fornecedores.</Vazio>
			) : (
				<div className="grid gap-3 md:grid-cols-2">
					{fornecedores.map(f => {
						const itens = saude.filter(s => s.fornecedor === f.codigo);
						const ruim = itens.some(s => s.ok === false);
						const tom = itens.length === 0 ? 'neutro' : ruim ? 'erro' : 'ok';
						return (
							<div key={String(f.codigo)} className="rounded-xl border border-[#E5E5EA] p-4">
								<div className="flex flex-wrap items-center justify-between gap-2">
									<span className="flex items-center gap-2 text-[15px] font-semibold text-[#1D1D1F]"><KeyRound size={15} className="text-[#6E6E73]" /> {String(f.nome)}</span>
									<Pilula tom={tom}>{itens.length === 0 ? 'Sem teste ainda' : ruim ? 'Com problema' : 'Funcionando'}</Pilula>
								</div>
								<p className="mt-1 text-[12.5px] text-[#6E6E73]">
									{f.segredo_ref ? <>Nome no cofre: <span className="font-mono">{String(f.segredo_ref)}</span></> : 'Sem segredo no cofre: as ligações ficam simuladas.'}
									{f.ativo === false && ' · desativado'}
								</p>
								{itens.length > 0 && (
									<ul className="mt-3 space-y-1.5">
										{itens.map((s, i) => (
											<li key={i} className="flex items-start gap-2 text-[13px]">
												<span className="mt-1.5"><Ponto tom={s.ok ? 'ok' : 'erro'} /></span>
												<span className="min-w-0">
													<b className="font-semibold text-[#1D1D1F]">{rotuloSaude(String(s.item))}</b>
													<span className="text-[#6E6E73]"> · {s.ok ? 'ok' : 'falhou'} · {dateTimeBR(s.verificado_em)}{s.detalhe ? ` · ${String(s.detalhe)}` : ''}</span>
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
			desc="Total de ligações ao mesmo tempo no contrato com o provedor de voz, dividido entre as empresas pelos canais dos troncos ativos de cada uma.">
			<div className="px-5 pb-2 sm:px-6">
				<div className="flex flex-wrap items-end gap-3">
					<div className="w-full max-w-[280px]">
						<label htmlFor="voz-contr" className="mb-1 block text-[13px] font-semibold text-[#1D1D1F]">Total contratado (ligações ao mesmo tempo)</label>
						<input id="voz-contr" value={valor} inputMode="numeric" disabled={!podeTroncos} onChange={e => setValor(e.target.value.replace(/\D/g, ''))} className={`${campoCls} tnum`} />
					</div>
					{podeTroncos ? (
						<button onClick={() => void salvar()} disabled={!mudou || busy} className={btnPrim}>{busy ? 'Salvando...' : 'Salvar'}</button>
					) : <Cadeado>{SEM_PERM_TRONCOS}</Cadeado>}
				</div>
				<p className="mt-1.5 text-[12px] text-[#8E8E93]">Mude quando o contrato com o provedor mudar. A divisão é refeita na hora.{contrato?.atualizado_em ? ` Última mudança: ${dateTimeBR(contrato.atualizado_em)}.` : ''}</p>
			</div>
			<div className="px-5 pb-4 pt-2 sm:px-6">
				{loading ? <p className="py-4 text-center text-[13px] text-[#8E8E93]">Carregando...</p> : linhas.length === 0 ? (
					<Vazio titulo="Nenhuma empresa com tronco ativo">A divisão aparece quando a primeira empresa tiver um tronco SIP ativo.</Vazio>
				) : (
					<TabelaRolavel minW={560}>
						<thead><tr>
							<th className={thCls}>Empresa</th><th className={`${thCls} text-right`}>Canais do tronco</th>
							<th className={`${thCls} text-right`}>Limite da empresa</th><th className={thCls}>Pico acima do limite</th>
						</tr></thead>
						<tbody>
							{linhas.map(r => {
								const pico = Number(r.pico_multiplo ?? 1);
								return (
									<tr key={String(r.empresa_id)}>
										<td className={tdCls}><button onClick={() => onEscolher(String(r.empresa_id))} className="text-left font-medium text-[#0A60D0] hover:underline">{nomeEmpresa(r.empresa_id)}</button></td>
										<td className={`${tdCls} text-right tnum`}>{inteiro(r.canais)}</td>
										<td className={`${tdCls} text-right font-semibold tnum`}>{inteiro(r.limite)}</td>
										<td className={tdCls}>{pico <= 1 ? 'Desligado' : `Até ${pico}× · máx. ${inteiro(r.teto)}`}</td>
									</tr>
								);
							})}
						</tbody>
						<tfoot><tr>
							<td className="py-2.5 pr-3 font-semibold text-[#1D1D1F]">Total</td>
							<td className="py-2.5 pr-3 text-right font-semibold text-[#1D1D1F] tnum">{inteiro(totCanais)}</td>
							<td className="py-2.5 pr-3 text-right font-semibold text-[#1D1D1F] tnum">{inteiro(totLimite)}</td><td />
						</tr></tfoot>
					</TabelaRolavel>
				)}
				<p className="mt-2 text-[12px] leading-relaxed text-[#8E8E93]">Limite da empresa = {inteiro(atual)} × canais dela ÷ {inteiro(totCanais)} canais no total. A sobra do arredondamento vai para as empresas com a maior fração. O pico é opção de cada empresa, vem desligado e nunca passa dos canais do tronco.</p>
				<Trava className="mt-3" icone={<Phone size={16} />} titulo='Quem liga é sempre o agente de IA. Se na transferência não houver operador livre no discador do cliente, a chamada é derrubada e registrada como "abandono".'>
					Nada fica em fila esperando. A taxa de abandono aparece em Ligações em curso e freia o lote quando passa do limite da empresa.
				</Trava>
			</div>
		</Cartao>
	);
}

// ============================================================== por empresa
type DadosEmpresa = {
	config: Row | null; troncos: Row[]; rotas: Row[]; transferencia: Row | null; saude: Row[]; pedido: Row | null;
	roteiro: Row | null; ligacoesTeste: number; recebeFaturas: number;
};

function EmpresaVoz({ empresaId, empresaNome, divisaoLinha, podeTroncos, podeLigar, onMudouTroncos }: {
	empresaId: string; empresaNome: string; divisaoLinha: Row | null; podeTroncos: boolean; podeLigar: boolean; onMudouTroncos: () => void;
}) {
	const [d, setD] = useState<DadosEmpresa | null>(null);
	const [gTronco, setGTronco] = useState<{ tronco: Row | null } | null>(null);
	const [gRota, setGRota] = useState<{ base: Row | null; prefixo?: string } | null>(null);
	const [gTransf, setGTransf] = useState(false);
	const [gNumeros, setGNumeros] = useState(false);

	const carregar = useCallback(async () => {
		if (!supabase) { setD({ config: null, troncos: [], rotas: [], transferencia: null, saude: [], pedido: null, roteiro: null, ligacoesTeste: 0, recebeFaturas: 0 }); return; }
		const eid = Number(empresaId);
		const [cfg, tr, ro, tf, sa, pe, rt, lt, cf] = await Promise.all([
			supabase.from('voz_config').select('*').eq('empresa_id', eid).maybeSingle(),
			supabase.from('voz_troncos').select('id,referencia,operadora,host,porta,transporte,autenticacao,usuario,segredo_ref,ddd_origem,bina,formato_discagem,csp,codecs,canais,cps,ativo,testado_em,teste_ok').eq('empresa_id', eid).order('referencia'),
			supabase.from('voz_rotas').select('*').eq('empresa_id', eid).order('vigente_desde', { ascending: false }),
			supabase.from('voz_transferencias').select('*').eq('empresa_id', eid).eq('ativo', true).is('credor_id', null).limit(1),
			supabase.from('fornecedor_saude').select('item,referencia,ok,contagem,detalhe,verificado_em,tronco_id').eq('empresa_id', eid),
			supabase.from('pedidos_envio_real').select('id,pedido_em,chamado_id,situacao').eq('empresa_id', eid).eq('canal', 'agente_voz').eq('situacao', 'aberto').limit(1),
			supabase.from('voz_roteiros').select('id,versao,em_uso_em,credor_id').eq('empresa_id', eid).eq('situacao', 'em_uso').limit(1),
			supabase.from('voz_chamadas').select('id', { count: 'exact', head: true }).eq('empresa_id', eid).eq('modo', 'teste'),
			supabase.from('empresa_contatos').select('id', { count: 'exact', head: true }).eq('empresa_id', eid).eq('recebe_faturas', true),
		]);
		setD({
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

	if (!d) return <p className="py-10 text-center text-[14px] text-[#8E8E93]">Carregando...</p>;

	const salvo = (msg: string, troncos = false) => {
		toast.success(msg);
		setGTronco(null); setGRota(null); setGTransf(false); setGNumeros(false);
		void carregar();
		if (troncos) onMudouTroncos();
	};
	const modo = String(d.config?.modo ?? 'simulado');

	return (
		<div className="space-y-6">
			<ConfigEmpresa empresaId={empresaId} empresaNome={empresaNome} config={d.config} divisaoLinha={divisaoLinha} troncos={d.troncos}
				podeTroncos={podeTroncos} modo={modo} onNumeros={() => setGNumeros(true)} onSalvo={m => salvo(m, true)} />
			<Troncos troncos={d.troncos} podeTroncos={podeTroncos} onNovo={() => setGTronco({ tronco: null })} onEditar={t => setGTronco({ tronco: t })} />
			<Rotas rotas={d.rotas} troncos={d.troncos} saude={d.saude} podeTroncos={podeTroncos}
				onNova={(base, prefixo) => setGRota({ base, prefixo })} onEncerrada={() => salvo('Rota encerrada. Ela fica no histórico.')} />
			<Transferencia atual={d.transferencia} troncos={d.troncos} podeTroncos={podeTroncos} onEditar={() => setGTransf(true)} />
			<LigarDeVerdade empresaId={empresaId} empresaNome={empresaNome} d={d} modo={modo} podeLigar={podeLigar} onFeito={() => void carregar()} />

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

	const sel = 'h-9 w-full max-w-[340px] rounded-lg border border-[#D2D2D7] px-2.5 text-[13.5px] outline-none focus:border-[#1D1D1F]';
	const modoNome = MODOS_VOZ.find(m => m.id === modo)?.nome ?? 'Simulado';
	const provInfo = PROVEDORES_VOZ.find(p => p.id === provedor);

	return (
		<Cartao titulo={empresaNome} desc="Configuração do agente virtual desta empresa. Quem cadastra é a equipe MotorCX."
			acoes={<Pilula tom={modo === 'real' ? 'ok' : modo === 'teste' ? 'info' : 'neutro'}>{modoNome}</Pilula>}>
			{!podeTroncos && <div className="mb-3"><Cadeado>{SEM_PERM_TRONCOS} muda esta configuração</Cadeado></div>}
			<dl className="grid gap-x-6 gap-y-4 md:grid-cols-[200px_1fr]">
				<dt className="text-[13px] font-semibold text-[#6E6E73]">Provedor de voz</dt>
				<dd className="min-w-0">
					<select aria-label="Provedor de voz" value={provedor} disabled={!podeTroncos || busy === 'provedor'}
						onChange={e => void ajustar('provedor', e.target.value, 'Provedor de voz salvo.')} className={sel}>
						{PROVEDORES_VOZ.map(p => <option key={p.id} value={p.id}>{p.nome}{p.id === 'montagem_motorcx' ? ' (padrão)' : ''}</option>)}
					</select>
					<p className="mt-1 text-[12px] leading-relaxed text-[#8E8E93]">{provInfo?.desc}{provedor === 'simulador' && modo !== 'simulado' ? ' O Simulador só vale no modo Simulado.' : ''}</p>
				</dd>

				<dt className="text-[13px] font-semibold text-[#6E6E73]">Ligações ao mesmo tempo</dt>
				<dd className="text-[14px] text-[#1D1D1F]">
					{divisaoLinha ? <>Limite de <b className="tnum">{inteiro(limite)}</b> (parte do contrato pelos {inteiro(divisaoLinha.canais)} canais do tronco)</> : <span className="text-[#6E6E73]">Sem limite ainda: a empresa precisa de um tronco ativo.</span>}
				</dd>

				<dt className="text-[13px] font-semibold text-[#6E6E73]">Pico acima do limite</dt>
				<dd className="min-w-0">
					<select aria-label="Pico acima do limite" value={String(pico)} disabled={!podeTroncos || busy === 'pico_multiplo'}
						onChange={e => void ajustar('pico_multiplo', Number(e.target.value), 'Pico salvo.')} className={sel}>
						<option value="1">Desligado (padrão)</option>
						<option value="2">Até 2× · máx. {inteiro(tetoDe(2))}</option>
						<option value="3">Até 3× · máx. {inteiro(tetoDe(3))}</option>
					</select>
					<p className="mt-1 text-[12px] leading-relaxed text-[#8E8E93]">{pico <= 1 ? `Sem pico: a empresa nunca passa de ${inteiro(limite)}.` : `Até ${inteiro(tetoDe(pico))} ao mesmo tempo. O minuto de IA acima de ${inteiro(limite)} custa o dobro e aparece como item próprio na fatura do MotorCX.${tetoDe(pico) < limite * pico ? ` Travado nos ${inteiro(canais)} canais do tronco.` : ''}`}</p>
				</dd>

				<dt className="text-[13px] font-semibold text-[#6E6E73]">Alô fake</dt>
				<dd className="min-w-0">
					<select aria-label="Alô fake" value={aloLib ? '1' : '0'} disabled={!podeTroncos || busy === 'alo_fake_liberado'}
						onChange={e => void ajustar('alo_fake_liberado', e.target.value === '1', e.target.value === '1' ? 'Alô fake liberado para a empresa.' : 'Alô fake não liberado. Se estava ligado na empresa, foi desligado.')} className={sel}>
						<option value="0">Não liberado (padrão)</option>
						<option value="1">Liberado para a empresa</option>
					</select>
					<p className="mt-1 text-[12px] leading-relaxed text-[#8E8E93]">A equipe libera; quem liga, desliga e define o tempo máximo é a empresa, em Canais › Agente virtual.{aloLib ? (config?.alo_fake ? ` Hoje: ligado, até ${inteiro(config?.alo_fake_max_s)} s.` : ' Hoje: desligado pela empresa.') : ''}</p>
				</dd>

				<dt className="text-[13px] font-semibold text-[#6E6E73]">Números de teste</dt>
				<dd className="flex flex-wrap items-center gap-3 text-[14px] text-[#1D1D1F]">
					<span>{nTeste === 0 ? 'Nenhum cadastrado' : `${inteiro(nTeste)} cadastrado${nTeste > 1 ? 's' : ''}`} <span className="text-[#8E8E93]">(guardamos só o hash)</span></span>
					{podeTroncos && <button onClick={onNumeros} className={btnLink}>{nTeste ? 'Trocar' : 'Cadastrar'}</button>}
				</dd>

				<dt className="text-[13px] font-semibold text-[#6E6E73]">Bucket de gravações</dt>
				<dd className="min-w-0">
					<div className="flex max-w-[460px] flex-wrap items-center gap-2">
						<input aria-label="Bucket de gravações" value={bucket} disabled={!podeTroncos} onChange={e => setBucket(e.target.value.toLowerCase())} placeholder="motorcx-voz-empresa" className={`${campoCls} h-9 min-w-0 flex-1 font-mono text-[13px]`} />
						{podeTroncos && <button onClick={() => void ajustar('bucket_gravacoes', bucket.trim() || null, 'Bucket de gravações salvo.')} disabled={busy === 'bucket_gravacoes' || bucket.trim() === String(config?.bucket_gravacoes ?? '') || (!!bucket.trim() && !/^[a-z0-9][a-z0-9_.-]{1,61}[a-z0-9]$/.test(bucket.trim()))} className={btnSec}>Salvar</button>}
					</div>
					<p className="mt-1 text-[12px] leading-relaxed text-[#8E8E93]">Só o nome. Um bucket por empresa, em São Paulo, com o ciclo de vida da retenção dela.</p>
				</dd>

				<dt className="text-[13px] font-semibold text-[#6E6E73]">Agente no provedor</dt>
				<dd className="text-[13px] text-[#6E6E73]">{config?.agent_id ? <>Agente <span className="font-mono">{String(config.agent_id)}</span>{config.voz_id ? <> · voz <span className="font-mono">{String(config.voz_id)}</span></> : null}</> : 'Ainda não sincronizado'}{config?.atualizado_em ? ` · última mudança ${dateTimeBR(config.atualizado_em)}` : ''}</dd>
			</dl>
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

function Troncos({ troncos, podeTroncos, onNovo, onEditar }: { troncos: Row[]; podeTroncos: boolean; onNovo: () => void; onEditar: (t: Row) => void }) {
	const ativos = troncos.filter(t => t.ativo !== false);
	return (
		<Cartao titulo="Troncos SIP da empresa"
			desc="A empresa contrata as operadoras dela. O Asterisk do MotorCX disca por esses troncos e, quando a pessoa atende, liga o agente de IA na chamada."
			acoes={podeTroncos ? <button onClick={onNovo} className={btnSec}><Plus size={15} /> Novo tronco</button> : <Cadeado>{SEM_PERM_TRONCOS} cadastra</Cadeado>}>
			<Trava className="mb-4" icone={<ShieldCheck size={16} />} titulo={<>IPs de saída do MotorCX para a operadora liberar: <span className="font-mono">{IPS_SAIDA_MOTORCX[0]}</span> e <span className="font-mono">{IPS_SAIDA_MOTORCX[1]}</span></>}>
				IPs fixos do Asterisk em São Paulo. A operadora que autentica por IP só precisa liberar estes dois; as que pedem usuário e senha têm a senha no cofre.
			</Trava>
			{troncos.length === 0 ? (
				<Vazio titulo="Nenhum tronco cadastrado">Sem tronco, o agente só funciona no modo Simulado. Cadastre o primeiro com os dados do contrato da empresa com a operadora.</Vazio>
			) : (
				<>
					<div className="hidden md:block">
						<TabelaRolavel minW={860}>
							<thead><tr>
								<th className={thCls}>Tronco</th><th className={thCls}>Operadora</th><th className={thCls}>Endereço</th><th className={thCls}>Autenticação</th>
								<th className={thCls}>Bina · DDD · discagem</th><th className={`${thCls} text-right`}>Canais</th><th className={`${thCls} text-right`}>CPS</th>
								<th className={thCls}>Situação</th>{podeTroncos && <th className={thCls} />}
							</tr></thead>
							<tbody>
								{troncos.map(t => {
									const s = situacaoTronco(t);
									return (
										<tr key={String(t.id)} className={t.ativo === false ? 'opacity-60' : ''}>
											<td className={`${tdCls} whitespace-nowrap font-mono`}>{String(t.referencia)}</td>
											<td className={tdCls}>{String(t.operadora)}</td>
											<td className={`${tdCls} font-mono text-[12.5px]`}>{String(t.host)}:{String(t.porta)} · {String(t.transporte).toUpperCase()}</td>
											<td className={tdCls}>{autenticacaoTxt(t)}</td>
											<td className={tdCls}><span className="tnum">{binaMascara(t.bina)}</span><div className="text-[12px] text-[#6E6E73]">DDD {String(t.ddd_origem)} · {formatoTxt(t)}</div></td>
											<td className={`${tdCls} text-right tnum`}>{inteiro(t.canais)}</td>
											<td className={`${tdCls} text-right tnum`}>{inteiro(t.cps)}</td>
											<td className={tdCls}><Pilula tom={s.tom}>{s.txt}</Pilula></td>
											{podeTroncos && <td className={`${tdCls} text-right`}><button onClick={() => onEditar(t)} className="inline-flex items-center gap-1 rounded-lg border border-[#D2D2D7] px-2.5 py-1 text-[12px] font-semibold text-[#1D1D1F] hover:bg-[#F5F5F7]"><Pencil size={12} /> Editar</button></td>}
										</tr>
									);
								})}
							</tbody>
							<tfoot><tr>
								<td className="py-2.5 pr-3 font-semibold text-[#1D1D1F]" colSpan={5}>Total dos troncos ativos</td>
								<td className="py-2.5 pr-3 text-right font-semibold text-[#1D1D1F] tnum">{inteiro(ativos.reduce((s, t) => s + Number(t.canais ?? 0), 0))}</td>
								<td className="py-2.5 pr-3 text-right font-semibold text-[#1D1D1F] tnum">{inteiro(ativos.reduce((s, t) => s + Number(t.cps ?? 0), 0))}</td>
								<td colSpan={podeTroncos ? 2 : 1} />
							</tr></tfoot>
						</TabelaRolavel>
					</div>
					<div className="space-y-2 md:hidden">
						{troncos.map(t => {
							const s = situacaoTronco(t);
							return (
								<div key={String(t.id)} className={`rounded-xl border border-[#E5E5EA] p-3 ${t.ativo === false ? 'opacity-60' : ''}`}>
									<div className="flex items-start justify-between gap-2">
										<div className="min-w-0"><div className="font-mono text-[13.5px] font-semibold text-[#1D1D1F]">{String(t.referencia)}</div><div className="text-[12.5px] text-[#6E6E73]">{String(t.operadora)}</div></div>
										<Pilula tom={s.tom}>{s.tom === 'ok' ? 'No ar' : s.txt}</Pilula>
									</div>
									<div className="mt-2 break-all font-mono text-[12px] text-[#1D1D1F]">{String(t.host)}:{String(t.porta)} · {String(t.transporte).toUpperCase()}</div>
									<div className="mt-1 text-[12.5px] text-[#6E6E73]">{autenticacaoTxt(t)}</div>
									<div className="mt-1 text-[12.5px] text-[#6E6E73]">Bina <span className="tnum">{binaMascara(t.bina)}</span> · DDD {String(t.ddd_origem)} · {inteiro(t.canais)} canais · {inteiro(t.cps)} CPS</div>
									{podeTroncos && <button onClick={() => onEditar(t)} className={`${btnLink} mt-2`}>Editar</button>}
								</div>
							);
						})}
					</div>
				</>
			)}
			<Trava className="mt-4" icone={<Coins size={16} />} titulo="Serviço pago ao MotorCX: cadastro e gestão do tronco SIP.">
				Item "Gestão de tronco SIP" na fatura mensal do MotorCX. O minuto de telefonia a empresa paga direto à operadora; aqui ele só aparece como estimativa, para conferência.
			</Trava>
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
		setEncerrar(null);
		onEncerrada();
	}

	const linha = (r: Row, situacao: 'vigor' | 'futura' | 'encerrada') => (
		<tr key={String(r.id)} className={situacao === 'encerrada' ? 'opacity-70' : ''}>
			<td className={`${tdCls} font-mono`}>{String(r.tech_prefix)}</td>
			<td className={tdCls}>{TIPOS_ROTA[String(r.tipo)] ?? String(r.tipo)}</td>
			<td className={`${tdCls} whitespace-nowrap font-mono text-[12.5px]`}>{refTronco(r.tronco_id)}</td>
			<td className={`${tdCls} text-right tnum`}>{String(r.prioridade)}ª</td>
			<td className={`${tdCls} text-right tnum`}>{cadenciaTxt(r.cadencia_inicial_s, r.cadencia_incremento_s)}</td>
			<td className={`${tdCls} text-right tnum`}>{reais(r.preco_minuto, 3)}</td>
			<td className={`${tdCls} tnum`}>{dateBR(r.vigente_desde)} → {r.vigente_ate ? dateBR(r.vigente_ate) : 'em vigor'}</td>
			<td className={tdCls}>{situacao === 'vigor' ? <Pilula tom="ok">Em vigor</Pilula> : situacao === 'futura' ? <Pilula tom="info">A partir de {dateBR(r.vigente_desde)}</Pilula> : <Pilula>Encerrada</Pilula>}</td>
			{podeTroncos && <td className={`${tdCls} whitespace-nowrap text-right`}>{situacao !== 'encerrada' && <>
				<button onClick={() => onNova(r)} className={btnLink}>Nova vigência</button>
				<button onClick={() => { setEncerrar(r); setAte(hoje); }} className="ml-3 text-[13px] font-semibold text-[#6E6E73] hover:underline">Encerrar</button>
			</>}</td>}
		</tr>
	);

	return (
		<Cartao titulo="Rotas"
			desc="Como nos discadores de mercado: o tipo do número (fixo ou móvel, local ou LDN) escolhe a rota; a rota diz por qual tronco sai e qual tech prefix vai na frente do número. Se a 1ª falhar ou estiver cheia, sai pela 2ª. Cadência e preço são do contrato com a operadora e servem só para a empresa ver o custo de telefonia: não entram na fatura do MotorCX."
			acoes={podeTroncos ? <button onClick={() => onNova(null)} disabled={troncos.every(t => t.ativo === false)} className={btnSec}><Plus size={15} /> Nova rota</button> : <Cadeado>{SEM_PERM_TRONCOS} cadastra</Cadeado>}>
			{semCadastro.map(s => (
				<Aviso key={String(s.referencia)} className="mb-3" titulo={`Tech prefix ${String(s.referencia)} sem rota cadastrada: ${inteiro(s.contagem)} tentativa${Number(s.contagem) === 1 ? '' : 's'} sem custo calculado.`}>
					O sistema não inventa preço. Cadastre a rota com o preço do contrato da operadora; as tentativas novas passam a ter custo a partir da vigência.
					{podeTroncos && <> <button onClick={() => onNova(null, String(s.referencia))} className={btnLink}>Cadastrar a rota {String(s.referencia)}</button></>}
				</Aviso>
			))}
			{rotas.length === 0 ? (
				<Vazio titulo="Nenhuma rota cadastrada">{troncos.length === 0 ? 'Cadastre um tronco primeiro. Depois, uma rota por tipo de número.' : 'Cadastre uma rota por tipo de número, com o tech prefix, a cadência e o preço do contrato.'}</Vazio>
			) : (
				<>
				<div className="space-y-2 md:hidden">
					{[...vigentes.map(r => [r, 'vigor'] as const), ...futuras.map(r => [r, 'futura'] as const), ...(hist ? encerradas.map(r => [r, 'encerrada'] as const) : [])].map(([r, sit]) => (
						<div key={String(r.id)} className={`rounded-xl border border-[#E5E5EA] p-3 ${sit === 'encerrada' ? 'opacity-70' : ''}`}>
							<div className="flex items-start justify-between gap-2">
								<div className="min-w-0"><b className="font-mono text-[14px] text-[#1D1D1F]">{String(r.tech_prefix)}</b> <span className="text-[13px] text-[#6E6E73]">· {TIPOS_ROTA[String(r.tipo)] ?? String(r.tipo)} · {String(r.prioridade)}ª</span></div>
								{sit === 'vigor' ? <Pilula tom="ok">Em vigor</Pilula> : sit === 'futura' ? <Pilula tom="info">Programada</Pilula> : <Pilula>Encerrada</Pilula>}
							</div>
							<div className="mt-1 text-[12.5px] text-[#6E6E73]"><span className="font-mono">{refTronco(r.tronco_id)}</span> · {cadenciaTxt(r.cadencia_inicial_s, r.cadencia_incremento_s)} · <span className="tnum">{reais(r.preco_minuto, 3)}</span>/min</div>
							<div className="text-[12.5px] text-[#6E6E73] tnum">{dateBR(r.vigente_desde)} → {r.vigente_ate ? dateBR(r.vigente_ate) : 'em vigor'}</div>
							{podeTroncos && sit !== 'encerrada' && <div className="mt-2 flex gap-4"><button onClick={() => onNova(r)} className={btnLink}>Nova vigência</button><button onClick={() => { setEncerrar(r); setAte(hoje); }} className="text-[13px] font-semibold text-[#6E6E73] hover:underline">Encerrar</button></div>}
						</div>
					))}
					{vigentes.length === 0 && futuras.length === 0 && !hist && <p className="py-3 text-center text-[13px] text-[#8E8E93]">Nenhuma rota em vigor hoje.</p>}
				</div>
				<div className="hidden md:block">
				<TabelaRolavel minW={820}>
					<thead><tr>
						<th className={thCls}>Tech prefix</th><th className={thCls}>Tipo de número</th><th className={thCls}>Tronco</th>
						<th className={`${thCls} text-right`}>Prioridade</th><th className={`${thCls} text-right`}>Cadência</th><th className={`${thCls} text-right`}>Preço do minuto</th>
						<th className={thCls}>Vigência</th><th className={thCls}>Situação</th>{podeTroncos && <th className={thCls} />}
					</tr></thead>
					<tbody>
						{vigentes.map(r => linha(r, 'vigor'))}
						{futuras.map(r => linha(r, 'futura'))}
						{hist && encerradas.map(r => linha(r, 'encerrada'))}
						{vigentes.length === 0 && futuras.length === 0 && !hist && (
							<tr><td colSpan={podeTroncos ? 9 : 8} className="py-4 text-center text-[13px] text-[#8E8E93]">Nenhuma rota em vigor hoje.</td></tr>
						)}
					</tbody>
				</TabelaRolavel>
				</div>
				</>
			)}
			{rotas.length > 0 && (
				<div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[12px] text-[#8E8E93]">
					<span>Mudou o preço ou a cadência? Crie uma nova vigência; a anterior fica no histórico e as chamadas antigas mantêm o preço do dia.</span>
					{encerradas.length > 0 && <button onClick={() => setHist(h => !h)} className={btnLink}>{hist ? 'Esconder histórico' : `Ver histórico (${encerradas.length} ${encerradas.length === 1 ? 'vigência encerrada' : 'vigências encerradas'})`}</button>}
				</div>
			)}

			<Calculadora vigentes={vigentes} />

			{encerrar && (
				<Dialogo titulo={`Encerrar a rota ${String(encerrar.tech_prefix)}`} onClose={() => !busy && setEncerrar(null)}
					texto="A rota deixa de valer depois do dia escolhido e vai para o histórico. Tentativas depois disso, sem outra rota, ficam sem custo e geram alerta."
					acoes={<>
						<button onClick={() => setEncerrar(null)} disabled={busy} className={btnSec}>Cancelar</button>
						<button onClick={() => void confirmarEncerrar()} disabled={busy || !ate || ate < String(encerrar.vigente_desde)} className={btnPrim}>{busy ? 'Encerrando...' : 'Encerrar'}</button>
					</>}>
					<label htmlFor="voz-ate" className="mb-1 block text-[13px] font-semibold text-[#1D1D1F]">Último dia da rota</label>
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
		<div className="mt-5 border-t border-[#F0F0F2] pt-4">
			<Subtitulo desc="Sem carência: qualquer segundo atendido é cobrado pela operadora. Até o mínimo inicial, cobra o mínimo; depois, de incremento em incremento.">Como a ligação é tarifada</Subtitulo>
			<div className="flex flex-wrap items-center gap-2 text-[13.5px] text-[#1D1D1F]">
				<label className="flex items-center gap-2">Atendida por
					<input aria-label="Segundos atendidos" value={seg} inputMode="numeric" onChange={e => setSeg(e.target.value.replace(/\D/g, '').slice(0, 5))} className="h-9 w-[72px] rounded-lg border border-[#D2D2D7] px-2 text-right text-[14px] outline-none tnum focus:border-[#1D1D1F]" /> s
				</label>
				<label className="flex min-w-0 items-center gap-2">em
					<select aria-label="Cadência" value={op} onChange={e => setOp(e.target.value)} className="h-9 min-w-0 max-w-[260px] rounded-lg border border-[#D2D2D7] px-2 text-[13.5px] outline-none focus:border-[#1D1D1F]">
						{opcoes.map(([k, o]) => <option key={k} value={k}>{o.rot}</option>)}
					</select>
				</label>
				<b className="tnum">= {inteiro(t)} s tarifados{esc.preco != null ? ` · ${reais(custoVoz(t, esc.preco), 4)}` : ''}</b>
			</div>
			<p className="mt-2 text-[12px] leading-relaxed text-[#8E8E93]">
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
				<dl className="grid gap-x-6 gap-y-2.5 text-[13.5px] md:grid-cols-[180px_1fr]">
					<dt className="font-semibold text-[#6E6E73]">Destino SIP</dt><dd className="break-all font-mono text-[12.5px] text-[#1D1D1F]">{String(atual.destino_sip)}</dd>
					<dt className="font-semibold text-[#6E6E73]">Como</dt><dd className="text-[#1D1D1F]">{atual.metodo === 'ponte' ? 'Nova chamada pelo tronco da empresa e ponte' : 'SIP REFER pelo tronco da empresa (se o discador não aceitar REFER: nova chamada pelo tronco e ponte)'}</dd>
					<dt className="font-semibold text-[#6E6E73]">Tronco e tech prefix</dt><dd className="text-[#1D1D1F]"><span className="font-mono">{tronco ? String(tronco.referencia) : '—'}</span>{atual.tech_prefix ? <> · <span className="font-mono">{String(atual.tech_prefix)}</span></> : null}</dd>
					<dt className="font-semibold text-[#6E6E73]">Cabeçalhos enviados</dt><dd className="font-mono text-[12.5px] text-[#1D1D1F]">{(Array.isArray(atual.cabecalhos) ? atual.cabecalhos as string[] : []).join(' · ') || '—'}</dd>
					<dt className="font-semibold text-[#6E6E73]">Nunca vai</dt><dd className="text-[#1D1D1F]">CPF, nome, valor ou transcrição</dd>
					<dt className="font-semibold text-[#6E6E73]">Último teste</dt>
					<dd className="flex items-center gap-2 text-[#1D1D1F]">{atual.testado_em ? <><Ponto tom={atual.teste_ok ? 'ok' : 'erro'} /> {dateTimeBR(atual.testado_em)} · {atual.teste_ok ? 'operador atendeu' : 'falhou'}</> : <><Ponto tom="atencao" /> Aguardando o teste</>}</dd>
				</dl>
			)}
		</Cartao>
	);
}

// ---------------------------------------------------------------- Simulado → Só números de teste → Real
function LigarDeVerdade({ empresaId, empresaNome, d, modo, podeLigar, onFeito }: {
	empresaId: string; empresaNome: string; d: DadosEmpresa; modo: string; podeLigar: boolean; onFeito: () => void;
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

	return (
		<Cartao titulo="Ligar de verdade" desc="Simulado → Só números de teste → Real. Cada passo é conferido no banco, não só na tela.">
			<ol className="mb-5 grid gap-2 sm:grid-cols-3">
				{MODOS_VOZ.map(m => {
					const i = ordem.indexOf(m.id), a = ordem.indexOf(modo);
					const estado = i < a ? 'feito' : i === a ? 'atual' : 'depois';
					return (
						<li key={m.id} className="rounded-xl border px-3.5 py-3" style={{
							borderColor: estado === 'atual' ? 'var(--area)' : 'var(--base-separator)',
							backgroundColor: estado === 'atual' ? 'var(--base-fill)' : 'transparent',
						}}>
							<div className="flex items-center gap-2 text-[14px] font-semibold text-[#1D1D1F]">
								<span className="grid h-5 w-5 place-items-center rounded-full text-[11px] font-bold" style={{ backgroundColor: estado === 'depois' ? 'var(--base-fill-2)' : estado === 'feito' ? 'var(--estado-pronto)' : 'var(--area)', color: estado === 'depois' ? 'var(--base-texto-2)' : 'var(--base-cartao)' }}>{estado === 'feito' ? '✓' : i + 1}</span>
								{m.nome}{estado === 'atual' ? ' · agora' : ''}
							</div>
							<p className="mt-1 text-[12px] leading-relaxed text-[#6E6E73]">{m.desc}</p>
						</li>
					);
				})}
			</ol>

			<div className="grid gap-6 lg:grid-cols-2">
				<div>
					<Subtitulo>Antes de ligar de verdade</Subtitulo>
					<ul className="space-y-2">
						{itens.map(i => (
							<li key={i.id} className="flex items-start gap-2.5">
								<span aria-hidden className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full text-[11px] font-bold" style={{ backgroundColor: i.ok ? 'var(--estado-pronto-fundo)' : 'var(--estado-atencao-fundo)', color: i.ok ? 'var(--estado-pronto-texto)' : 'var(--estado-atencao-texto)' }}>{i.ok ? '✓' : '!'}</span>
								<span className="min-w-0 text-[13.5px] text-[#1D1D1F]">{i.txt}<span className="block text-[12px] text-[#8E8E93]">{i.sub}{i.para === 'real' ? ' · só para o Real' : ''}</span></span>
							</li>
						))}
					</ul>
				</div>
				<div>
					<Subtitulo>Pedido do cliente</Subtitulo>
					{d.pedido ? (
						<p className="mb-3 text-[13px] leading-relaxed text-[#6E6E73]">A empresa pediu as ligações reais em {dateTimeBR(d.pedido.pedido_em)}{d.pedido.chamado_id ? ` (chamado ${String(d.pedido.chamado_id)})` : ''}. O pedido segue o mesmo fluxo do "Ligar envio real" da Mensageria.</p>
					) : (
						<p className="mb-3 text-[13px] leading-relaxed text-[#6E6E73]">{modo === 'real' ? 'As ligações reais estão ligadas.' : 'Nenhum pedido em aberto. A empresa pede em Canais › Agente virtual quando o checklist estiver pronto.'}</p>
					)}
					{!podeLigar ? <Cadeado>{SEM_PERM_LIGAR}</Cadeado> : (
						<div className="flex flex-wrap items-center gap-3">
							{modo === 'simulado' && <button onClick={() => setConfirma('teste')} disabled={!okTeste} className={btnPrim}>Passar para Só números de teste</button>}
							{modo === 'teste' && <button onClick={() => setConfirma('real')} disabled={!okReal} className={btnPrim}>Ligar ligações reais</button>}
							{modo === 'real' && <Pilula tom="ok">Ligações reais ligadas{c?.atualizado_em ? ` em ${dateTimeBR(c.atualizado_em)}` : ''}</Pilula>}
							{d.pedido && modo !== 'real' && <button onClick={() => setDevolver(true)} className={btnLink}>Devolver ao cliente</button>}
							{modo !== 'simulado' && <button onClick={() => setConfirma('simulado')} className="text-[13px] font-semibold text-[#6E6E73] hover:underline">Voltar para Simulado</button>}
						</div>
					)}
					{podeLigar && ((modo === 'simulado' && !okTeste) || (modo === 'teste' && !okReal)) && (
						<p className="mt-2 text-[12px] text-[#8E8E93]">O botão libera quando os itens do checklist estiverem prontos. Isso é conferido no banco, não só na tela.</p>
					)}
				</div>
			</div>

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
						className="w-full resize-none rounded-lg border border-[#D2D2D7] px-3 py-2 text-[14px] outline-none focus:border-[#1D1D1F]" />
					<p className="mt-1 text-[12px] text-[#8E8E93] tnum">{motivo.length}/400 · mínimo 5 caracteres</p>
				</Dialogo>
			)}
		</Cartao>
	);
}

