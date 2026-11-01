// Tela 1 · Cobrança › Canais › Agente virtual › Fluxos. Um fluxo de conversa por carteira (SQL 58).
// Lê voz_fluxos, voz_fluxo_versoes, voz_fluxo_pedidos, crm_conectores e as métricas do dia (RLS). Escreve só por RPC:
// criar_fluxo_de_modelo, duplicar_fluxo_voz, voltar_versao_fluxo_voz, usar_fluxo_voz e os pedidos em texto
// (pedir_fluxo_voz / pedir_fluxo_equipe). "Novo fluxo" é a única entrada e abre os 3 caminhos (decisão do dono).
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { toast } from 'sonner';
import { Plus, Sparkles, Upload } from 'lucide-react';
import { Loading, Notice } from '@/components/app-shell';
import { Botao, Cartao, CartaoLinha, Kpi, Pilula, Tabela, Vazio, campoCls, campoStyle } from '@/components/voz/ui';
import {
	MODOS, SITUACOES, TIPOS_AGENTE, dataCurta, kpisDoFluxo, misturaModos, modoPredominante, nTxt, pctTxt, somarMetricas, taxaResultado,
	type TipoAgente,
} from '@/lib/fluxo';
import type { FluxoRow, PedidoRow, VersaoRow } from './api';
import { Campo, Detalhes, Gaveta, Kv, Linhas, Ponto, Selo } from './ds';
import { CabecalhoAgente } from './cabecalho';
import { useFluxo, usePermissoesFluxo } from './contexto';
import { GavetaAlcada, GavetaQuem, diasAtras, executar, mensagem, useCarregar, useNomeCarteira } from './comum';

interface LinhaFluxo { f: FluxoRow; versoes: VersaoRow[]; emUso: VersaoRow | null; rascunho: VersaoRow | null; aprovado: VersaoRow | null; taxa: number | null; base: number; atualizado: string | null }

export function situacaoTexto(l: Pick<LinhaFluxo, 'emUso' | 'rascunho' | 'aprovado'>): { t: string; tom: 'ok' | 'atencao' | 'info' | 'neutro' } {
	const partes: string[] = [];
	if (l.emUso) partes.push(`Em uso v${l.emUso.versao}`);
	if (l.aprovado) partes.push(`v${l.aprovado.versao} aprovada, falta colocar em uso`);
	if (l.rascunho) partes.push(l.rascunho.enviado_aprovacao_em ? `v${l.rascunho.versao} aguardando aprovação` : `rascunho v${l.rascunho.versao}`);
	if (!partes.length) return { t: 'Arquivado', tom: 'neutro' };
	return { t: partes.join(' · '), tom: l.aprovado || l.rascunho?.enviado_aprovacao_em ? 'atencao' : l.emUso ? 'ok' : 'info' };
}

