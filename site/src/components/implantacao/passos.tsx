// Os 5 passos do Assistente de implantação. Cada um salva no banco numa chamada (RPCs do SQL 74).
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { FileSpreadsheet, UploadCloud } from 'lucide-react';
import { useMotorAuth } from '@/components/auth-provider';
import { friendlyError, logAccess, numberBR, safeFileName, supabase, today, type Row } from '@/lib/supabase';
import { lerNumeroBR } from '@/lib/condicoes';
import { Aviso, Botao, BotaoLink, Detalhes, Kpis, Pilula, Segmentos, campoCls, campoStyle, textareaCls } from '@/components/ds';
import { MapeamentoCarga } from '@/components/comuns/mapeamento-carga';
import { combinar, lerArquivo, paraSalvar, reconhecer, validar, type ColunasCarga, type LeituraArquivo } from '@/lib/mapeamento-carga';
import {
	CANAIS_ASSISTENTE, FRASES_PADRAO_SMS, REGUA_PADRAO, ROTULO_QUEM, checklist, comContato, heroi, podeMotorcx, proximaLista,
	quemEnviaAtual, resumoCarga, textoPrevia, type Aprovacao, type CanalAssistente, type Item, type QuemEnvia, type Situacao,
} from '@/lib/implantacao';

const SOMBRA = '0 0 0 1px var(--base-borda), 0 2px 12px rgba(0,0,0,.04)';
const moeda = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2, maximumFractionDigits: 5 });

function Cartao({ n, quem, titulo, desc, children, rodape }: { n: number; quem?: string; titulo: string; desc: ReactNode; children: ReactNode; rodape: ReactNode }) {
	return (
		<section className="min-w-0 rounded-2xl bg-[var(--base-cartao)] p-5 sm:p-6" style={{ boxShadow: SOMBRA }} data-passo={n}>
			<span className="inline-block rounded-md bg-[var(--destaque-suave)] px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-[var(--destaque)]">Passo {n} de 5{quem ? ` · ${quem}` : ''}</span>
			<h1 className="mb-1 mt-2.5 border-l-[3px] border-[var(--destaque)] pl-2.5 text-[22px] font-semibold tracking-tight text-[var(--base-texto)]">{titulo}</h1>
			<p className="mb-5 text-[14px] text-[var(--base-texto-2)]">{desc}</p>
			{children}
			<div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-[var(--base-separator)] pt-4">{rodape}</div>
		</section>
	);
}

function Campo({ rotulo, ajuda, children }: { rotulo: ReactNode; ajuda?: ReactNode; children: ReactNode }) {
	return (
		<label className="flex min-w-0 flex-col gap-1.5 text-[13px] font-semibold text-[var(--base-texto)]">
			{rotulo}
			{children}
			{ajuda && <small className="text-[12px] font-normal text-[var(--base-texto-2)]">{ajuda}</small>}
		</label>
	);
}

const inCls = `${campoCls} h-10 w-full text-[14px]`;

