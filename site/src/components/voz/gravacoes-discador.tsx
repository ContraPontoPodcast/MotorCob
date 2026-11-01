// Tela 8 · Cobrança › Cargas › Gravações do discador (protótipo aprovado + SQL 64, importador).
// Fontes por empresa (envio pelo site, SFTP do discador, HTTPS), quantas a empresa quiser: o Admin (importar_gravacoes)
// ou a equipe com gerenciar_troncos_voz cadastra (salvar_fonte_gravacoes) e pede "Ler agora". A credencial fica no
// cofre (só a equipe gera a referência; o valor vai direto ao Secret Manager). Quem envia arquivos sobe o manifesto e
// os áudios aqui. Registro da importação por execução e por arquivo (linhas, importadas, casadas com a transferência
// do agente de IA, recusadas e os motivos) e a quarentena. Gravação sem par nunca é casada no palpite.
// Redesign v2: abas Importações, Quarentena, Fontes e Transcrição; "Enviar gravações" é a ação principal e abre o
// importador em tela própria (EnviarGravacoesPagina); detalhe da importação e fonte nova em gavetas.
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router';
import { Download, KeyRound, Pencil, Plus, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { Loading, Notice, PageHeading } from '@/components/app-shell';
import { useMotorAuth } from '@/components/auth-provider';
import { supabase, friendlyError, type Row } from '@/lib/supabase';
import { ADAPTADORES, baixarTexto, dataHoraCurta, diaISO, inteiro, paraCsv, reais } from '@/lib/voz';
import { NOME_FORMA, ORIGEM, PERM_IMPORT, motivoLabel, resumoMotivos, situacaoExecucao, type Execucao } from '@/lib/importador';
import { Aviso, Botao, Cartao, Pilula, SubAbas, Vazio } from './ui';
import { Abas, BotaoLink, Gaveta, Kpis, ListaValores, SeloRegras, Tabela as TabelaDs } from '@/components/ds';
import { EnvioGravacoes, FonteForm, erroRpc, type Fonte } from './importador-partes';

type Arquivo = { id: number; execucao_id: number; nome: string; linhas: number; importadas: number; casadas: number; duplicadas: number; rejeitadas: number; erro: string | null; motivos: Record<string, number> };
type Quarentena = { id: number; execucao_id: number; ref_gravacao: string; motivo: string; linha: number | null; detalhe: string | null; criado_em: string };
type Lote = { id: number; config_id: number; situacao: string; enviado_em: string; arquivos: unknown[] };

const COLS_FONTE = 'id,nome,adaptador,forma,segredo_ref,host,porta,usuario,chave_host,pasta,url_lista,dominios_url,leitura_automatica,intervalo_horas,so_transferencias,janela_par_s,dias_busca,transcrever,ativo,pedido_em,ultima_leitura_em';
const COLS_EXEC = 'id,config_id,origem,iniciada_em,terminada_em,arquivos,lidas,importadas,casadas,duplicadas,quarentena,sem_operador,minutos,erro';

function situacaoFonte(f: Fonte): { tom: 'ok' | 'atencao' | 'neutro' | 'info'; txt: string } {
	if (f.forma === 'sftp' && !f.segredo_ref) return { tom: 'atencao', txt: 'Sem credencial' };
	if (!f.ativo) return { tom: 'neutro', txt: 'Pausada' };
	if (f.pedido_em) return { tom: 'info', txt: 'Leitura pedida' };
	return { tom: 'ok', txt: 'Ativa' };
}

export function GravacoesDiscador() {
	const { empresa, permissoes } = useMotorAuth();
	const [fontes, setFontes] = useState<Fonte[]>([]);
	const [execs, setExecs] = useState<Execucao[]>([]);
	const [arqs, setArqs] = useState<Arquivo[]>([]);
	const [quar, setQuar] = useState<Quarentena[]>([]);
	const [lotes, setLotes] = useState<Lote[]>([]);
	const [vozCfg, setVozCfg] = useState<Row | null>(null);
	const [precoTransc, setPrecoTransc] = useState<number | null>(null);
	const [podeEditar, setPodeEditar] = useState(false);
	const [equipe, setEquipe] = useState(false);
	const [editando, setEditando] = useState<Fonte | 'nova' | null>(null);
	const [execSel, setExecSel] = useState<number | null>(null);
	const [aba, setAba] = useState<'importacoes' | 'quarentena' | 'fontes' | 'transcricao'>('importacoes');
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState('');
	const [versao, setVersao] = useState(0);
	const recarregar = useCallback(() => setVersao(v => v + 1), []);
	const podeEnviar = permissoes.includes(PERM_IMPORT.enviar) || equipe;

	useEffect(() => {
		if (!supabase || !empresa) return;
		const sb = supabase;
		const eid = Number(empresa.id);
		let active = true;
		setError('');
		(async () => {
			const [c, e, q, l, v, p, ed, cv] = await Promise.all([
				sb.from('voz_import_config').select(COLS_FONTE).eq('empresa_id', eid).order('id'),
				sb.from('voz_import_execucoes').select(COLS_EXEC).eq('empresa_id', eid).order('iniciada_em', { ascending: false }).limit(30),
				sb.from('voz_import_quarentena').select('id,execucao_id,ref_gravacao,motivo,linha,detalhe,criado_em').eq('empresa_id', eid).order('criado_em', { ascending: false }).limit(200),
				sb.from('voz_import_lotes').select('id,config_id,situacao,enviado_em,arquivos').eq('empresa_id', eid).in('situacao', ['pendente', 'processando']).order('id', { ascending: false }).limit(20),
				sb.from('voz_config').select('transcrever,transcrever_min_segundos,retencao_dias,bucket_gravacoes').eq('empresa_id', eid).maybeSingle(),
				sb.from('precos_empresa').select('preco,modelo').eq('empresa_id', eid).eq('item', 'voz_transcricao').lte('vigente_desde', diaISO()).order('vigente_desde', { ascending: false }).limit(1),
				sb.rpc('edita_fontes_gravacoes', { eid }),
				sb.rpc('cuida_voz', { eid }),
			]);
			if (!active) return;
			if (c.error) { setError(friendlyError(c.error)); setLoading(false); return; }
			const ex = (e.data ?? []) as Execucao[];
			setFontes((c.data ?? []) as Fonte[]);
			setExecs(ex);
			setQuar((q.data ?? []) as Quarentena[]);
			setLotes((l.data ?? []) as Lote[]);
			setVozCfg((v.data as Row | null) ?? null);
			const pr = (p.data as Row[] | null)?.[0];
			setPrecoTransc(pr && pr.modelo === 'flat' && pr.preco != null ? Number(pr.preco) : null);
			setPodeEditar(ed.data === true);
			setEquipe(cv.data === true);
			if (ex.length) {
				const a = await sb.from('voz_import_arquivos').select('id,execucao_id,nome,linhas,importadas,casadas,duplicadas,rejeitadas,erro,motivos').in('execucao_id', ex.map(x => x.id)).order('id');
				if (active) setArqs((a.data ?? []) as Arquivo[]);
			} else setArqs([]);
			setLoading(false);
		})();
		return () => { active = false; };
	}, [empresa?.id, versao]);

	async function lerAgora(f: Fonte, reprocessar = false) {
		if (!supabase) return;
		const { error: er } = await supabase.rpc('pedir_leitura_gravacoes', { fonte: f.id, reprocessar });
		if (er) { toast.error(erroRpc(er, 'Não foi possível pedir a leitura.')); return; }
		toast.success(reprocessar ? 'Pedido feito: o MotorCX relê todos os arquivos da pasta (sem duplicar gravações).' : 'Pedido feito: o MotorCX lê em até 15 minutos.');
		recarregar();
	}

	async function gerarCredencial(f: Fonte) {
		if (!supabase) return;
		const { data, error: er } = await supabase.rpc('trocar_credencial_fonte_gravacoes', { fonte: f.id });
		if (er) { toast.error(erroRpc(er, 'Não foi possível gerar a referência.')); return; }
		toast.success(`Referência no cofre: ${String(data)}. Grave o valor no Secret Manager com o comando do README (seção 8).`);
		recarregar();
	}

	function baixarQuarentena() {
		// Só a referência do discador (mascarada quando parece telefone), a linha e o motivo: o nome do arquivo nunca é guardado.
		baixarTexto(`quarentena-gravacoes-${diaISO()}.csv`, paraCsv(['ref_gravacao', 'linha', 'motivo', 'detalhe', 'quando'],
			quar.map(q => [q.ref_gravacao, q.linha ?? '', motivoLabel(q.motivo), q.detalhe ?? '', q.criado_em])));
	}

	const nomeFonte = (id: number) => fontes.find(f => f.id === id)?.nome ?? `Fonte ${id}`;
	const hoje = diaISO();
	const deHoje = execs.filter(e => diaISO(0, new Date(e.iniciada_em)) === hoje);
	const somaHoje = deHoje.reduce((t, e) => ({ lidas: t.lidas + e.lidas, importadas: t.importadas + e.importadas, casadas: t.casadas + e.casadas, quarentena: t.quarentena + e.quarentena }), { lidas: 0, importadas: 0, casadas: 0, quarentena: 0 });
	const ultima = execs[0] ?? null;
	const minS = Number(vozCfg?.transcrever_min_segundos ?? 5);
	const retencao = Number(vozCfg?.retencao_dias ?? 90);
	const transcreve = fontes.filter(f => f.transcrever && f.ativo);
	const execAtual = execs.find(e => e.id === execSel) ?? null;
	const arqsSel = execAtual ? arqs.filter(a => a.execucao_id === execAtual.id) : [];

	const regras = <SeloRegras rotulo="Regras" regras={[
		{ titulo: 'Gravação sem par não é casada no palpite', texto: 'Vai para a quarentena, com o motivo.' },
		{ titulo: 'O nome do arquivo nunca é guardado', texto: 'Não pode ter telefone ou CPF; se tiver, a gravação vai para a quarentena e o nome é descartado.' },
		{ titulo: 'A credencial fica no cofre', texto: 'Nunca é digitada aqui: a equipe MotorCX grava no Secret Manager.' },
		{ titulo: `Retenção de ${retencao} dias`, texto: 'A mesma da empresa (mínimo 90).' },
	]} />;

	return (
		<>
			<PageHeading title="Gravações do discador" description="Cargas › Gravações · para transcrever e analisar as ligações feitas pelo discador de vocês"
				actions={podeEnviar ? <BotaoLink tipo="primario" to="/envios/gravacoes-discador/enviar">Enviar gravações</BotaoLink> : undefined} />
			<SubAbas atual="gravacoes" itens={[{ id: 'carga', nome: 'Enviar carga', to: '/envios' }, { id: 'gravacoes', nome: 'Gravações do discador' }]} />
			{!empresa ? <Notice variant="warning">Escolha a empresa no topo para ver esta página.</Notice> : loading ? <Loading /> : error ? <Notice>{error}</Notice> : (
				<div className="space-y-4">
					{vozCfg && !vozCfg.bucket_gravacoes && <Aviso tom="atencao" titulo="A empresa ainda não tem o bucket de gravações.">A importação fica com erro até a equipe MotorCX criar o bucket. <Link to="/suporte/novo" className="underline">Pedir pelo Suporte</Link>.</Aviso>}
					<Kpis itens={[
						{ rotulo: 'Última leitura', valor: ultima ? dataHoraCurta(ultima.iniciada_em) : '—', detalhe: !ultima ? 'Ainda não houve leitura.' : ultima.erro ? <span className="text-[var(--estado-erro-texto)]">com erro</span> : ultima.terminada_em ? nomeFonte(ultima.config_id) : 'em andamento' },
						{ rotulo: 'Importadas hoje', valor: deHoje.length ? inteiro(somaHoje.importadas) : '—', detalhe: deHoje.length ? `de ${inteiro(somaHoje.lidas)} linhas` : 'Nenhuma leitura hoje.' },
						{ rotulo: 'Casadas com a transferência', valor: deHoje.length ? inteiro(somaHoje.casadas) : '—', detalhe: 'parte da IA + parte do operador' },
						{ rotulo: 'Recusadas hoje', valor: deHoje.length ? inteiro(somaHoje.quarentena) : '—', tom: somaHoje.quarentena > 0 ? 'alerta' : undefined, detalhe: 'na quarentena' },
					]} />
					<div className="flex flex-wrap items-start justify-between gap-2">
						<div className="min-w-0 flex-1"><Abas rotulo="Seções das gravações do discador" atual={aba} onTrocar={id => setAba(id as typeof aba)} itens={[
							{ id: 'importacoes', nome: 'Importações' }, { id: 'quarentena', nome: 'Quarentena', cont: quar.length || null }, { id: 'fontes', nome: 'Fontes' }, { id: 'transcricao', nome: 'Transcrição' },
						]} /></div>
						{regras}
					</div>
					{lotes.length > 0 && <Aviso tom="info" titulo={`${lotes.length} envio${lotes.length > 1 ? 's' : ''} aguardando a leitura.`}>O MotorCX lê em até 15 minutos.</Aviso>}

					{aba === 'importacoes' && <Cartao semPadding>
						<TabelaDs rotulo="Importações" linhas={execs} chave={e => e.id} onAbrir={e => setExecSel(e.id)} selecionada={execSel}
							vazio="Nenhuma leitura ainda."
							colunas={[
								{ id: 'q', titulo: 'Quando', celula: e => dataHoraCurta(e.iniciada_em) },
								{ id: 'f', titulo: 'Fonte', celula: e => <span className="block max-w-[220px] truncate">{nomeFonte(e.config_id)}</span> },
								{ id: 'i', titulo: 'Importadas', num: true, celula: e => inteiro(e.importadas) },
								{ id: 'r', titulo: 'Recusadas', num: true, celula: e => inteiro(e.quarentena) },
								{ id: 's', titulo: 'Situação', celula: e => { const x = situacaoExecucao(e); return <Pilula tom={x.tom} title={e.erro ?? undefined}>{x.txt}</Pilula>; } },
							]}
							celular={e => { const x = situacaoExecucao(e); return { titulo: nomeFonte(e.config_id), valor: <Pilula tom={x.tom}>{x.txt}</Pilula>, resumo: `${dataHoraCurta(e.iniciada_em)} · ${inteiro(e.importadas)} importadas · ${inteiro(e.quarentena)} recusadas` }; }} />
					</Cartao>}

					{aba === 'quarentena' && <Cartao semPadding titulo="Quarentena" linha="Gravação sem par não é casada no palpite."
						direita={quar.length ? <Botao secundario onClick={baixarQuarentena}><Download size={14} /> Baixar a lista</Botao> : undefined}>
						<TabelaDs rotulo="Quarentena" linhas={quar.slice(0, 50)} chave={q => q.id} vazio="Nenhuma gravação em quarentena."
							colunas={[
								{ id: 'r', titulo: 'Gravação no discador', celula: q => <span className="font-mono">{q.ref_gravacao}{q.linha ? <small className="ml-1 text-[var(--base-texto-3)]">linha {q.linha}</small> : null}</span> },
								{ id: 'm', titulo: 'Motivo', celula: q => <span className="block max-w-[360px]">{motivoLabel(q.motivo)}{q.detalhe ? <small className="block text-[var(--base-texto-3)]">{q.detalhe}</small> : null}</span> },
								{ id: 'q', titulo: 'Quando', celula: q => dataHoraCurta(q.criado_em) },
							]}
							celular={q => ({ titulo: <span className="break-all font-mono">{q.ref_gravacao}</span>, resumo: `${motivoLabel(q.motivo)}${q.linha ? ` · linha ${q.linha}` : ''} · ${dataHoraCurta(q.criado_em)}` })}
							rodape={quar.length > 0 ? <span>{Math.min(50, quar.length)} de {quar.length}{quar.length >= 200 ? '+' : ''}</span> : undefined} />
					</Cartao>}

					{aba === 'fontes' && <Cartao semPadding titulo="Fontes das gravações" linha="Envio pelo site, SFTP do discador ou HTTPS."
						direita={podeEditar ? <Botao secundario onClick={() => setEditando('nova')}><Plus size={14} /> Nova fonte</Botao> : undefined}>
						{fontes.length === 0 ? (
							<div className="px-4 pb-5 sm:px-5">
								<Vazio titulo="Nenhuma fonte cadastrada ainda.">{podeEditar ? 'Cadastre o SFTP ou a URL do discador, ou envie as gravações pelo site.' : 'Peça ao Admin da empresa para cadastrar a fonte, ou envie as gravações pelo site.'}</Vazio>
							</div>
						) : (
							<ul className="divide-y [&>*]:border-[var(--base-borda)]">
								{fontes.map(f => {
									const st = situacaoFonte(f);
									const adapt = ADAPTADORES.find(a => a.id === f.adaptador)?.nome ?? f.adaptador;
									return (
										<li key={f.id} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-5">
											<div className="min-w-0">
												<p className="flex flex-wrap items-center gap-2"><b className="truncate text-[13.5px] font-semibold text-[var(--base-texto)]">{f.nome}</b><Pilula tom={st.tom}>{st.txt}</Pilula>{f.transcrever && <Pilula tom="info">Transcreve</Pilula>}</p>
												<p className="mt-0.5 break-words text-[12px] text-[var(--base-texto-2)]">{NOME_FORMA[f.forma] ?? f.forma} · {adapt}{f.ultima_leitura_em ? ` · última leitura ${dataHoraCurta(f.ultima_leitura_em)}` : ''}</p>
											</div>
											<div className="flex shrink-0 flex-wrap gap-2">
												{podeEditar && f.forma !== 'arquivo' && f.ativo && <Botao secundario onClick={() => void lerAgora(f)} title="Ler a fonte no próximo ciclo (até 15 minutos)"><RefreshCw size={14} /> Ler agora</Botao>}
												{podeEditar && f.forma === 'sftp' && f.ativo && <Botao secundario onClick={() => void lerAgora(f, true)} title="Relê também os arquivos já lidos (não duplica)">Ler de novo</Botao>}
												{equipe && f.forma !== 'arquivo' && <Botao secundario onClick={() => void gerarCredencial(f)} title="Gera a referência nova no cofre"><KeyRound size={14} /> Credencial</Botao>}
												{podeEditar && f.forma !== 'api' && <Botao secundario onClick={() => setEditando(f)}><Pencil size={14} /> Editar</Botao>}
											</div>
										</li>
									);
								})}
							</ul>
						)}
						{!podeEditar && <p className="border-t border-[var(--base-borda)] px-4 py-2.5 text-[12px] text-[var(--base-texto-3)] sm:px-5">Só o Admin da empresa cadastra e edita as fontes.</p>}
					</Cartao>}

					{aba === 'transcricao' && <Cartao titulo="Transcrever e analisar" linha="As ligações do agente virtual o MotorCX já grava. Aqui entram as do discador: a parte depois da transferência (casada com a ligação do agente) e, se vocês quiserem, as feitas direto pelo discador.">
						<p className="flex flex-wrap items-center gap-2 text-[13px] text-[var(--base-texto)]"><Pilula tom={transcreve.length ? 'ok' : 'neutro'}>{transcreve.length ? 'Ligado' : 'Desligado'}</Pilula> <span className="min-w-0 break-words">{transcreve.length ? `Transcreve as gravações de ${transcreve.map(f => f.nome).join(', ')}` : 'Transcrever as gravações do discador'}</span></p>
						<div className="mt-3"><ListaValores itens={[
							['Transcreve a partir de', `${minS} segundos`],
							['Custo estimado', precoTransc != null ? `${reais(precoTransc, 2)} por minuto` : 'preço do contrato'],
							['Máscara', 'CPF e cartão saem antes de gravar'],
							['Análise', 'as casadas entram no Speech Analytics'],
							['Retenção', `${retencao} dias`],
						]} /></div>
						<p className="mt-3 text-[12px] text-[var(--base-texto-3)]">Ligar ou desligar a transcrição do discador é pedido à equipe MotorCX, porque tem custo por minuto. O corte de segundos fica em <Link to="/empresa/privacidade" className="underline">Empresa › Privacidade e gravações</Link>.</p>
					</Cartao>}

					{editando && <FonteForm key={editando === 'nova' ? 'nova' : editando.id} empresaId={empresa.id} fonte={editando === 'nova' ? null : editando} onFechar={() => setEditando(null)} onSalvo={() => { setEditando(null); recarregar(); }} />}
					<Gaveta aberta={!!execAtual} onFechar={() => setExecSel(null)} titulo={execAtual ? `Leitura de ${dataHoraCurta(execAtual.iniciada_em)}` : ''} subtitulo={execAtual ? `${nomeFonte(execAtual.config_id)} · ${ORIGEM[execAtual.origem] ?? execAtual.origem}` : undefined}>
						{execAtual && <>
							{execAtual.erro && <Aviso tom="erro">{execAtual.erro}</Aviso>}
							<ListaValores itens={[['Arquivos', inteiro(execAtual.arquivos)], ['Linhas do manifesto', inteiro(execAtual.lidas)], ['Importadas', inteiro(execAtual.importadas)], ['Casadas com a transferência', inteiro(execAtual.casadas)], ['Recusadas (quarentena)', inteiro(execAtual.quarentena)]]} />
							<h3 className="text-[13px] font-semibold">Arquivos</h3>
							{arqsSel.length === 0 ? <p className="text-[12.5px] text-[var(--base-texto-2)]">{execAtual.terminada_em ? 'Nenhum arquivo novo nesta leitura.' : 'Lendo…'}</p> : (
								<ul className="space-y-2">
									{arqsSel.map(a => (
										<li key={a.id} className="rounded-xl bg-[var(--base-fill)] px-3 py-2 text-[12.5px]">
											<b className="block break-all font-semibold text-[var(--base-texto)]">{a.nome}</b>
											{a.erro ? <span className="text-[var(--estado-erro-texto)]">Arquivo recusado: {a.erro}</span> : (
												<span className="tnum text-[var(--base-texto-2)]">{inteiro(a.linhas)} linhas · {inteiro(a.importadas)} importadas · {inteiro(a.casadas)} casadas · {inteiro(a.duplicadas)} já importadas · {inteiro(a.rejeitadas)} recusadas</span>
											)}
											{a.rejeitadas > 0 && <span className="mt-0.5 block text-[11.5px] text-[var(--base-texto-3)]">{resumoMotivos(a.motivos)}</span>}
										</li>
									))}
								</ul>
							)}
						</>}
					</Gaveta>
				</div>
			)}
		</>
	);
}

/** Tela própria do envio pelo site (3 passos), em Cargas › Gravações do discador › Enviar gravações. */
export function EnviarGravacoesPagina() {
	const { empresa } = useMotorAuth();
	return (
		<>
			<PageHeading title="Enviar gravações" description="Cargas › Gravações do discador · manifesto e áudios, ou um zip" />
			{!empresa ? <Notice variant="warning">Escolha a empresa no topo para ver esta página.</Notice> : <EnvioGravacoes empresaId={empresa.id} slug={empresa.slug} onEnviado={() => {}} />}
		</>
	);
}