export function ListaFluxos() {
	const ctx = useFluxo();
	const { api, empresa, credor, credores, rota } = ctx;
	const perm = usePermissoesFluxo();
	const navigate = useNavigate();
	const nomeCarteira = useNomeCarteira();
	const [gaveta, setGaveta] = useState<null | 'novo' | 'descrever' | 'modelo' | 'quem' | { fluxo: number } | { alcada: number | null }>(null);

	const { dados, erro, carregando, recarregar } = useCarregar(async () => {
		if (!api || !empresa) return null;
		const [{ fluxos, versoes }, pedidos, conectores] = await Promise.all([api.fluxos(empresa.id), api.pedidos(empresa.id).catch(() => [] as PedidoRow[]), api.conectores(empresa.id).catch(() => [])]);
		const emUsoIds = versoes.filter(v => v.situacao === 'em_uso').map(v => v.id);
		const metricas = await api.metricas(emUsoIds, diasAtras(30)).catch(() => []);
		return { fluxos, versoes, pedidos, conectores, metricas };
	}, [api, empresa?.id]);

	const linhas: LinhaFluxo[] = useMemo(() => {
		if (!dados) return [];
		return dados.fluxos.map(f => {
			const vs = dados.versoes.filter(v => v.fluxo_id === f.id).sort((a, b) => b.versao - a.versao);
			const emUso = vs.find(v => v.situacao === 'em_uso') ?? null;
			const m = emUso ? somarMetricas(dados.metricas.filter(x => x.fluxo_versao_id === emUso.id)) : new Map();
			const k = emUso ? kpisDoFluxo(emUso.definicao, m) : null;
			return {
				f, versoes: vs, emUso, rascunho: vs.find(v => v.situacao === 'rascunho') ?? null, aprovado: vs.find(v => v.situacao === 'aprovado_empresa') ?? null,
				taxa: k ? taxaResultado(f.tipo_agente, k) : null, base: k ? (f.tipo_agente === 'localizador' ? k.atendidas : k.identidade) : 0,
				atualizado: vs.map(v => v.atualizado_em ?? v.criado_em).sort().pop() ?? null,
			};
		}).sort((a, b) => nomeCarteira(a.f.credor_id).localeCompare(nomeCarteira(b.f.credor_id)) || a.f.nome.localeCompare(b.f.nome));
	}, [dados, nomeCarteira]);

	const emUsoDaCarteira = !!dados?.versoes.some(v => v.situacao === 'em_uso' && (v.credor_id ?? null) === (credor?.id ?? null));
	const heading = (atual = true) => (
		<CabecalhoAgente titulo="Agente virtual" desc="Um fluxo de conversa por carteira." atual={atual ? 'lista' : undefined} roteiroAntigo={!emUsoDaCarteira}
			acoes={perm.editar ? <Botao onClick={() => setGaveta('novo')}><Plus size={15} aria-hidden /> Novo fluxo</Botao> : undefined} />
	);

	if (!empresa) return <>{heading(false)}<Notice variant="warning">Escolha a empresa no topo para ver esta página.</Notice></>;
	if (!perm.ver) return <>{heading()}<Vazio titulo="Seu perfil não vê os fluxos do agente.">Precisa da permissão Editar canais ou Aprovar roteiro de voz.</Vazio></>;
	if (carregando && !dados) return <>{heading()}<Loading /></>;

	const kEmUso = linhas.filter(l => l.emUso).length;
	const aguardando = linhas.filter(l => l.aprovado || l.rascunho?.enviado_aprovacao_em).length;
	const cons = dados?.conectores ?? [];
	const acordos30 = linhas.reduce((s, l) => {
		if (!l.emUso || !dados) return s;
		return s + kpisDoFluxo(l.emUso.definicao, somarMetricas(dados.metricas.filter(x => x.fluxo_versao_id === l.emUso!.id))).acordos;
	}, 0);
	const sel = gaveta && typeof gaveta === 'object' && 'fluxo' in gaveta ? linhas.find(l => l.f.id === gaveta.fluxo) ?? null : null;

	return (
		<>
			{heading()}
			{erro && <div className="mb-4"><Notice>{erro}</Notice></div>}
			{!linhas.length ? (
				<Vazio titulo="Nenhum fluxo ainda." acao={perm.editar ? <Botao onClick={() => setGaveta('novo')}>Novo fluxo</Botao> : undefined}>
					Comece descrevendo a conversa em texto: o MotorCX monta um rascunho para vocês revisarem. {perm.editar ? '' : 'Quem tem a permissão Editar canais cria o fluxo.'}
				</Vazio>
			) : (
				<div className="space-y-4">
					<div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
						<Kpi rotulo="Fluxos em uso" valor={kEmUso} detalhe={`de ${Math.max(credores.length, 1)} ${credores.length === 1 ? 'carteira' : 'carteiras'}`} />
						<Kpi rotulo="Aguardando aprovação" valor={aguardando} detalhe="quem aprova: Aprovar roteiro de voz" alerta={false} />
						<Kpi rotulo="Conectores ativos" valor={cons.filter(c => c.situacao === 'ativo').length} detalhe={`${cons.filter(c => c.situacao !== 'ativo').length} fora de uso`} />
						<Kpi rotulo="Acordos pelo agente" valor={nTxt(acordos30)} detalhe="30 dias, versões em uso" />
					</div>
					<Cartao semPadding titulo="Fluxos por carteira" linha="Toque para ver versões, como a conversa é feita e duplicar" direita={<Selo onClick={() => setGaveta('quem')}>Quem edita e aprova</Selo>}>
						<Tabela
							cabecalho={['Carteira e fluxo', 'Situação', 'Resultado · 30 dias', 'Atualizado']}
							numericas={[2]}
							onLinha={i => setGaveta({ fluxo: linhas[i].f.id })}
							linhas={linhas.map(l => {
								const s = situacaoTexto(l);
								const def = (l.rascunho ?? l.emUso ?? l.versoes[0])?.definicao;
								return [
									<span key="n" className="block min-w-0"><b className="font-semibold">{nomeCarteira(l.f.credor_id)} · {l.f.nome}</b><small className="block text-[12px] text-[var(--base-texto-2)]">{TIPOS_AGENTE[l.f.tipo_agente]} · {modoPredominante(def)}</small></span>,
									<Pilula key="s" tom={s.tom}>{s.t}</Pilula>,
									<span key="r">{pctTxt(l.taxa)}<small className="block text-[12px] text-[var(--base-texto-2)]">{l.emUso ? `${nTxt(l.base)} na base` : 'sem ligações ainda'}</small></span>,
									<span key="a" className="text-[12.5px] text-[var(--base-texto-2)]">{dataCurta(l.atualizado)}</span>,
								];
							})}
							cartoes={linhas.map(l => {
								const s = situacaoTexto(l);
								return (
									<CartaoLinha key={l.f.id} onClick={() => setGaveta({ fluxo: l.f.id })}>
										<span className="flex items-start justify-between gap-2"><b className="font-semibold">{nomeCarteira(l.f.credor_id)}</b><b className="tnum">{pctTxt(l.taxa)}</b></span>
										<small className="mt-0.5 block text-[12px] text-[var(--base-texto-2)]">{l.f.nome} · {TIPOS_AGENTE[l.f.tipo_agente]}</small>
										<span className="mt-1.5 block"><Pilula tom={s.tom}>{s.t}</Pilula></span>
									</CartaoLinha>
								);
							})}
						/>
					</Cartao>
					{(dados?.pedidos.length ?? 0) > 0 && (
						<Cartao>
							<Detalhes titulo="Pedidos por texto" qtd={`${dados!.pedidos.length} · cada descrição fica guardada com a versão que gerou`}>
								<Linhas itens={dados!.pedidos.slice(0, 20).map(p => ({
									e: <><b className="font-semibold">PED-{String(p.id).padStart(4, '0')}</b> · {nomeCarteira(p.credor_id)}</>,
									s: <>"{p.texto.slice(0, 110)}{p.texto.length > 110 ? '…' : ''}"<br />{p.tipo === 'ia' ? 'IA do MotorCX' : 'Equipe MotorCX'} · {situacaoPedido(p)}</>,
									onClick: () => navigate(rota('pedido', p.id)),
								}))} />
							</Detalhes>
						</Cartao>
					)}
				</div>
			)}

			<GavetaQuem aberta={gaveta === 'quem'} onFechar={() => setGaveta(null)} />
			<GavetaNovo aberta={gaveta === 'novo'} onFechar={() => setGaveta(null)} onEscolher={g => setGaveta(g)} />
			<GavetaModelo aberta={gaveta === 'modelo'} onFechar={() => setGaveta(null)} aoCriar={id => navigate(rota('editor', id))} />
			<GavetaDescrever aberta={gaveta === 'descrever'} onFechar={() => setGaveta(null)} versaoOrigem={null} aoPedir={id => navigate(rota('pedido', id))} />
			{sel && <GavetaFluxo linha={sel} onFechar={() => setGaveta(null)} aoMudar={() => void recarregar()} abrirAlcada={c => setGaveta({ alcada: c })} />}
			{gaveta && typeof gaveta === 'object' && 'alcada' in gaveta && <AlcadaCarregada credor={gaveta.alcada} onFechar={() => setGaveta(null)} />}
		</>
	);
}