// ------------------------------------------------------------------ 1. Empresa e contrato (equipe)
export function PassoEmpresa({ sit, equipe, onCriada, onContinuar, onNovaOutra }: { sit: Situacao | null; equipe: boolean; onCriada: (id: string) => void; onContinuar: () => void; onNovaOutra: () => void }) {
	const [f, setF] = useState({ nome: '', razao: '', admin: '', email: '', cnpj: '', preco: '', minimo: '', motivo: '' });
	const [mensageria, setMensageria] = useState(false);
	const [tabela, setTabela] = useState<{ preco: number | null; minimo: number | null }>({ preco: null, minimo: null });
	const [busy, setBusy] = useState(false);
	const [erro, setErro] = useState('');
	const [convite, setConvite] = useState<{ id: string; erro: string } | null>(null);
	const chave = useRef<string>(typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`);

	useEffect(() => {
		if (!supabase || sit) return;
		void supabase.from('cobranca_itens').select('preco_tabela,preco_minimo').eq('codigo', 'contratos').maybeSingle().then(({ data }) => {
			const d = data as Row | null;
			const t = { preco: d?.preco_tabela != null ? Number(d.preco_tabela) : null, minimo: d?.preco_minimo != null ? Number(d.preco_minimo) : null };
			setTabela(t);
			if (t.preco) setF(x => x.preco ? x : { ...x, preco: t.preco!.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 5 }) });
		});
	}, [sit]);

	if (sit) {
		const p = sit.preco;
		return (
			<Cartao n={1} quem="equipe MotorCX" titulo="Empresa e contrato" desc="Feito. A empresa existe e já pode ser cobrada; o resto vem com o padrão e muda depois em Empresa › Contratação."
				rodape={<><span className="text-[12px] text-[var(--base-texto-2)]">{equipe ? <button type="button" onClick={onNovaOutra} className="font-semibold text-[var(--destaque)] hover:underline">Implantar outra empresa</button> : null}</span><Botao onClick={onContinuar}>Continuar</Botao></>}>
				<div className="flex flex-wrap gap-2 text-[13px]">
					<span className="rounded-full bg-[var(--base-fill)] px-2.5 py-1.5">Empresa <b>{sit.empresa.nome}</b></span>
					{p && <span className="rounded-full bg-[var(--base-fill)] px-2.5 py-1.5">Orquestração <b>{moeda(Number(p.preco))} por CPF ativo</b>{Number(p.minimo) > 0 && <> · mínimo <b>{moeda(Number(p.minimo))}</b></>}</span>}
					<span className="rounded-full bg-[var(--base-fill)] px-2.5 py-1.5">Admin <b>{sit.admin.nome ?? '—'}</b> · {sit.admin.entrou ? 'já entrou' : sit.admin.convidado ? 'convite enviado' : 'sem convite'}</span>
					<span className="rounded-full bg-[var(--base-fill)] px-2.5 py-1.5">Situação <b>{sit.empresa.situacao === 'implantacao' ? 'Em implantação' : sit.empresa.situacao}</b></span>
				</div>
			</Cartao>
		);
	}
	if (!equipe) return <Aviso tom="info">A empresa é criada pela equipe MotorCX.</Aviso>;

	const precoNum = (() => { const r = lerNumeroBR(f.preco); return 'erro' in r ? null : r.valor; })();
	const abaixo = precoNum != null && tabela.minimo != null && precoNum < tabela.minimo;
	const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF(x => ({ ...x, [k]: e.target.value }));

	async function convidar(id: string): Promise<string> {
		if (!supabase) return '';
		const { error } = await supabase.functions.invoke('admin-usuarios', { body: { acao: 'convidar', email: f.email.trim(), nome: f.admin.trim(), papel: 'admin', empresa_id: id } });
		return error ? 'A empresa foi criada, mas o convite do Admin não saiu. Tente de novo; nada fica duplicado.' : '';
	}

	async function criar() {
		if (!supabase) return;
		setErro('');
		if (precoNum == null || precoNum <= 0) { setErro('Informe o preço da Orquestração por CPF ativo (ex.: 0,38).'); return; }
		const min = f.minimo.trim() ? lerNumeroBR(f.minimo) : { valor: 0 };
		if ('erro' in min) { setErro('Mínimo mensal: use números como 1.500,00.'); return; }
		setBusy(true);
		const { data, error } = await supabase.rpc('criar_empresa_implantacao', {
			chave: chave.current, nome: f.nome.trim(), razao_social: f.razao.trim(), admin_nome: f.admin.trim(), admin_email: f.email.trim(),
			preco: precoNum, cnpj: f.cnpj.trim() || null, minimo: min.valor, motivo: abaixo ? f.motivo.trim() || null : null, mensageria, segmento: null,
		});
		if (error || data == null) { setErro(friendlyError(error)); setBusy(false); return; }
		const id = String(data);
		const e = await convidar(id);
		setBusy(false);
		if (e) { setConvite({ id, erro: e }); return; }
		onCriada(id);
	}

	return (
		<Cartao n={1} quem="equipe MotorCX" titulo="Empresa e contrato" desc="O mínimo para a empresa existir e ser cobrada. Todo o resto já vem com o padrão e pode mudar depois."
			rodape={<><span className="text-[12px] text-[var(--base-texto-2)]">Salva tudo de uma vez: se algo falhar, nada fica pela metade.</span>
				{convite ? <Botao onClick={async () => { setBusy(true); const e = await convidar(convite.id); setBusy(false); if (e) setConvite({ ...convite, erro: e }); else onCriada(convite.id); }} disabled={busy}>Reenviar convite</Botao>
					: <Botao onClick={() => void criar()} disabled={busy}>{busy ? 'Criando…' : 'Criar empresa e convidar Admin'}</Botao>}</>}>
			{erro && <div className="mb-4"><Aviso tom="erro">{erro}</Aviso></div>}
			{convite && <div className="mb-4"><Aviso tom="atencao" acao={<button type="button" className="text-[13px] font-semibold text-[var(--destaque)] hover:underline" onClick={() => onCriada(convite.id)}>Seguir sem o convite</button>}>{convite.erro}</Aviso></div>}
			<div className="grid gap-3.5 sm:grid-cols-2">
				<Campo rotulo="Nome fantasia"><input className={inCls} style={campoStyle} value={f.nome} onChange={set('nome')} placeholder="Assessoria Aurora" /></Campo>
				<Campo rotulo="Razão social"><input className={inCls} style={campoStyle} value={f.razao} onChange={set('razao')} placeholder="Aurora Cobranças Ltda" /></Campo>
				<Campo rotulo="Admin da empresa"><input className={inCls} style={campoStyle} value={f.admin} onChange={set('admin')} placeholder="Nome de quem vai administrar" /></Campo>
				<Campo rotulo="E-mail do Admin" ajuda="O convite chega aqui. A senha é ela quem cria."><input type="email" className={inCls} style={campoStyle} value={f.email} onChange={set('email')} placeholder="nome@empresa.com.br" /></Campo>
				<Campo rotulo={<span>CNPJ <span className="font-normal text-[var(--base-texto-3)]">(opcional)</span></span>}><input className={inCls} style={campoStyle} value={f.cnpj} onChange={set('cnpj')} placeholder="00.000.000/0000-00" inputMode="numeric" /></Campo>
				<Campo rotulo="Produto" ajuda={mensageria ? 'Com a Mensageria, a MotorCX pode enviar o SMS e o e-mail (escolha no passo 4).' : 'SMS e e-mail saem como lista para o fornecedor da empresa.'}>
					<Segmentos rotulo="Produto" valor={mensageria ? 'm' : 'o'} onTrocar={v => setMensageria(v === 'm')} itens={[{ v: 'o', n: 'Orquestração' }, { v: 'm', n: 'Orquestração + Mensageria' }]} />
				</Campo>
			</div>
			<div className="mt-5 border-t border-[var(--base-separator)] pt-4">
				<h3 className="mb-2.5 text-[15px] font-semibold text-[var(--base-texto)]">Preço</h3>
				<div className="grid gap-3.5 sm:grid-cols-2">
					<Campo rotulo="Orquestração · por CPF ativo no mês" ajuda={<>{tabela.preco != null && <>Tabela {moeda(tabela.preco)} · </>}{tabela.minimo != null && <>mínimo {moeda(tabela.minimo)}. </>}CPF ativo = esteve na carga em cobrança em algum dia do mês.</>}>
						<input className={`${inCls} tnum`} style={campoStyle} value={f.preco} onChange={set('preco')} placeholder="0,38" inputMode="decimal" />
					</Campo>
					<Campo rotulo={<span>Mínimo mensal <span className="font-normal text-[var(--base-texto-3)]">(opcional)</span></span>}><input className={`${inCls} tnum`} style={campoStyle} value={f.minimo} onChange={set('minimo')} placeholder="1.500,00" inputMode="decimal" /></Campo>
					{abaixo && <Campo rotulo="Motivo do preço abaixo do mínimo" ajuda="Só o Administrativo ou o Master aprovam."><input className={inCls} style={campoStyle} value={f.motivo} onChange={set('motivo')} placeholder="Ex.: piloto de 3 meses" /></Campo>}
				</div>
			</div>
			<div className="mt-5 border-t border-[var(--base-separator)] pt-4">
				<h3 className="mb-2.5 text-[15px] font-semibold text-[var(--base-texto)]">Já vem assim <span className="text-[12px] font-normal text-[var(--base-texto-2)]">· muda depois em Empresa › Contratação</span></h3>
				<div className="flex flex-wrap gap-2 text-[13px]">
					<span className="rounded-full bg-[var(--base-fill)] px-2.5 py-1.5">Ciclo <b>mensal, corte dia 1</b></span>
					<span className="rounded-full bg-[var(--base-fill)] px-2.5 py-1.5">Pagamento <b>pós-pago, boleto ou Pix, 10 dias</b></span>
					<span className="rounded-full bg-[var(--base-fill)] px-2.5 py-1.5">Fatura <b>a equipe revisa antes de emitir</b></span>
					<span className="rounded-full bg-[var(--base-fill)] px-2.5 py-1.5">Situação <b>Em implantação</b></span>
				</div>
			</div>
		</Cartao>
	);
}

// ------------------------------------------------------------------ 2. Carteira (renomeia a principal)
export function PassoCarteira({ sit, onVoltar, onSalvo }: { sit: Situacao; onVoltar: () => void; onSalvo: () => Promise<void> }) {
	const { refreshCredores } = useMotorAuth();
	const c = sit.carteira;
	const [nome, setNome] = useState(c && c.nome !== 'Carteira principal' ? c.nome : '');
	const [entrada, setEntrada] = useState<'arquivo' | 'api'>((c?.entrada_carga as 'arquivo' | 'api') ?? 'arquivo');
	const [busy, setBusy] = useState(false);
	const [erro, setErro] = useState('');
	async function salvar() {
		if (!supabase) return;
		setBusy(true); setErro('');
		const { error } = await supabase.rpc('salvar_carteira_implantacao', { empresa: sit.empresa.id, nome: nome.trim(), entrada });
		if (error) { setErro(friendlyError(error)); setBusy(false); return; }
		await refreshCredores();
		await onSalvo();
		setBusy(false);
	}
	return (
		<Cartao n={2} quem="cliente ou equipe" titulo="Carteira" desc={<>A carteira é o conjunto de contratos de um credor. A {sit.empresa.nome} já tem uma, a <b>{c?.nome ?? 'Carteira principal'}</b>: só dê o nome certo.</>}
			rodape={<><Botao tipo="secundario" onClick={onVoltar}>Voltar</Botao><Botao onClick={() => void salvar()} disabled={busy}>{busy ? 'Salvando…' : 'Salvar e continuar'}</Botao></>}>
			{erro && <div className="mb-4"><Aviso tom="erro">{erro}</Aviso></div>}
			<div className="grid gap-3.5 sm:grid-cols-2">
				<Campo rotulo="Nome da carteira" ajuda={<>Identificador: <span className="font-mono">{c?.codigo ?? 'gerado do nome'}</span> (usado nos arquivos; não muda).</>}>
					<input className={inCls} style={campoStyle} value={nome} onChange={e => setNome(e.target.value)} placeholder="Ex.: Banco Horizonte · Cartões" />
				</Campo>
				<Campo rotulo="Como a carga chega" ajuda="Dá para trocar depois.">
					<Segmentos rotulo="Como a carga chega" valor={entrada} onTrocar={setEntrada} itens={[{ v: 'arquivo', n: 'Arquivo pelo site' }, { v: 'api', n: 'Pela API' }]} />
				</Campo>
			</div>
			<div className="mt-4"><Aviso tom="info">Tem mais de um credor? Crie as outras carteiras depois em <b>Cobrança › Carteiras</b>. Para rodar, uma basta.</Aviso></div>
		</Cartao>
	);
}

// ------------------------------------------------------------------ 3. Primeira carga (colunas conferidas antes)
export function PassoCarga({ sit, recarregar, onVoltar, onContinuar }: { sit: Situacao; recarregar: () => Promise<Situacao | null>; onVoltar: () => void; onContinuar: () => void }) {
	const { empresa } = useMotorAuth();
	const [arquivo, setArquivo] = useState<File | null>(null);
	const [leitura, setLeitura] = useState<LeituraArquivo | null>(null);
	const [colunas, setColunas] = useState<ColunasCarga>({});
	const [busy, setBusy] = useState(false);
	const [erro, setErro] = useState('');
	const [trocar, setTrocar] = useState(false);
	const input = useRef<HTMLInputElement>(null);
	const rc = resumoCarga(sit);
	const esperando = sit.carga?.status === 'aguardando';
	const cabServidor = sit.mapeamento?.cabecalho ?? [];
	const cab = leitura?.cabecalho ?? (esperando ? cabServidor : []);
	const reconhecido = useMemo(() => (leitura ? reconhecer(leitura.cabecalho) : (sit.mapeamento?.sugerido ?? {})), [leitura, sit.mapeamento?.sugerido]);

	useEffect(() => {
		if (!leitura && esperando) setColunas(combinar(sit.mapeamento?.colunas, sit.mapeamento?.sugerido ?? {}, cabServidor));
	}, [esperando, leitura, sit.mapeamento?.colunas, sit.mapeamento?.sugerido]); // eslint-disable-line react-hooks/exhaustive-deps

	async function escolher(f: File | undefined) {
		if (!f) return;
		setErro('');
		if (!/\.(csv|txt|xlsx)$/i.test(f.name)) { setErro('Escolha um arquivo CSV, TXT ou XLSX.'); return; }
		if (f.size > 50 * 1024 * 1024) { setErro('O arquivo pode ter até 50 MB.'); return; }
		try {
			const l = await lerArquivo(f);
			if (!l.cabecalho.length) { setErro('Não achamos o cabeçalho na primeira linha do arquivo.'); return; }
			setArquivo(f); setLeitura(l);
			setColunas(combinar(sit.mapeamento?.colunas, reconhecer(l.cabecalho), l.cabecalho));
		} catch {
			setErro('Não conseguimos abrir o arquivo. Salve como .xlsx ou .csv (UTF-8) e escolha de novo.');
		}
	}

	const problema = cab.length ? validar(colunas, cab) : '';

	async function enviar() {
		if (!supabase || !sit.carteira) return;
		const slug = sit.empresa.slug || empresa?.slug;
		setBusy(true); setErro('');
		const salvo = await supabase.rpc('salvar_mapeamento_base', { credor: sit.carteira.id, colunas: paraSalvar(colunas), cabecalho: leitura ? leitura.cabecalho : null });
		if (salvo.error) { setErro(friendlyError(salvo.error)); setBusy(false); return; }
		if (arquivo && leitura && slug) {
			const caminho = `${slug}/base/${today()}/${Date.now()}_${safeFileName(arquivo.name)}`;
			const up = await supabase.storage.from('entradas').upload(caminho, arquivo, { contentType: 'text/csv', upsert: false });
			if (up.error) { setErro('Não foi possível enviar o arquivo. Tente de novo.'); setBusy(false); return; }
			const ins = await supabase.from('envios').insert({ empresa_id: sit.empresa.id, credor_id: sit.carteira.id, tipo: 'base', caminho, nome_original: arquivo.name });
			if (ins.error) { setErro(friendlyError(ins.error)); setBusy(false); return; }
			try { await logAccess('envio', caminho, String(sit.empresa.id)); } catch { /* registro do acesso não segura o envio */ }
		}
		setArquivo(null); setLeitura(null); setTrocar(false);
		await recarregar();
		setBusy(false);
	}

	const ex = sit.execucao;
	const cc = comContato(sit);
	const contatos = ex?.contatos ? Object.entries(ex.contatos).filter(([k]) => k !== 'INVALIDO').reduce((a, [, v]) => a + Number(v || 0), 0) : null;
	const processada = sit.carga?.status === 'processado' && !trocar;
	const mostraMapa = !!leitura || (esperando && cab.length > 0);

	return (
		<Cartao n={3} quem="cliente" titulo="Primeira carga" desc={<>Solte a carteira do jeito que o credor manda. Conferimos as colunas <b>antes</b> de enviar.</>}
			rodape={<><Botao tipo="secundario" onClick={onVoltar}>Voltar</Botao>
				{mostraMapa ? <Botao onClick={() => void enviar()} disabled={busy || !!problema}>{busy ? 'Enviando…' : leitura ? 'Enviar e processar' : 'Usar estas colunas e processar'}</Botao>
					: <Botao onClick={onContinuar} disabled={!processada}>Continuar</Botao>}</>}>
			{erro && <div className="mb-4"><Aviso tom="erro">{erro}</Aviso></div>}
			{sit.carteira?.entrada_carga === 'api' && !processada && <div className="mb-4"><Aviso tom="info">Esta carteira recebe a carga pela API: <span className="font-mono">POST /v1/cargas?credor={sit.carteira.codigo}</span>. Também dá para soltar um arquivo aqui para a primeira carga.</Aviso></div>}

			{processada ? <>
				<Aviso tom="ok" titulo="Carga processada.">{sit.lista ? 'A primeira Lista do dia já está pronta. Os números abaixo vêm da rotina.' : 'Os números abaixo vêm da rotina.'}</Aviso>
				<div className="my-4"><Kpis itens={[
					{ rotulo: 'Clientes em cobrança', valor: numberBR(ex?.na_carga ?? 0) },
					{ rotulo: 'Com ação na Lista do dia', valor: numberBR(sit.lista?.clientes ?? 0) },
					contatos != null && { rotulo: 'Telefones e e-mails válidos', valor: numberBR(contatos) },
					cc && { rotulo: 'Sem nenhum contato', valor: numberBR(cc.total - cc.com), tom: cc.total - cc.com > 0 ? 'atencao' : undefined },
				]} /></div>
				<p className="text-[13px] text-[var(--base-texto-2)]">Próxima Lista do dia: <b>{proximaLista(sit)}</b>.</p>
				<p className="mt-1 text-[13px] text-[var(--base-texto-2)]">Ocorrência, acordo e pagamento podem vir depois. Quando o primeiro chegar, pedimos para conferir as colunas. <button type="button" className="font-semibold text-[var(--destaque)] hover:underline" onClick={() => setTrocar(true)}>Enviar outra carga</button></p>
			</> : <>
				{sit.carga && sit.carga.status !== 'processado' && !leitura && (
					<div className="mb-4"><Aviso tom={rc.estado === 'atencao' ? 'info' : 'atencao'} titulo={rc.titulo}>{rc.estado === 'atencao' ? <>{rc.detalhe} A primeira Lista do dia sai <b>minutos depois da carga</b>.</> : rc.detalhe}</Aviso></div>
				)}
				{!(esperando && !leitura) && (
					<div onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); void escolher(e.dataTransfer.files?.[0]); }}
						className="flex flex-wrap items-center gap-3.5 rounded-2xl border-2 border-dashed border-[var(--base-field-border)] bg-[var(--base-fill)] p-4">
						<span className="grid h-12 w-10 place-items-center rounded-md bg-[var(--base-cartao)] text-[10px] font-bold text-[var(--estado-pronto-texto)]" style={{ boxShadow: SOMBRA }}>{arquivo ? <FileSpreadsheet size={18} /> : <UploadCloud size={18} />}</span>
						<div className="min-w-0 flex-1">
							<b className="block truncate text-[14px] text-[var(--base-texto)]">{arquivo ? arquivo.name : 'Solte aqui a carga geral'}</b>
							<span className="text-[12px] text-[var(--base-texto-2)]">{arquivo && leitura ? `${(arquivo.size / 1024 / 1024).toFixed(1).replace('.', ',')} MB · separador ${leitura.separador}` : 'CSV, TXT ou XLSX, até 50 MB. Lemos só o cabeçalho antes de enviar.'}</span>
						</div>
						<input ref={input} type="file" accept=".csv,.txt,.xlsx" className="sr-only" aria-label="Escolher a carga geral" onChange={e => { void escolher(e.target.files?.[0]); e.target.value = ''; }} />
						<Botao tipo="secundario" pequeno onClick={() => input.current?.click()}>{arquivo ? 'Trocar' : 'Escolher arquivo'}</Botao>
					</div>
				)}
				{mostraMapa && <div className="mt-4">
					<h3 className="mb-2 text-[15px] font-semibold text-[var(--base-texto)]">O que reconhecemos</h3>
					<MapeamentoCarga cabecalho={cab} colunas={colunas} reconhecido={reconhecido} onTrocar={setColunas} linhas={leitura?.linhas} />
					{problema ? <div className="mt-3"><Aviso tom="atencao">{problema} Escolha nos seletores acima.</Aviso></div>
						: <p className="mt-3 text-[13px] text-[var(--base-texto-2)]">Tudo apontado. {leitura ? 'Ao enviar, guardamos as colunas: as próximas cargas desta carteira já entram sozinhas.' : 'A carga que esperava entra em seguida.'}</p>}
				</div>}
			</>}
		</Cartao>
	);
}

// ------------------------------------------------------------------ 4. Como acionar
export function PassoAcionar({ sit, onVoltar, onSalvo }: { sit: Situacao; onVoltar: () => void; onSalvo: () => Promise<void> }) {
	const [quem, setQuem] = useState<Record<CanalAssistente, QuemEnvia>>(() => Object.fromEntries(CANAIS_ASSISTENTE.map(c => [c.id, quemEnviaAtual(sit, c.id, c.padrao)])) as Record<CanalAssistente, QuemEnvia>);
	const [frases, setFrases] = useState(() => Object.fromEntries(FRASES_PADRAO_SMS.map(f => [f.estagio, f.texto(sit.empresa.nome)])) as Record<string, string>);
	const [aprovacao, setAprovacao] = useState<Aprovacao>(sit.mensageria.aprovar_lotes === false ? 'automatico' : sit.mensageria.aprovar_primeiro || sit.mensageria.aprovar_lotes == null ? 'primeiro' : 'todo_dia');
	const [busy, setBusy] = useState(false);
	const [erro, setErro] = useState('');
	const algumMotorcx = Object.values(quem).includes('motorcx');
	const canais = CANAIS_ASSISTENTE.filter(c => c.id !== 'agente_voz' || sit.agente_voz);

	async function salvar() {
		if (!supabase) return;
		setBusy(true); setErro('');
		const enviar = Object.fromEntries(canais.map(c => [c.id, quem[c.id]]));
		const fr = quem.sms !== 'desligado' ? FRASES_PADRAO_SMS.map(f => ({ estagio: f.estagio, texto: frases[f.estagio] ?? '' })) : null;
		const { error } = await supabase.rpc('salvar_canais_implantacao', { empresa: sit.empresa.id, canais: enviar, aprovacao: algumMotorcx ? aprovacao : null, frases: fr });
		if (error) { setErro(friendlyError(error)); setBusy(false); return; }
		await onSalvo();
		setBusy(false);
	}

	return (
		<Cartao n={4} quem="cliente" titulo="Como acionar" desc={<>A {sit.empresa.nome} começa com a <b>Régua padrão MotorCX</b>, a do Playbook. Personalize na Orquestração quando quiser; não precisa para rodar.</>}
			rodape={<><Botao tipo="secundario" onClick={onVoltar}>Voltar</Botao><Botao onClick={() => void salvar()} disabled={busy}>{busy ? 'Salvando…' : 'Salvar e ver o que falta'}</Botao></>}>
			{erro && <div className="mb-4"><Aviso tom="erro">{erro}</Aviso></div>}
			<div className="grid gap-2">
				{REGUA_PADRAO.map(r => (
					<div key={r.etapa} className="grid items-center gap-3 rounded-xl bg-[var(--base-fill)] px-3 py-2.5 sm:grid-cols-[170px_1fr]">
						<div><b className="text-[14px] text-[var(--base-texto)]">{r.etapa}</b><small className="block text-[12px] text-[var(--base-texto-2)]">{r.sub}</small></div>
						<div className="flex flex-wrap gap-1.5">{r.passos.map(p => <span key={p.texto} className={`rounded-full px-2.5 py-0.5 text-[12px] font-semibold ${quem[p.canal] === 'desligado' ? 'bg-[var(--base-cartao)] text-[var(--base-texto-3)] line-through' : 'bg-[var(--base-cartao)] text-[var(--base-texto)]'}`} style={{ boxShadow: SOMBRA }}>{p.texto}</span>)}</div>
					</div>
				))}
			</div>
			<p className="mt-2 text-[12px] text-[var(--base-texto-2)]">Canal desligado é pulado: o próximo da régua assume. <Link to="/orquestracao" className="font-semibold text-[var(--destaque)] hover:underline">Personalizar depois na Orquestração</Link></p>

			<div className="mt-5 border-t border-[var(--base-separator)] pt-4">
				<h3 className="mb-2.5 text-[15px] font-semibold text-[var(--base-texto)]">Canais: quem envia cada um</h3>
				<div className="grid gap-2">
					{canais.map(c => {
						const itens: { v: QuemEnvia; n: string }[] = [
							{ v: 'lista', n: c.voz ? 'Lista para baixar (seu discador)' : 'Lista para baixar (seu fornecedor)' },
							...(podeMotorcx(sit, c.id) ? [{ v: 'motorcx' as QuemEnvia, n: ROTULO_QUEM.motorcx }] : []),
							{ v: 'desligado', n: ROTULO_QUEM.desligado },
						];
						return (
							<div key={c.id} className="grid items-center gap-2 rounded-xl border border-[var(--base-borda)] p-3 sm:grid-cols-[120px_1fr_auto]" data-canal={c.id}>
								<b className="text-[13.5px] text-[var(--base-texto)]">{c.nome}</b>
								<Segmentos rotulo={`Quem envia o ${c.nome}`} valor={quem[c.id]} onTrocar={v => setQuem(q => ({ ...q, [c.id]: v }))} itens={itens} />
								<span className="text-[12px] text-[var(--base-texto-2)] sm:text-right">{quem[c.id] === 'lista' ? `${c.id}.csv na Lista do dia` : c.obs}</span>
							</div>
						);
					})}
				</div>
				{!sit.mensageria.contratada && <p className="mt-2 text-[12px] text-[var(--base-texto-2)]">"MotorCX envia" aparece com a Mensageria contratada. Sem ela, cada canal sai como lista para o fornecedor da empresa enviar.</p>}
				{quem.sms !== 'desligado' && (
					<div className="mt-3">
						<Detalhes resumo={<span>Frases do SMS por etapa <span className="font-normal text-[var(--base-texto-2)]">(padrão, editáveis{quem.sms === 'lista' ? '; saem na coluna mensagem da lista' : ''})</span></span>}>
							<div className="grid gap-3 pt-2">
								{FRASES_PADRAO_SMS.map(f => (
									<label key={f.estagio} className="grid gap-1 text-[13px] font-semibold text-[var(--base-texto)]">
										SMS · {f.etapa} <span className="text-[11.5px] font-normal text-[var(--base-texto-3)]">{(frases[f.estagio] ?? '').length}/160 · variáveis: {'{saldo}'} {'{dias_atraso}'} {'{vencimento}'} {'{valor_parcela}'}</span>
										<textarea rows={2} maxLength={160} className={textareaCls} style={campoStyle} value={frases[f.estagio] ?? ''} onChange={e => setFrases(x => ({ ...x, [f.estagio]: e.target.value }))} />
									</label>
								))}
							</div>
						</Detalhes>
					</div>
				)}
			</div>

			{algumMotorcx && (
				<div className="mt-5 border-t border-[var(--base-separator)] pt-4">
					<h3 className="mb-2.5 text-[15px] font-semibold text-[var(--base-texto)]">Aprovação dos lotes que a MotorCX envia</h3>
					<Segmentos rotulo="Aprovação dos lotes" valor={aprovacao} onTrocar={setAprovacao} itens={[{ v: 'todo_dia', n: 'Aprovar todo dia' }, { v: 'primeiro', n: 'Aprovar o primeiro, depois automático' }, { v: 'automatico', n: 'Automático' }]} />
					<p className="mt-1.5 text-[12px] text-[var(--base-texto-2)]">Com "todo dia", o lote fica parado até alguém aprovar, e parece que o canal não envia.</p>
				</div>
			)}
		</Cartao>
	);
}

// ------------------------------------------------------------------ 5. Pronto para rodar
const COR_ESTADO = { ok: 'var(--estado-pronto)', atencao: 'var(--estado-atencao)', bloqueia: 'var(--estado-erro)', info: 'var(--base-texto-3)' } as const;
const ICONE_ESTADO = { ok: '✓', atencao: '!', bloqueia: '!', info: '–' } as const;

export function PassoPronto({ sit, equipe, recarregar, onVoltar, onIr }: { sit: Situacao; equipe: boolean; recarregar: () => Promise<Situacao | null>; onVoltar: () => void; onIr: (n: number) => void }) {
	const grupos = useMemo(() => checklist(sit, { equipe }), [sit, equipe]);
	const [email, setEmail] = useState(sit.contatos.find(c => c.email)?.email ?? '');
	const [busy, setBusy] = useState('');
	const [msg, setMsg] = useState<{ tom: 'ok' | 'erro'; texto: string } | null>(null);
	const pv = textoPrevia(sit);
	const nomeMes = new Date(`${sit.hoje}T12:00:00Z`).toLocaleDateString('pt-BR', { month: 'long', timeZone: 'UTC' });

	async function fazer(i: Item) {
		if (!supabase || !i.acao?.fazer) return;
		setBusy(i.id); setMsg(null);
		if (i.acao.fazer === 'contato_fatura') {
			const { error } = await supabase.rpc('definir_contato_fatura', { empresa: sit.empresa.id, email: email.trim(), nome: null });
			if (error) setMsg({ tom: 'erro', texto: friendlyError(error) }); else { setMsg({ tom: 'ok', texto: 'Contato da fatura salvo.' }); await recarregar(); }
		} else if (i.acao.fazer === 'reenviar_convite' && sit.admin.id) {
			const { error } = await supabase.functions.invoke('admin-usuarios', { body: { acao: 'resetar_senha', usuario_id: sit.admin.id } });
			setMsg(error ? { tom: 'erro', texto: 'O convite não saiu. Tente de novo em instantes.' } : { tom: 'ok', texto: 'Enviamos de novo o link para criar a senha.' });
		}
		setBusy('');
	}

	async function ativar() {
		if (!supabase) return;
		setBusy('ativar'); setMsg(null);
		const { error } = await supabase.rpc('mudar_situacao_empresa', { empresa: sit.empresa.id, nova: 'ativa', motivo: null });
		if (error) setMsg({ tom: 'erro', texto: friendlyError(error) }); else { setMsg({ tom: 'ok', texto: 'Empresa ativa.' }); await recarregar(); }
		setBusy('');
	}

	return (
		<Cartao n={5} titulo="Pronto para rodar" desc="Cada linha vem do que já aconteceu: ninguém marca à mão. O vermelho impede de rodar; o âmbar não impede."
			rodape={<><Botao tipo="secundario" onClick={onVoltar}>Voltar</Botao>{equipe && sit.empresa.situacao === 'implantacao' && <Botao tipo="secundario" onClick={() => void ativar()} disabled={!!busy}>Ativar empresa (Implantação → Ativa)</Botao>}</>}>
			{msg && <div className="mb-4"><Aviso tom={msg.tom}>{msg.texto}</Aviso></div>}
			<div className="mb-4 rounded-2xl p-4" style={{ boxShadow: SOMBRA, background: 'linear-gradient(135deg, var(--destaque-suave), transparent 70%), var(--base-cartao)' }}>
				<b className="text-[17px] text-[var(--base-texto)]" data-teste="heroi">{heroi(grupos)}</b>
				<p className="mt-1 text-[13px] text-[var(--base-texto-2)]">Próxima Lista do dia: <b>{proximaLista(sit)}</b>.</p>
			</div>
			<div className="mb-4 grid gap-2.5 sm:grid-cols-3">
				<div className="rounded-xl bg-[var(--base-fill)] p-3"><p className="text-[12px] text-[var(--base-texto-2)]">Lista do dia{sit.lista ? ` de ${sit.lista.data.split('-').reverse().slice(0, 2).join('/')}` : ''}</p><strong className="block text-[18px] tnum text-[var(--base-texto)]">{sit.lista ? `${numberBR(sit.lista.acoes)} ações` : '—'}</strong></div>
				<div className="rounded-xl bg-[var(--base-fill)] p-3"><p className="text-[12px] text-[var(--base-texto-2)]">CPFs ativos em {nomeMes}</p><strong className="block text-[18px] tnum text-[var(--base-texto)]">{pv ? pv.cpfs : '—'}</strong></div>
				<div className="rounded-xl bg-[var(--base-fill)] p-3"><p className="text-[12px] text-[var(--base-texto-2)]">Fatura prevista ({nomeMes})</p><strong className="block text-[18px] tnum text-[var(--base-texto)]" data-teste="fatura-prevista">{pv ? pv.valor : '—'}</strong>{pv && <p className="text-[12px] text-[var(--base-texto-2)]">{pv.conta}</p>}</div>
			</div>
			{grupos.map(g => (
				<div key={g.titulo}>
					<p className="mb-0.5 mt-4 text-[12px] font-semibold uppercase tracking-wide text-[var(--base-texto-3)]">{g.titulo}</p>
					{g.itens.map((i, k) => (
						<div key={i.id} className={`grid grid-cols-[26px_1fr] items-start gap-3 py-3 sm:grid-cols-[26px_1fr_auto] ${k ? 'border-t border-[var(--base-separator)]' : ''}`} data-item={i.id} data-estado={i.estado}>
							<span className="mt-px grid h-[22px] w-[22px] place-items-center rounded-full text-[12px] font-extrabold text-white" style={{ backgroundColor: COR_ESTADO[i.estado] }} aria-label={i.estado === 'ok' ? 'pronto' : i.estado === 'bloqueia' ? 'impede' : i.estado === 'atencao' ? 'atenção' : 'depois'}>{ICONE_ESTADO[i.estado]}</span>
							<div className="min-w-0"><b className="text-[14px] font-semibold text-[var(--base-texto)]">{i.titulo}</b><p className="mt-0.5 text-[13px] text-[var(--base-texto-2)]">{i.detalhe}</p></div>
							<div className="col-start-2 flex flex-wrap items-center gap-2 sm:col-start-auto">
								{i.estado === 'ok' && !i.acao && <Pilula tom="ok">Pronto</Pilula>}
								{i.acao?.fazer === 'contato_fatura' && <input type="email" aria-label="E-mail de quem recebe a fatura" className={`${campoCls} h-8 w-[220px]`} style={campoStyle} value={email} onChange={e => setEmail(e.target.value)} placeholder="financeiro@empresa.com.br" />}
								{i.acao && (i.acao.to ? <BotaoLink to={i.acao.to} pequeno tipo={i.estado === 'bloqueia' ? 'primario' : 'secundario'}>{i.acao.rotulo}</BotaoLink>
									: i.acao.passo ? <Botao pequeno tipo={i.estado === 'bloqueia' ? 'primario' : 'secundario'} onClick={() => onIr(i.acao!.passo!)}>{i.acao.rotulo}</Botao>
										: <Botao pequeno tipo="secundario" disabled={busy === i.id} onClick={() => void fazer(i)}>{i.acao.rotulo}</Botao>)}
							</div>
						</div>
					))}
				</div>
			))}
		</Cartao>
	);
}
