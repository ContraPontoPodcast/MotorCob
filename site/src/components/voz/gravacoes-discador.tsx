// Tela 8 · Cobrança › Cargas › Gravações do discador (protótipo aprovado + SQL 64, importador).
// Fontes por empresa (envio pelo site, SFTP do discador, HTTPS), quantas a empresa quiser: o Admin (importar_gravacoes)
// ou a equipe com gerenciar_troncos_voz cadastra (salvar_fonte_gravacoes) e pede "Ler agora". A credencial fica no
// cofre (só a equipe gera a referência; o valor vai direto ao Secret Manager). Quem envia arquivos sobe o manifesto e
// os áudios aqui. Registro da importação por execução e por arquivo (linhas, importadas, casadas com a transferência
// do agente de IA, recusadas e os motivos) e a quarentena. Gravação sem par nunca é casada no palpite.
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router';
import { Download, KeyRound, Pencil, Plus, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { Loading, Notice, PageHeading } from '@/components/app-shell';
import { useMotorAuth } from '@/components/auth-provider';
import { supabase, friendlyError, type Row } from '@/lib/supabase';
import { ADAPTADORES, baixarTexto, dataHoraCurta, diaISO, inteiro, paraCsv, reais } from '@/lib/voz';
import { NOME_FORMA, ORIGEM, PERM_IMPORT, motivoLabel, resumoMotivos, situacaoExecucao, type Execucao } from '@/lib/importador';
import { Aviso, Botao, Cartao, CartaoLinha, Kpi, Pilula, SubAbas, Tabela, Vazio } from './ui';
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

	return (
		<>
			<PageHeading title="Gravações do discador" description="Cargas › Gravações · para transcrever e analisar as ligações feitas pelo discador de vocês" />
			<SubAbas atual="gravacoes" itens={[{ id: 'carga', nome: 'Enviar carga', to: '/envios' }, { id: 'gravacoes', nome: 'Gravações do discador' }]} />
			{!empresa ? <Notice variant="warning">Escolha a empresa no topo para ver esta página.</Notice> : loading ? <Loading /> : error ? <Notice>{error}</Notice> : (
				<div className="space-y-4">
					<p className="text-[12.5px] text-[var(--base-texto-2)]">As ligações do agente virtual o MotorCX já grava. Aqui entram as gravações do discador de vocês: a parte da conversa depois da transferência para o operador (casada com a ligação do agente) e, se vocês quiserem, as ligações feitas direto pelo discador.</p>
					{vozCfg && !vozCfg.bucket_gravacoes && <Aviso tom="atencao" titulo="A empresa ainda não tem o bucket de gravações.">A importação fica com erro até a equipe MotorCX criar o bucket (retenção de {retencao} dias). <Link to="/suporte/novo" className="underline">Pedir pelo Suporte</Link>.</Aviso>}

					<div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
						<Kpi rotulo="Última leitura" valor={ultima ? dataHoraCurta(ultima.iniciada_em) : '—'} detalhe={!ultima ? 'Ainda não houve leitura.' : ultima.erro ? <span className="text-[var(--estado-erro-texto)]">Erro: {ultima.erro}</span> : ultima.terminada_em ? nomeFonte(ultima.config_id) : 'em andamento'} />
						<Kpi rotulo="Hoje" valor={deHoje.length ? `${inteiro(somaHoje.importadas)}` : '—'} detalhe={deHoje.length ? `gravações importadas de ${inteiro(somaHoje.lidas)} linhas` : 'Nenhuma leitura hoje.'} />
						<Kpi rotulo="Casadas com a transferência" valor={deHoje.length ? inteiro(somaHoje.casadas) : '—'} detalhe="parte da IA + parte do operador" />
						<Kpi rotulo="Recusadas hoje" valor={deHoje.length ? inteiro(somaHoje.quarentena) : '—'} alerta={somaHoje.quarentena > 0} detalhe="ver a quarentena abaixo" />
					</div>

					<Cartao semPadding titulo="Fontes das gravações" linha="Envio pelo site, SFTP do discador ou HTTPS. A credencial fica no cofre: a equipe MotorCX grava."
						direita={podeEditar && !editando ? <Botao onClick={() => setEditando('nova')}><Plus size={14} /> Nova fonte</Botao> : undefined}>
						{fontes.length === 0 ? (
							<div className="px-4 pb-5 sm:px-5">
								<Vazio titulo="Nenhuma fonte cadastrada ainda.">{podeEditar ? 'Cadastre o SFTP ou a URL do discador, ou envie as gravações direto aqui embaixo.' : 'Peça ao Admin da empresa para cadastrar a fonte, ou envie as gravações aqui embaixo.'}</Vazio>
							</div>
						) : (
							<ul className="divide-y" style={{ borderColor: 'var(--base-borda)' }}>
								{fontes.map(f => {
									const s = situacaoFonte(f);
									const adapt = ADAPTADORES.find(a => a.id === f.adaptador)?.nome ?? f.adaptador;
									return (
										<li key={f.id} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-5" style={{ borderColor: 'var(--base-separator, var(--base-borda))' }}>
											<div className="min-w-0">
												<p className="flex flex-wrap items-center gap-2"><b className="truncate text-[13.5px] font-semibold text-[var(--base-texto)]">{f.nome}</b><Pilula tom={s.tom}>{s.txt}</Pilula>{f.transcrever && <Pilula tom="info">Transcreve</Pilula>}</p>
												<p className="mt-0.5 break-words text-[12px] text-[var(--base-texto-2)]">
													{NOME_FORMA[f.forma] ?? f.forma} · {adapt}
													{f.forma === 'sftp' && f.host ? <> · <span className="break-all font-mono">{f.host}{f.pasta ? `:${f.pasta}` : ''}</span></> : null}
													{f.forma === 'url' && f.url_lista ? <> · <span className="break-all font-mono">{f.url_lista}</span></> : null}
												</p>
												<p className="mt-0.5 break-words text-[11.5px] text-[var(--base-texto-3)]">
													{f.forma === 'arquivo' ? 'Lida depois de cada envio' : f.leitura_automatica ? `Leitura automática a cada ${f.intervalo_horas} h` : 'Só quando pedirem "Ler agora"'}
													{f.ultima_leitura_em ? ` · última ${dataHoraCurta(f.ultima_leitura_em)}` : ''}
													{f.so_transferencias ? ' · só transferências' : ' · aceita avulsas'}
													{f.segredo_ref ? <> · cofre <span className="break-all font-mono">{f.segredo_ref}</span></> : null}
												</p>
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
						{!podeEditar && <p className="border-t px-4 py-2.5 text-[12px] text-[var(--base-texto-3)] sm:px-5" style={{ borderColor: 'var(--base-borda)' }}>Só o Admin da empresa cadastra e edita as fontes.</p>}
					</Cartao>

					{editando && <FonteForm key={editando === 'nova' ? 'nova' : editando.id} empresaId={empresa.id} fonte={editando === 'nova' ? null : editando} onFechar={() => setEditando(null)} onSalvo={() => { setEditando(null); recarregar(); }} />}

					{podeEnviar && <EnvioGravacoes empresaId={empresa.id} slug={empresa.slug} onEnviado={recarregar} />}
					{lotes.length > 0 && <Aviso tom="info" titulo={`${lotes.length} envio${lotes.length > 1 ? 's' : ''} aguardando a leitura.`}>O MotorCX lê em até 15 minutos ({lotes.map(l => `enviado ${dataHoraCurta(l.enviado_em)}, ${l.arquivos.length} arquivo${l.arquivos.length > 1 ? 's' : ''}`).join('; ')}).</Aviso>}

					<Cartao semPadding titulo="Registro da importação" linha="Cada leitura: arquivos, linhas, importadas, casadas com a transferência e recusadas. Toque numa linha para ver os arquivos.">
						<Tabela
							cabecalho={['Quando', 'Fonte', 'Origem', 'Arquivos', 'Linhas', 'Importadas', 'Casadas', 'Recusadas', 'Situação']}
							numericas={[3, 4, 5, 6, 7]}
							onLinha={i => setExecSel(execs[i].id === execSel ? null : execs[i].id)}
							selecionada={execs.findIndex(e => e.id === execSel)}
							vazio={<p className="px-4 pb-5 text-[13px] text-[var(--base-texto-2)] sm:px-5">Nenhuma leitura ainda.</p>}
							linhas={execs.map(e => {
								const s = situacaoExecucao(e);
								return [dataHoraCurta(e.iniciada_em), <span key="f" className="block max-w-[180px] truncate">{nomeFonte(e.config_id)}</span>, ORIGEM[e.origem] ?? e.origem, inteiro(e.arquivos), inteiro(e.lidas), inteiro(e.importadas), inteiro(e.casadas), inteiro(e.quarentena), <Pilula key="s" tom={s.tom} title={e.erro ?? undefined}>{s.txt}</Pilula>];
							})}
							cartoes={execs.map(e => {
								const s = situacaoExecucao(e);
								return (
									<CartaoLinha key={e.id} ativo={e.id === execSel} onClick={() => setExecSel(e.id === execSel ? null : e.id)}>
										<span className="flex items-center justify-between gap-2"><b className="min-w-0 truncate">{nomeFonte(e.config_id)}</b><Pilula tom={s.tom}>{s.txt}</Pilula></span>
										<small className="mt-1 block text-[var(--base-texto-2)]">{dataHoraCurta(e.iniciada_em)} · {ORIGEM[e.origem] ?? e.origem}</small>
										<small className="mt-0.5 block tnum text-[var(--base-texto-2)]">{inteiro(e.importadas)} importadas · {inteiro(e.casadas)} casadas · {inteiro(e.quarentena)} recusadas de {inteiro(e.lidas)} linhas</small>
										{e.erro && <small className="mt-0.5 block break-words text-[var(--estado-erro-texto)]">{e.erro}</small>}
									</CartaoLinha>
								);
							})}
						/>
						{execAtual && (
							<div className="border-t px-4 py-3 sm:px-5" style={{ borderColor: 'var(--base-borda)' }}>
								<p className="text-[13px] font-semibold text-[var(--base-texto)]">Arquivos da leitura de {dataHoraCurta(execAtual.iniciada_em)}</p>
								{execAtual.erro && <div className="mt-2"><Aviso tom="erro">{execAtual.erro}</Aviso></div>}
								{arqsSel.length === 0 ? <p className="mt-1 text-[12.5px] text-[var(--base-texto-2)]">{execAtual.terminada_em ? 'Nenhum arquivo novo nesta leitura.' : 'Lendo…'}</p> : (
									<ul className="mt-2 space-y-2">
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
							</div>
						)}
					</Cartao>

					<div className="grid gap-4 lg:grid-cols-2">
						<Cartao semPadding titulo="Quarentena" linha="Gravação sem par não é casada no palpite. O nome do arquivo nunca é guardado."
							direita={quar.length ? <Botao secundario onClick={baixarQuarentena}><Download size={14} /> Baixar a lista</Botao> : undefined}>
							<Tabela
								cabecalho={['Gravação no discador', 'Motivo', 'Quando']}
								vazio={<p className="px-4 pb-5 text-[13px] text-[var(--base-texto-2)] sm:px-5">Nenhuma gravação em quarentena.</p>}
								linhas={quar.slice(0, 50).map(q => [<span key="r" className="font-mono">{q.ref_gravacao}{q.linha ? <small className="ml-1 text-[var(--base-texto-3)]">linha {q.linha}</small> : null}</span>, <span key="m" className="block max-w-[320px] whitespace-normal">{motivoLabel(q.motivo)}{q.detalhe ? <small className="block text-[var(--base-texto-3)]">{q.detalhe}</small> : null}</span>, dataHoraCurta(q.criado_em)])}
								cartoes={quar.slice(0, 50).map(q => (
									<CartaoLinha key={q.id}><b className="break-all font-mono">{q.ref_gravacao}</b><small className="mt-1 block text-[var(--base-texto-2)]">{motivoLabel(q.motivo)}{q.linha ? ` · linha ${q.linha}` : ''} · {dataHoraCurta(q.criado_em)}</small>{q.detalhe && <small className="block text-[var(--base-texto-3)]">{q.detalhe}</small>}</CartaoLinha>
								))}
							/>
							{quar.length > 0 && <p className="border-t px-4 py-2.5 text-[12px] text-[var(--base-texto-3)] sm:px-5" style={{ borderColor: 'var(--base-borda)' }}>{Math.min(50, quar.length)} de {quar.length}{quar.length >= 200 ? '+' : ''}</p>}
						</Cartao>
						<Cartao titulo="Transcrever e analisar">
							<p className="flex flex-wrap items-center gap-2 text-[13px] text-[var(--base-texto)]"><Pilula tom={transcreve.length ? 'ok' : 'neutro'}>{transcreve.length ? 'Ligado' : 'Desligado'}</Pilula> <span className="min-w-0 break-words">{transcreve.length ? `Transcreve as gravações de ${transcreve.map(f => f.nome).join(', ')}` : 'Transcrever as gravações do discador'}</span></p>
							<dl className="mt-3 grid grid-cols-[minmax(0,140px)_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-[13px]">
								<dt className="text-[var(--base-texto-3)]">Transcreve a partir de</dt><dd className="text-[var(--base-texto)]">{minS} segundos (<Link to="/empresa/privacidade" className="underline">Empresa › Privacidade e gravações</Link>)</dd>
								<dt className="text-[var(--base-texto-3)]">Custo estimado</dt><dd className="text-[var(--base-texto)]">{precoTransc != null ? `${reais(precoTransc, 2)} por minuto transcrito` : 'preço da transcrição no contrato (Empresa › Faturas)'}</dd>
								<dt className="text-[var(--base-texto-3)]">Máscara</dt><dd className="text-[var(--base-texto)]">CPF e cartão saem da transcrição antes de gravar</dd>
								<dt className="text-[var(--base-texto-3)]">Análise</dt><dd className="text-[var(--base-texto)]">as casadas com a transferência entram no Speech Analytics, com o operador</dd>
								<dt className="text-[var(--base-texto-3)]">Retenção</dt><dd className="text-[var(--base-texto)]">{retencao} dias, a mesma da empresa (mínimo 90)</dd>
							</dl>
							<p className="mt-3 text-[12px] text-[var(--base-texto-3)]">Ligar ou desligar a transcrição do discador é pedido à equipe MotorCX, porque tem custo por minuto.</p>
							<div className="mt-3"><Aviso tom="neutro">O nome do arquivo não pode ter telefone ou CPF. Se tiver, a gravação vai para a quarentena e o nome é descartado.</Aviso></div>
						</Cartao>
					</div>
				</div>
			)}
		</>
	);
}