export function situacaoPedido(p: PedidoRow): string {
	switch (p.situacao) {
		case 'pendente': return 'na fila da geração';
		case 'gerando': return 'gerando o rascunho…';
		case 'gerado': return p.versao_gerada_id ? `rascunho gerado em ${dataCurta(p.gerado_em)}` : 'gerado (a versão já não existe)';
		case 'com_erros': return 'a geração não passou no validador';
		case 'na_equipe': return `com a equipe MotorCX até ${dataCurta(p.prazo_em)}`;
		default: return 'cancelado';
	}
}

function AlcadaCarregada({ credor, onFechar }: { credor: number | null; onFechar: () => void }) {
	const { api, empresa } = useFluxo();
	const { dados, recarregar } = useCarregar(async () => (api && empresa ? api.alcada(empresa.id, credor) : null), [api, empresa?.id, credor]);
	return <GavetaAlcada aberta onFechar={onFechar} credor={credor} alcada={dados ?? null} aoSalvar={() => void recarregar()} />;
}

function GavetaNovo({ aberta, onFechar, onEscolher }: { aberta: boolean; onFechar: () => void; onEscolher: (g: 'descrever' | 'modelo') => void }) {
	const { api, empresa, credor, rota } = useFluxo();
	const navigate = useNavigate();
	const [ocupado, setOcupado] = useState(false);
	async function branco() {
		if (!api || !empresa) return;
		setOcupado(true);
		try { const id = await api.criarDeModelo(empresa.id, 'branco', credor?.id ?? null, null); navigate(rota('editor', id)); } catch (e) { setOcupado(false); alertar(e); }
	}
	const opcao = (titulo: string, desc: string, onClick: () => void, rec?: boolean) => (
		<button type="button" disabled={ocupado} onClick={onClick} className="flex w-full items-center gap-3 rounded-xl border px-4 py-3 text-left hover:bg-[var(--base-fill)] disabled:opacity-60" style={{ borderColor: rec ? 'var(--destaque)' : 'var(--base-borda)' }}>
			<span className="min-w-0 flex-1"><span className="flex flex-wrap items-center gap-2 text-[14px] font-semibold text-[var(--base-texto)]">{titulo}{rec && <Pilula tom="info">recomendado</Pilula>}</span><small className="mt-0.5 block text-[12.5px] text-[var(--base-texto-2)]">{desc}</small></span>
			<span aria-hidden className="text-[var(--base-texto-3)]">›</span>
		</button>
	);
	return (
		<Gaveta aberta={aberta} onFechar={onFechar} titulo="Novo fluxo" sub="Escolha como começar. Qualquer caminho vira rascunho e passa pela mesma aprovação.">
			<div className="space-y-2">
				{opcao('Descrever e o MotorCX monta', 'Escreva como a conversa deve ser. A IA monta um rascunho em segundos, ou a equipe MotorCX monta por pedido no Suporte.', () => onEscolher('descrever'), true)}
				{opcao('A partir de um modelo', 'Localizador, Negociador ou Localizador + Negociador.', () => onEscolher('modelo'))}
				{opcao('Em branco', 'Montar etapa por etapa no editor. Abertura, Confirmar identidade e os finais já vêm prontos, com as travas valendo.', () => void branco())}
			</div>
			<p className="text-[12px] text-[var(--base-texto-3)]">Carteira: a escolhida no topo{credor ? ` (${credor.nome})` : ' (nenhuma: vale para a empresa toda)'}.</p>
		</Gaveta>
	);
}

