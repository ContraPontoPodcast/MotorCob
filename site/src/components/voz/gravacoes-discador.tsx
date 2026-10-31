// Tela 8 · Cobrança › Cargas › Gravações do discador. Adaptadores por discador e quarentena.
// Lê voz_import_config, voz_import_execucoes, voz_import_quarentena e voz_config. A equipe MotorCX cadastra
// a conexão (salvar_importacao_voz é só da equipe; a credencial fica no cofre): aqui a empresa vê o status
// e pede a conexão pelo Suporte. Gravação sem par vai para a quarentena, nunca casada no palpite.
import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { Download } from 'lucide-react';
import { Loading, Notice, PageHeading } from '@/components/app-shell';
import { useMotorAuth } from '@/components/auth-provider';
import { supabase, friendlyError, type Row } from '@/lib/supabase';
import { ADAPTADORES, FORMA_IMPORT, MOTIVO_QUARENTENA, dataHoraCurta, diaISO, inteiro, reais } from '@/lib/voz';
import { Aviso, Botao, Cartao, CartaoLinha, Pilula, SubAbas, Tabela, Vazio } from './ui';

type Config = { id: number; adaptador: string; forma: string; segredo_ref: string | null; pasta: string | null; dominios_url: string[]; transcrever: boolean; ativo: boolean; cadastrado_em: string };
type Execucao = { id: number; config_id: number; iniciada_em: string; terminada_em: string | null; lidas: number; casadas: number; quarentena: number; erro: string | null };
type Quarentena = { id: number; execucao_id: number; ref_gravacao: string; motivo: string; criado_em: string };

const FORMA_DESC: Record<string, string> = {
	sftp: 'O MotorCX lê uma pasta (SFTP ou bucket) todo dia. Credencial no cofre.',
	url: 'O arquivo de carga traz a URL de cada gravação, só em domínios autorizados, só HTTPS.',
	api: 'O discador envia por POST, com token no cofre. Construído sob demanda.',
	arquivo: 'Zip com os áudios e um índice CSV (id_chamada, id_acao, inicio, duracao, arquivo), em Cargas.',
};