function alertar(e: unknown) { toast.error(mensagem(e)); }

function GavetaModelo({ aberta, onFechar, aoCriar }: { aberta: boolean; onFechar: () => void; aoCriar: (versao: number) => void }) {
	const { api, empresa, credor, credores } = useFluxo();
	const { dados } = useCarregar(async () => (api ? api.modelos() : []), [api]);
	const [modelo, setModelo] = useState('');
	const [carteira, setCarteira] = useState<string>(credor ? String(credor.id) : '');
	const [nome, setNome] = useState('');
	const modelos = (dados ?? []).filter(m => m.codigo !== 'branco');
	async function criar() {
		if (!api || !empresa || !modelo) return;
		try { aoCriar(await api.criarDeModelo(empresa.id, modelo, carteira ? Number(carteira) : null, nome.trim() || null)); } catch (e) { alertar(e); }
	}
	return (
		<Gaveta aberta={aberta} onFechar={onFechar} titulo="A partir de um modelo" sub="O modelo vira o rascunho v1. Conectores e alçada vocês escolhem no editor." pe={<Botao onClick={() => void criar()} disabled={!modelo}>Criar rascunho</Botao>}>
			<div role="radiogroup" aria-label="Modelo" className="space-y-2">
				{modelos.map(m => (
					<button key={m.codigo} type="button" role="radio" aria-checked={modelo === m.codigo} onClick={() => setModelo(m.codigo)} className="block w-full rounded-xl border px-4 py-3 text-left" style={{ borderColor: modelo === m.codigo ? 'var(--destaque)' : 'var(--base-borda)', boxShadow: modelo === m.codigo ? '0 0 0 1px var(--destaque)' : undefined }}>
						<b className="text-[13.5px] font-semibold text-[var(--base-texto)]">{m.nome}</b>
						{m.descricao && <small className="mt-0.5 block text-[12.5px] text-[var(--base-texto-2)]">{m.descricao}</small>}
					</button>
				))}
			</div>
			<div className="grid gap-3 sm:grid-cols-2">
				<Campo rotulo="Carteira"><SelCarteira valor={carteira} onChange={setCarteira} credores={credores} /></Campo>
				<Campo rotulo="Nome do fluxo (opcional)"><input value={nome} maxLength={60} onChange={e => setNome(e.target.value)} className={`${campoCls} w-full`} style={campoStyle} /></Campo>
			</div>
		</Gaveta>
	);
}

export function SelCarteira({ valor, onChange, credores, rotulo = 'Carteira' }: { valor: string; onChange: (v: string) => void; credores: { id: number; nome: string }[]; rotulo?: string }) {
	return (
		<select aria-label={rotulo} value={valor} onChange={e => onChange(e.target.value)} className={`${campoCls} w-full`} style={campoStyle}>
			<option value="">Empresa toda</option>
			{credores.map(c => <option key={c.id} value={c.id}>{c.nome}</option>)}
		</select>
	);
}

/** "Descrever e o MotorCX monta": pedido em texto (IA na hora ou equipe pelo Suporte). O resultado é sempre rascunho. */
export function GavetaDescrever({ aberta, onFechar, versaoOrigem, credorFixo, aoPedir }: { aberta: boolean; onFechar: () => void; versaoOrigem: number | null; credorFixo?: number | null; aoPedir: (pedido: number) => void }) {
	const { api, empresa, credor, credores } = useFluxo();
	const [carteira, setCarteira] = useState<string>(credorFixo !== undefined ? (credorFixo == null ? '' : String(credorFixo)) : credor ? String(credor.id) : '');
	const [tipo, setTipo] = useState<TipoAgente>('negociador');
	const [texto, setTexto] = useState('');
	const [quem, setQuem] = useState<'ia' | 'equipe'>('ia');
	const [anexos, setAnexos] = useState<{ nome: string; ref: string }[]>([]);
	const [ocupado, setOcupado] = useState(false);
	const temDado = /[0-9]{9,}|@/.test(texto);
	const valido = texto.trim().length >= 10 && texto.length <= 8000 && !temDado;
	async function anexar(fs: FileList | null) {
		if (!api || !empresa || !fs) return;
		for (const f of Array.from(fs).slice(0, 10 - anexos.length)) {
			if (f.size > 10 * 1024 * 1024) { alertar(new Error(`${f.name}: até 10 MB por anexo.`)); continue; }
			try { const ref = await api.anexar(empresa.slug, f); setAnexos(a => [...a, { nome: f.name, ref }]); } catch (e) { alertar(e); }
		}
	}
	async function pedir() {
		if (!api || !empresa || !valido) return;
		setOcupado(true);
		const prefixo = versaoOrigem ? '' : `Tipo de agente: ${TIPOS_AGENTE[tipo]}.\n`;
		let id = 0;
		const ok = await executar(async () => { id = await api.pedirFluxo({ tipo: quem, empresa: empresa.id, credor: carteira ? Number(carteira) : null, texto: prefixo + texto.trim(), anexos: anexos.map(a => a.ref), versaoOrigem }); },
			quem === 'ia' ? 'Pedido na fila. O rascunho aparece em instantes.' : 'Pedido aberto no Suporte. A equipe MotorCX monta em até 2 dias úteis.');
		setOcupado(false);
		if (ok && id) aoPedir(id);
	}
	return (
		<Gaveta aberta={aberta} onFechar={onFechar} titulo={versaoOrigem ? 'Descrever mudanças' : 'Descrever o fluxo'} sub="O resultado é sempre um rascunho, que passa pela mesma aprovação."
			pe={<Botao onClick={() => void pedir()} disabled={!valido || ocupado}><Sparkles size={15} aria-hidden /> {quem === 'ia' ? 'Gerar rascunho' : 'Pedir à equipe'}</Botao>}>
			<div className="grid gap-3 sm:grid-cols-2">
				{credorFixo === undefined && <Campo rotulo="Carteira"><SelCarteira valor={carteira} onChange={setCarteira} credores={credores} /></Campo>}
				{!versaoOrigem && (
					<Campo rotulo="Tipo de agente">
						<select value={tipo} onChange={e => setTipo(e.target.value as TipoAgente)} className={`${campoCls} w-full`} style={campoStyle}>
							{Object.entries(TIPOS_AGENTE).map(([k, n]) => <option key={k} value={k}>{n}</option>)}
						</select>
					</Campo>
				)}
				<Campo inteiro rotulo={versaoOrigem ? 'O que deve mudar' : 'Como a conversa deve ser'} ajuda={temDado ? <span className="text-[var(--estado-erro-texto)]">Tire números de documento, telefone ou e-mail do texto.</span> : 'Sem dado de cliente: só como a conversa deve ser.'}>
					<textarea rows={7} value={texto} maxLength={8000} onChange={e => setTexto(e.target.value)} placeholder="Ex.: confirme a data de nascimento antes de falar de valor. Depois, busque as ofertas no CRM e ofereça primeiro à vista com desconto…" className={`${campoCls} h-auto w-full py-2 leading-relaxed`} style={campoStyle} />
				</Campo>
			</div>
			<Detalhes titulo="Anexos (opcional)" qtd={anexos.length ? `${anexos.length}` : undefined}>
				<p className="mb-2 text-[12.5px] text-[var(--base-texto-2)]">Roteiro da operação, política de ofertas, lista de objeções. Ficam guardados enquanto a versão gerada existir.</p>
				{anexos.length > 0 && <ul className="mb-2 space-y-1 text-[12.5px]">{anexos.map(a => <li key={a.ref} className="truncate">{a.nome}</li>)}</ul>}
				<label className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-lg border px-3 text-[12.5px] font-semibold text-[var(--base-texto)]" style={{ borderColor: 'var(--base-borda)' }}>
					<Upload size={14} aria-hidden /> Anexar arquivo
					<input type="file" multiple className="sr-only" onChange={e => void anexar(e.target.files)} />
				</label>
			</Detalhes>
			<Campo rotulo="Quem monta">
				<select value={quem} onChange={e => setQuem(e.target.value as 'ia' | 'equipe')} className={`${campoCls} w-full`} style={campoStyle}>
					<option value="ia">IA do MotorCX agora (rascunho em segundos)</option>
					<option value="equipe">Equipe MotorCX (pedido no Suporte, em até 2 dias úteis)</option>
				</select>
			</Campo>
			<p className="text-[12px] text-[var(--base-texto-3)]">{quem === 'ia' ? 'Cada geração conta no item "geração de fluxo por IA" da fatura do MotorCX.' : 'Abre um chamado no Suporte com o texto e os anexos.'}</p>
		</Gaveta>
	);
}