export function GravacoesDiscador() {
	const { empresa } = useMotorAuth();
	const [configs, setConfigs] = useState<Config[]>([]);
	const [execs, setExecs] = useState<Execucao[]>([]);
	const [quar, setQuar] = useState<Quarentena[]>([]);
	const [vozCfg, setVozCfg] = useState<Row | null>(null);
	const [precoTransc, setPrecoTransc] = useState<number | null>(null);
	const [sel, setSel] = useState<string | null>(null);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState('');

	useEffect(() => {
		if (!supabase || !empresa) return;
		const sb = supabase;
		let active = true;
		setLoading(true); setError('');
		(async () => {
			const [c, e, q, v, p] = await Promise.all([
				sb.from('voz_import_config').select('id,adaptador,forma,segredo_ref,pasta,dominios_url,transcrever,ativo,cadastrado_em').eq('empresa_id', empresa.id),
				sb.from('voz_import_execucoes').select('id,config_id,iniciada_em,terminada_em,lidas,casadas,quarentena,erro').eq('empresa_id', empresa.id).order('iniciada_em', { ascending: false }).limit(30),
				sb.from('voz_import_quarentena').select('id,execucao_id,ref_gravacao,motivo,criado_em').eq('empresa_id', empresa.id).order('criado_em', { ascending: false }).limit(200),
				sb.from('voz_config').select('transcrever,transcrever_min_segundos,retencao_dias').eq('empresa_id', empresa.id).maybeSingle(),
				sb.from('precos_empresa').select('preco,modelo').eq('empresa_id', empresa.id).eq('item', 'voz_transcricao').lte('vigente_desde', diaISO()).order('vigente_desde', { ascending: false }).limit(1),
			]);
			if (!active) return;
			if (c.error) { setError(friendlyError(c.error)); setLoading(false); return; }
			const cs = (c.data ?? []) as Config[];
			setConfigs(cs);
			setExecs((e.data ?? []) as Execucao[]);
			setQuar((q.data ?? []) as Quarentena[]);
			setVozCfg((v.data as Row | null) ?? null);
			const pr = (p.data as Row[] | null)?.[0];
			setPrecoTransc(pr && pr.modelo === 'flat' && pr.preco != null ? Number(pr.preco) : null);
			setSel(prev => prev ?? cs.find(x => x.ativo)?.adaptador ?? cs[0]?.adaptador ?? null);
			setLoading(false);
		})();
		return () => { active = false; };
	}, [empresa?.id]);

	const porAdaptador = new Map(configs.map(c => [c.adaptador, c]));
	const atual = sel ? porAdaptador.get(sel) ?? null : null;
	const nomeSel = ADAPTADORES.find(a => a.id === sel)?.nome ?? '';
	const execsAtual = atual ? execs.filter(e => e.config_id === atual.id) : [];
	const ultima = execsAtual[0] ?? null;
	const hoje = diaISO();
	const deHoje = execsAtual.filter(e => diaISO(0, new Date(e.iniciada_em)) === hoje);
	const somaHoje = deHoje.reduce((t, e) => ({ lidas: t.lidas + e.lidas, casadas: t.casadas + e.casadas, quarentena: t.quarentena + e.quarentena }), { lidas: 0, casadas: 0, quarentena: 0 });
	const minS = Number(vozCfg?.transcrever_min_segundos ?? 5);
	const retencao = Number(vozCfg?.retencao_dias ?? 90);

	function baixarQuarentena() {
		// Só a referência do discador e o motivo: o nome do arquivo nunca é guardado.
		const linhas = ['ref_gravacao;motivo;quando', ...quar.map(q => `${q.ref_gravacao};${MOTIVO_QUARENTENA[q.motivo] ?? q.motivo};${q.criado_em}`)];
		const blob = new Blob([`﻿${linhas.join('\n')}`], { type: 'text/csv;charset=utf-8' });
		const a = document.createElement('a');
		a.href = URL.createObjectURL(blob); a.download = `quarentena-gravacoes-${hoje}.csv`;
		document.body.appendChild(a); a.click(); a.remove();
		window.setTimeout(() => URL.revokeObjectURL(a.href), 30000);
	}

	const situacao = (id: string): { tom: 'ok' | 'atencao' | 'neutro'; txt: string } => {
		const c = porAdaptador.get(id);
		if (!c) return { tom: 'neutro', txt: id === 'generico' ? 'Disponível' : 'Não conectado' };
		return c.ativo ? { tom: 'ok', txt: 'Conectado' } : { tom: 'atencao', txt: 'Pausado' };
	};

	return (
		<>
			<PageHeading title="Gravações do discador" description="Cargas › Gravações · para transcrever e analisar as ligações feitas pelo discador de vocês" />
			<SubAbas atual="gravacoes" itens={[{ id: 'carga', nome: 'Enviar carga', to: '/envios' }, { id: 'gravacoes', nome: 'Gravações do discador' }]} />
			{!empresa ? <Notice variant="warning">Escolha a empresa no topo para ver esta página.</Notice> : loading ? <Loading /> : error ? <Notice>{error}</Notice> : (
				<div className="space-y-4">
					<section>
						<h2 className="text-[15px] font-semibold text-[var(--base-texto)]">Qual discador vocês usam</h2>
						<p className="mb-3 text-[12.5px] text-[var(--base-texto-2)]">As ligações do agente virtual o MotorCX já grava. Aqui entram as gravações do discador de vocês, da parte da conversa que acontece depois da transferência para o operador.</p>
						<div className="grid grid-cols-2 gap-2 sm:grid-cols-4" role="radiogroup" aria-label="Discador">
							{ADAPTADORES.map(a => {
								const s = situacao(a.id);
								const ativo = sel === a.id;
								return (
									<button key={a.id} type="button" role="radio" aria-checked={ativo} onClick={() => setSel(a.id)} className="flex min-w-0 flex-col gap-1 rounded-2xl border px-3.5 py-3 text-left"
										style={{ borderColor: ativo ? 'var(--destaque)' : 'var(--base-borda)', boxShadow: ativo ? '0 0 0 1px var(--destaque)' : undefined, backgroundColor: 'var(--base-cartao)' }}>
										<b className="truncate text-[13.5px] font-semibold text-[var(--base-texto)]">{a.nome}</b>
										<span className="flex items-center gap-1.5 text-[12px] text-[var(--base-texto-2)]">
											<span className="h-2 w-2 rounded-full" style={{ backgroundColor: s.tom === 'ok' ? 'var(--estado-pronto)' : s.tom === 'atencao' ? 'var(--estado-atencao)' : 'var(--base-texto-3)' }} />{s.txt}
										</span>
									</button>
								);
							})}
						</div>
					</section>

					{!sel ? (
						<Vazio titulo="Nenhum discador conectado ainda." acao={<Link to="/suporte/novo" className="inline-flex h-9 items-center rounded-lg px-4 text-[13px] font-semibold text-[var(--destaque-texto)]" style={{ backgroundColor: 'var(--destaque)' }}>Pedir conexão pelo Suporte</Link>}>
							Escolha acima o discador de vocês. A equipe MotorCX confirma com o fornecedor a forma de integração (API, SFTP ou exportação) e cadastra a credencial no cofre.
						</Vazio>
					) : atual ? (
						<div className="grid gap-3 sm:grid-cols-3">
							<Cartao titulo={`Adaptador ${nomeSel}`} direita={<Pilula tom={atual.ativo ? 'ok' : 'atencao'}>{atual.ativo ? 'Conectado' : 'Pausado'}</Pilula>}>
								<p className="text-[12.5px] text-[var(--base-texto-2)]">{FORMA_IMPORT[atual.forma] ?? atual.forma}. {FORMA_DESC[atual.forma]}</p>
								{atual.segredo_ref && <p className="mt-1.5 text-[12px] text-[var(--base-texto-3)]">Credencial no cofre: <span className="font-mono">{atual.segredo_ref}</span>. A equipe MotorCX cadastra.</p>}
								{atual.pasta && <p className="mt-1 text-[12px] text-[var(--base-texto-3)]">Pasta: <span className="font-mono">{atual.pasta}</span></p>}
								{atual.dominios_url?.length > 0 && <p className="mt-1 text-[12px] text-[var(--base-texto-3)]">Domínios autorizados: <span className="font-mono">{atual.dominios_url.join(', ')}</span></p>}
							</Cartao>
							<Cartao titulo="Última leitura">
								<p className="text-[20px] font-bold text-[var(--base-texto)]">{ultima ? dataHoraCurta(ultima.iniciada_em) : '—'}</p>
								<p className="text-[12.5px] text-[var(--base-texto-2)]">{!ultima ? 'Ainda não houve leitura.' : ultima.erro ? <span className="text-[var(--estado-erro-texto)]">Erro: {ultima.erro}</span> : ultima.terminada_em ? `terminou ${dataHoraCurta(ultima.terminada_em)}` : 'em andamento'}</p>
							</Cartao>
							<Cartao titulo="Hoje">
								<p className="text-[20px] font-bold tnum text-[var(--base-texto)]">{deHoje.length ? `${inteiro(somaHoje.lidas)} gravações` : '—'}</p>
								<p className="text-[12.5px] text-[var(--base-texto-2)]">{deHoje.length ? `${inteiro(somaHoje.casadas)} casadas com a ação · ${inteiro(somaHoje.quarentena)} em quarentena` : 'Nenhuma leitura hoje.'}</p>
							</Cartao>
						</div>
					) : (
						<Cartao titulo={sel === 'generico' ? 'Conector genérico' : `Adaptador ${nomeSel}`} linha={sel === 'generico' ? 'Para discadores fora da lista.' : 'Não conectado.'}>
							{sel === 'generico' ? (
								<dl className="grid gap-2 text-[13px] sm:grid-cols-2">
									{Object.entries(FORMA_IMPORT).map(([k, n]) => (
										<div key={k} className="rounded-xl bg-[var(--base-fill)] px-3 py-2"><dt className="font-semibold text-[var(--base-texto)]">{n}</dt><dd className="text-[12.5px] text-[var(--base-texto-2)]">{FORMA_DESC[k]}</dd></div>
									))}
								</dl>
							) : <p className="text-[13px] text-[var(--base-texto-2)]">Peça a conexão pelo Suporte. A forma de integração (API, SFTP ou exportação) é confirmada com o fornecedor, e a credencial fica no cofre.</p>}
							<div className="mt-3"><Link to="/suporte/novo" className="inline-flex h-9 items-center rounded-lg px-4 text-[13px] font-semibold text-[var(--destaque-texto)]" style={{ backgroundColor: 'var(--destaque)' }}>Pedir conexão com {sel === 'generico' ? 'o conector genérico' : nomeSel}</Link></div>
						</Cartao>
					)}

					<div className="grid gap-4 lg:grid-cols-2">
						<Cartao semPadding titulo="Quarentena" linha="Gravação sem par não é casada no palpite. O nome do arquivo nunca é guardado."
							direita={quar.length ? <Botao secundario onClick={baixarQuarentena}><Download size={14} /> Baixar a lista</Botao> : undefined}>
							<Tabela
								cabecalho={['Gravação no discador', 'Motivo', 'Quando']}
								vazio={<p className="px-4 pb-5 text-[13px] text-[var(--base-texto-2)] sm:px-5">Nenhuma gravação em quarentena.</p>}
								linhas={quar.slice(0, 50).map(q => [<span key="r" className="font-mono">{q.ref_gravacao}</span>, <span key="m" className="whitespace-normal">{MOTIVO_QUARENTENA[q.motivo] ?? q.motivo}</span>, dataHoraCurta(q.criado_em)])}
								cartoes={quar.slice(0, 50).map(q => (
									<CartaoLinha key={q.id}><b className="font-mono">{q.ref_gravacao}</b><small className="mt-1 block text-[var(--base-texto-2)]">{MOTIVO_QUARENTENA[q.motivo] ?? q.motivo} · {dataHoraCurta(q.criado_em)}</small></CartaoLinha>
								))}
							/>
							{quar.length > 0 && <p className="border-t px-4 py-2.5 text-[12px] text-[var(--base-texto-3)] sm:px-5" style={{ borderColor: 'var(--base-borda)' }}>{Math.min(50, quar.length)} de {quar.length}{quar.length >= 200 ? '+' : ''}</p>}
						</Cartao>
						<Cartao titulo="Transcrever e analisar">
							<p className="flex items-center gap-2 text-[13px] text-[var(--base-texto)]"><Pilula tom={atual?.transcrever ? 'ok' : 'neutro'}>{atual?.transcrever ? 'Ligado' : 'Desligado'}</Pilula> Transcrever as gravações do discador</p>
							<dl className="mt-3 grid grid-cols-[minmax(0,140px)_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-[13px]">
								<dt className="text-[var(--base-texto-3)]">Transcreve a partir de</dt><dd className="text-[var(--base-texto)]">{minS} segundos (Empresa › Privacidade e gravações)</dd>
								<dt className="text-[var(--base-texto-3)]">Custo estimado</dt><dd className="text-[var(--base-texto)]">{precoTransc != null ? `${reais(precoTransc, 2)} por minuto transcrito` : 'preço da transcrição no contrato (Empresa › Faturas)'}</dd>
								<dt className="text-[var(--base-texto-3)]">Separação de vozes</dt><dd className="text-[var(--base-texto)]">canais separados quando o discador entrega assim</dd>
								<dt className="text-[var(--base-texto-3)]">Retenção</dt><dd className="text-[var(--base-texto)]">{retencao} dias, a mesma da empresa</dd>
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