function GavetaFluxo({ linha, onFechar, aoMudar, abrirAlcada }: { linha: LinhaFluxo; onFechar: () => void; aoMudar: () => void; abrirAlcada: (credor: number | null) => void }) {
	const { api, credores, rota } = useFluxo();
	const perm = usePermissoesFluxo();
	const navigate = useNavigate();
	const nomeCarteira = useNomeCarteira();
	const [modo, setModo] = useState<null | 'duplicar' | { voltar: number }>(null);
	const [destino, setDestino] = useState('');
	const [motivo, setMotivo] = useState('');
	const def = (linha.emUso ?? linha.rascunho ?? linha.versoes[0])?.definicao;
	const mistura = misturaModos(def);
	const abrir = linha.rascunho ?? linha.aprovado ?? linha.emUso ?? linha.versoes[0];
	const s = situacaoTexto(linha);
	async function duplicar() {
		if (!api || !(linha.emUso ?? abrir)) return;
		try { const id = await api.duplicar((linha.emUso ?? abrir).id, destino ? Number(destino) : null, null); navigate(rota('editor', id)); } catch (e) { alertar(e); }
	}
	async function voltar(versao: number) {
		if (!api) return;
		if (await executar(() => api.voltar(linha.f.id, versao, motivo.trim()), `A v${versao} volta a ficar em uso na próxima ligação. A atual foi para o arquivo.`)) { setModo(null); setMotivo(''); aoMudar(); }
	}
	async function usar(v: VersaoRow) {
		if (!api) return;
		if (await executar(() => api.usar(v.id), `v${v.versao} em uso a partir da próxima ligação.`)) aoMudar();
	}
	return (
		<Gaveta aberta onFechar={onFechar} titulo={`${nomeCarteira(linha.f.credor_id)} · ${linha.f.nome}`} sub={s.t}
			pe={<>
				{perm.editar && (linha.emUso ?? abrir) && <Botao secundario onClick={() => setModo(modo === 'duplicar' ? null : 'duplicar')}>Duplicar para outra carteira</Botao>}
				{abrir && <Botao onClick={() => navigate(rota('editor', abrir.id))}>Abrir no editor</Botao>}
			</>}>
			{modo === 'duplicar' && (
				<div className="space-y-2 rounded-xl border p-3" style={{ borderColor: 'var(--base-borda)' }}>
					<Campo rotulo="Copiar a versão em uso como rascunho v1 na carteira"><SelCarteira valor={destino} onChange={setDestino} credores={credores} /></Campo>
					<Botao onClick={() => void duplicar()}>Duplicar</Botao>
				</div>
			)}
			<Kv itens={[[`Taxa de resultado · 30 dias`, pctTxt(linha.taxa)], ['Base', linha.emUso ? `${nTxt(linha.base)} ${linha.f.tipo_agente === 'localizador' ? 'atendidas' : 'com identidade confirmada'}` : 'sem ligações ainda'], ['Atualizado', dataCurta(linha.atualizado)]]} />
			{mistura.length > 0 && (
				<div>
					<b className="text-[12.5px] font-semibold">Como a conversa é feita</b>
					<div className="my-1.5 flex h-2.5 overflow-hidden rounded-full">{mistura.map(m => <span key={m.modo} style={{ width: `${m.pct}%`, backgroundColor: MODOS[m.modo].cor }} />)}</div>
					<div className="flex flex-wrap gap-x-3 gap-y-1 text-[12px] text-[var(--base-texto-2)]">{mistura.map(m => <span key={m.modo} className="inline-flex items-center gap-1"><Ponto cor={MODOS[m.modo].cor} />{MODOS[m.modo].nome} {m.pct}%</span>)}</div>
				</div>
			)}
			<div>
				<Detalhes titulo="Versões" aberto qtd={`${linha.versoes.length}`}>
					<Linhas itens={linha.versoes.map(v => ({
						e: <><b className="font-semibold">v{v.versao}</b> · {SITUACOES[v.situacao].nome}{v.situacao === 'rascunho' && v.enviado_aprovacao_em ? ' · enviado para aprovação' : ''}</>,
						s: v.situacao === 'arquivado' ? `até ${dataCurta(v.arquivado_em)}` : v.situacao === 'em_uso' ? `desde ${dataCurta(v.em_uso_em)}` : `${dataCurta(v.atualizado_em ?? v.criado_em)}${v.motivo ? ` · ${v.motivo}` : ''}`,
						d: v.situacao === 'arquivado' && perm.aprovar ? <button type="button" className="text-[12.5px] font-semibold text-[var(--destaque)]" onClick={() => setModo({ voltar: v.versao })}>Voltar para esta</button>
							: v.situacao === 'aprovado_empresa' && perm.aprovar ? <button type="button" className="text-[12.5px] font-semibold text-[var(--destaque)]" onClick={() => void usar(v)}>Colocar em uso</button>
							: <button type="button" className="text-[12.5px] font-semibold text-[var(--destaque)]" onClick={() => navigate(rota('editor', v.id))}>Abrir</button>,
					}))} />
					{modo && typeof modo === 'object' && (
						<div className="mt-2 space-y-2 rounded-xl border p-3" style={{ borderColor: 'var(--base-borda)' }}>
							<Campo rotulo={`Por que voltar para a v${modo.voltar}?`} ajuda="5 a 300 caracteres. Fica registrado; nada é apagado.">
								<input value={motivo} maxLength={300} onChange={e => setMotivo(e.target.value)} className={`${campoCls} w-full`} style={campoStyle} />
							</Campo>
							<Botao onClick={() => void voltar(modo.voltar)} disabled={motivo.trim().length < 5}>Voltar para a v{modo.voltar}</Botao>
						</div>
					)}
				</Detalhes>
				<Detalhes titulo="Como a taxa é calculada">
					<p className="text-[12.5px] text-[var(--base-texto-2)]">Negociador = acordos ÷ identidade confirmada. Localizador = transferidas ÷ atendidas por pessoa. Últimos 30 dias, só a versão em uso.</p>
				</Detalhes>
				<Detalhes titulo="Alçada da carteira">
					<p className="mb-2 text-[12.5px] text-[var(--base-texto-2)]">Teto de toda oferta do agente nesta carteira.</p>
					<Botao secundario onClick={() => abrirAlcada(linha.f.credor_id)}>Ver a alçada</Botao>
				</Detalhes>
			</div>
		</Gaveta>
	);
}
