// Contratação › Agente de voz: modelo de cobrança (protótipo aprovado, tela 1; SPEC "Agente de voz por minuto falado").
// "Por minuto falado" (padrão) ou "Licença de robôs" (a tela de Robôs que já existe). Por minuto: preço do minuto
// (R$ 1,25 pré-preenchido e editável) com a caixa de margem do banco (margem_preco_ia: menor preço aceito e a mesma
// mensagem; a margem do preço só o Master vê), cadência grátis/inicial/incremento com o exemplo ao vivo e a régua,
// limite de conversas simultâneas contra o teto contratado, franquia opcional, vigência (próximo ciclo ou agora) e
// motivo. Grava por salvar_cobranca_ia_voz (SQL 123): editar_contratacao; preço novo também editar_precos. Troca de
// modelo só no próximo ciclo. Histórico em historico_cobranca_ia_voz.
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { Minus, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { supabase, moneyBR, dateTimeBR, type Row } from '@/lib/supabase';
import { useConsolePerms } from '@/components/workspace/console/console-perms';
import { Aviso, Campo, Cartao, Pilula, btnPrim, btnSec, campoCls } from '@/components/comuns/voz-ui';
import { Kpis } from '@/components/ds';
import { lerNumero, reais } from '@/lib/voz';
import { CADENCIA_PADRAO, PRECO_MINUTO_PADRAO, REGUA_CADENCIA, cadenciaIa, exemploCadencia, segundosTarifadosIa } from '@/lib/minuto-ia';
import { Opcao } from './robos-contratados';

const ROTA = '/empresa/contratacao';
const int = (v: unknown) => Math.round(Number(v ?? 0)).toLocaleString('pt-BR');
const MODELO: Record<string, string> = { por_minuto: 'Por minuto falado', licenca: 'Licença de robôs' };

type Dados = {
	vigente: Row | null;           // voz_cobranca_ia_cliente que vale agora
	agendadas: Row[];
	hist: Row[];
	licencaRobos: number;          // robôs da licença que vale hoje
	preco: number | null;          // preço do minuto de IA da empresa no mês
	tabela: number | null;         // preço de tabela do voz_minuto_ia
	cadenciaPadrao: string;
	teto: number | null;
	vendidas: number;              // conversas vendidas pelas outras empresas (robôs + limites), pelo que a equipe enxerga
};

function vigenteDe(linhas: Row[], agora = new Date().toISOString()): Row | null {
	return linhas.filter(l => String(l.vigente_desde) <= agora).sort((a, b) => String(b.vigente_desde).localeCompare(String(a.vigente_desde)) || Number(b.id) - Number(a.id))[0] ?? null;
}

function useDados(empresaId: string, versao = 0) {
	const [dados, setDados] = useState<Dados | null>(null);
	const [erro, setErro] = useState('');
	useEffect(() => {
		if (!supabase) return;
		let ativo = true;
		const sb = supabase;
		const eid = Number(empresaId);
		(async () => {
			const [cob, h, lic, it, pe, ct] = await Promise.all([
				sb.from('voz_cobranca_ia_cliente').select('id,empresa_id,modelo,gratis_s,inicial_s,incremento_s,cadencia,limite_conversas,franquia_min,vigente_desde'),
				sb.rpc('historico_cobranca_ia_voz', { empresa: eid }),
				sb.from('voz_licencas_cliente').select('empresa_id,robos,vigente_desde').order('vigente_desde', { ascending: false }),
				sb.from('cobranca_itens').select('codigo,preco_tabela').eq('codigo', 'voz_minuto_ia').maybeSingle(),
				sb.from('precos_empresa').select('modelo,preco,vigente_desde').eq('empresa_id', eid).eq('item', 'voz_minuto_ia').order('vigente_desde', { ascending: false }),
				sb.from('voz_contrato').select('concorrencia_contratada,cadencia_ia_padrao').maybeSingle(),
			]);
			if (!ativo) return;
			if (cob.error) { setErro('Não foi possível ler o contrato do Agente de voz desta empresa.'); return; }
			const todas = (cob.data ?? []) as Row[];
			const agora = new Date().toISOString();
			const daEmpresa = todas.filter(l => Number(l.empresa_id) === eid);
			const hoje = agora.slice(0, 10);
			const licencas = (lic.data ?? []) as Row[];
			const licDe = (e: number) => Number(licencas.find(l => Number(l.empresa_id) === e && String(l.vigente_desde) <= hoje)?.robos ?? 0);
			const empresas = new Set([...todas.map(l => Number(l.empresa_id)), ...licencas.map(l => Number(l.empresa_id))]);
			let vendidas = 0;
			for (const e of empresas) {
				if (e === eid) continue;
				const v = vigenteDe(todas.filter(l => Number(l.empresa_id) === e), agora);
				vendidas += v?.modelo === 'por_minuto' ? Number(v.limite_conversas ?? 0) : licDe(e);
			}
			const mes = `${hoje.slice(0, 7)}-01`;
			const p = ((pe.data ?? []) as Row[]).find(x => String(x.vigente_desde) <= mes);
			setDados({
				vigente: vigenteDe(daEmpresa, agora),
				agendadas: daEmpresa.filter(l => String(l.vigente_desde) > agora).sort((a, b) => String(a.vigente_desde).localeCompare(String(b.vigente_desde))),
				hist: h.error ? [] : (h.data ?? []) as Row[],
				licencaRobos: licDe(eid),
				preco: p && String(p.modelo) === 'flat' ? Number(p.preco) : null,
				tabela: it.data ? Number((it.data as Row).preco_tabela ?? PRECO_MINUTO_PADRAO) : PRECO_MINUTO_PADRAO,
				cadenciaPadrao: String((ct.data as Row | null)?.cadencia_ia_padrao ?? CADENCIA_PADRAO),
				teto: ct.data ? Number((ct.data as Row).concorrencia_contratada ?? 0) : null,
				vendidas,
			});
		})().catch(() => { if (ativo) setErro('Não foi possível ler o contrato do Agente de voz desta empresa.'); });
		return () => { ativo = false; };
	}, [empresaId, versao]);
	return { dados, erro };
}

/** Modelo que vale agora: o do contrato; sem contrato, licença com robôs = licença, senão por minuto (legado). */
function modeloAtual(d: Dados): string {
	return String(d.vigente?.modelo ?? (d.licencaRobos > 0 ? 'licenca' : 'por_minuto'));
}

// ================================================================ resumo (seção da Contratação)
export function CobrancaIaVozSecao({ empresaId, moduloLigado }: { empresaId: string; moduloLigado: boolean }) {
	const { can } = useConsolePerms();
	const { dados, erro } = useDados(empresaId);
	const titulo = 'Agente de voz · modelo de cobrança';
	if (erro) return <Cartao titulo={titulo}><Aviso tom="erro">{erro}</Aviso></Cartao>;
	if (!dados) return <Cartao titulo={titulo}><p className="text-[13px] text-[var(--base-texto-3)]">Carregando...</p></Cartao>;
	if (!moduloLigado && !dados.vigente && dados.hist.length === 0) return null;
	const mod = modeloAtual(dados);
	const v = dados.vigente;
	const acoes = can('editar_contratacao') ? <Link to={`${ROTA}/voz`} className={btnPrim}>Editar modelo e preço</Link> : undefined;
	return (
		<Cartao titulo={titulo} desc="Por minuto falado com a IA (cadência como telefonia) ou licença de robôs. A cobrança para quando a transferência para o humano começa." acoes={acoes}>
			<div className="space-y-3">
				<Kpis itens={[
					{ rotulo: 'Modelo', valor: MODELO[mod], detalhe: v ? `desde ${dateTimeBR(v.vigente_desde)}` : 'sem contrato (regra antiga)' },
					mod === 'por_minuto' ? { rotulo: 'Preço do minuto', valor: reais(dados.preco ?? dados.tabela, 2), detalhe: dados.preco == null ? 'de tabela' : 'desta empresa' } : null,
					mod === 'por_minuto' && v ? { rotulo: 'Cadência', valor: String(v.cadencia), detalhe: 'grátis/inicial/incremento' } : null,
					mod === 'por_minuto' && v ? { rotulo: 'Conversas ao mesmo tempo', valor: int(v.limite_conversas), detalhe: v.franquia_min ? `franquia de ${int(v.franquia_min)} min` : 'sem franquia' } : null,
				]} />
				{dados.agendadas.map(a => <Aviso key={String(a.id)} tom="info" titulo={`Agendado para ${dateTimeBR(a.vigente_desde)}:`}>{MODELO[String(a.modelo)]}{a.modelo === 'por_minuto' ? ` · cadência ${a.cadencia} · ${int(a.limite_conversas)} conversas${a.franquia_min ? ` · franquia de ${int(a.franquia_min)} min` : ''}` : ''}.</Aviso>)}
			</div>
		</Cartao>
	);
}

// ================================================================ edição
export function CobrancaIaVozEditar({ empresaId }: { empresaId: string }) {
	const navigate = useNavigate();
	const { can, isMaster } = useConsolePerms();
	const { dados, erro } = useDados(empresaId);
	const podePreco = can('editar_precos');
	const [modelo, setModelo] = useState<'por_minuto' | 'licenca' | null>(null);
	const [txt, setTxt] = useState<Record<string, string> | null>(null);
	const [quando, setQuando] = useState<'proximo' | 'agora'>('proximo');
	const [motivo, setMotivo] = useState('');
	const [motivoAbaixo, setMotivoAbaixo] = useState('');
	const [margem, setMargem] = useState<Row | null>(null);
	const [confirmaOver, setConfirmaOver] = useState(false);
	const [overServidor, setOverServidor] = useState('');
	const [erroSalvar, setErroSalvar] = useState('');
	const [salvando, setSalvando] = useState(false);

	// pré-preenchido: o contrato que vale; sem contrato, a cadência padrão e o preço da empresa ou o de tabela (R$ 1,25)
	useEffect(() => {
		if (!dados || txt) return;
		const v = dados.vigente;
		const [g, i, n] = v ? [Number(v.gratis_s), Number(v.inicial_s), Number(v.incremento_s)] : cadenciaIa(dados.cadenciaPadrao);
		const p = dados.preco ?? dados.tabela ?? PRECO_MINUTO_PADRAO;
		setModelo(modeloAtual(dados) as 'por_minuto' | 'licenca');
		setTxt({ preco: p.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 5 }), gratis: String(g), inicial: String(i), incremento: String(n),
			limite: v?.limite_conversas != null ? String(v.limite_conversas) : String(Math.max(1, dados.licencaRobos || 1)), franquia: v?.franquia_min != null ? String(v.franquia_min) : '' });
	}, [dados, txt]);

	const preco = lerNumero(txt?.preco ?? '');
	const g = Number(txt?.gratis ?? 0), i = Number(txt?.inicial ?? 30), n = Number(txt?.incremento ?? 6);
	const limite = Number(txt?.limite ?? 0);
	const franquia = txt?.franquia?.trim() ? Number(txt.franquia) : 0;
	const cadInvalida = !Number.isInteger(g) || !Number.isInteger(i) || !Number.isInteger(n) || g < 0 || g > 60 || i < 1 || i > 600 || n < 1 || n > 600 || g >= i;

	// caixa de margem: o banco diz o menor preço aceito e a mensagem (a margem do preço, só o Master)
	useEffect(() => {
		if (!supabase || modelo !== 'por_minuto' || !Number.isFinite(preco)) return;
		let ativo = true;
		const t = setTimeout(() => {
			void supabase!.rpc('margem_preco_ia', { item: 'voz_minuto_ia', preco }).then(({ data }) => {
				if (ativo) setMargem(((Array.isArray(data) ? data[0] : data) ?? null) as Row | null);
			});
		}, 250);
		return () => { ativo = false; clearTimeout(t); };
	}, [preco, modelo]);

	const atualMod = dados ? modeloAtual(dados) : null;
	const trocaModelo = !!modelo && !!atualMod && modelo !== atualMod;
	useEffect(() => { if (trocaModelo) setQuando('proximo'); }, [trocaModelo]);
	const precoMudou = !!dados && Number.isFinite(preco) && Math.abs(preco - (dados.preco ?? -1)) > 0.000001;
	const problema = modelo === 'por_minuto' ? (margem?.problema as string | null) ?? null : null;
	const vendidoNovo = (dados?.vendidas ?? 0) + (modelo === 'por_minuto' ? limite : dados?.licencaRobos ?? 0);
	const over = modelo === 'por_minuto' && dados?.teto != null && vendidoNovo > dados.teto && limite > Number(dados.vigente?.limite_conversas ?? 0);
	const precisaConfirmar = over || !!overServidor;
	const motivoOk = motivo.trim().length >= 5;
	const podeSalvar = !!modelo && motivoOk && !salvando && (modelo === 'licenca'
		|| (Number.isFinite(preco) && preco > 0 && !problema && !cadInvalida && limite >= 1 && limite <= 5000 && (!precoMudou || podePreco)
			&& (!precisaConfirmar || confirmaOver)));
	const regua = useMemo(() => REGUA_CADENCIA.map(s => ({ s, t: cadInvalida ? null : segundosTarifadosIa(s, g, i, n) })), [g, i, n, cadInvalida]);

	if (erro) return <Aviso tom="erro">{erro}</Aviso>;
	if (!dados || !txt || !modelo) return <p className="text-[13px] text-[var(--base-texto-3)]">Carregando...</p>;
	const set = (k: string, v: string) => setTxt(t => ({ ...(t ?? {}), [k]: v }));
	const passoLimite = (d: number) => set('limite', String(Math.max(1, Math.min(5000, (Number.isFinite(limite) ? limite : 0) + d))));

	async function salvar() {
		if (!supabase) return;
		setSalvando(true); setErroSalvar('');
		const { error } = await supabase.rpc('salvar_cobranca_ia_voz', {
			empresa: Number(empresaId), modelo, motivo: motivo.trim(), quando,
			preco: modelo === 'por_minuto' ? preco : null,
			gratis_s: modelo === 'por_minuto' ? g : null, inicial_s: modelo === 'por_minuto' ? i : null, incremento_s: modelo === 'por_minuto' ? n : null,
			limite_conversas: modelo === 'por_minuto' ? limite : null, franquia_min: modelo === 'por_minuto' ? franquia : null,
			overbooking_confirmado: confirmaOver, motivo_abaixo: motivoAbaixo.trim() || null,
		});
		setSalvando(false);
		if (error) {
			const m = String(error.message ?? '');
			if (/^overbooking/i.test(m)) { setOverServidor(m); setConfirmaOver(false); return; }
			setErroSalvar(m || 'Não foi possível salvar o contrato do Agente de voz.');
			return;
		}
		toast.success(`Agente de voz: ${MODELO[modelo!].toLowerCase()} salvo, ${quando === 'agora' ? 'valendo agora' : 'a partir do próximo ciclo'}. Ficou no histórico e na Auditoria.`);
		navigate(ROTA, { replace: true });
	}

	return (
		<div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
			<div className="min-w-0 space-y-5">
				<Cartao titulo="Modelo" desc={`Hoje: ${MODELO[atualMod!]}${dados.vigente ? '' : ' (sem contrato: regra antiga)'}. A troca de modelo vale só no próximo ciclo.`}>
					<div className="flex flex-wrap gap-2">
						<Opcao name="modelo" checked={modelo === 'por_minuto'} onChange={() => setModelo('por_minuto')} titulo="Por minuto falado">Paga o minuto que falou com a IA, com cadência como telefonia. O limite de conversas é só capacidade, sem preço.</Opcao>
						<Opcao name="modelo" checked={modelo === 'licenca'} onChange={() => setModelo('licenca')} titulo="Licença de robôs">Preço fechado por robô (1 robô = 1 conversa ao mesmo tempo), com franquia de minutos.</Opcao>
					</div>
					{modelo === 'licenca' && <div className="mt-4 space-y-3">
						<Aviso tom="info">A licença vale a partir do próximo ciclo{trocaModelo ? '' : ' (a empresa já está na licença)'}. Robôs, preço, fidelidade e franquia ficam na tela de Robôs contratados.</Aviso>
						<Link to={`${ROTA}/robos`} className={btnSec}>Abrir Robôs contratados</Link>
					</div>}
				</Cartao>

				{modelo === 'por_minuto' && <>
					<Cartao titulo="Preço do minuto" desc={podePreco ? 'Pré-preenchido com o que vale (ou o de tabela). Editável.' : 'Sem a permissão editar_precos: o preço fica o que vale.'}>
						<div className="grid gap-4 sm:grid-cols-2">
							<Campo rotulo="Preço por minuto tarifado (R$)" htmlFor="ia-preco" erro={problema ?? undefined}><input id="ia-preco" inputMode="decimal" disabled={!podePreco} value={txt.preco} onChange={e => set('preco', e.target.value)} aria-invalid={!!problema} className={campoCls} /></Campo>
							<div className="rounded-xl bg-[var(--base-fill)] p-3 text-[13px]">
								<dl className="grid grid-cols-[1fr_auto] gap-y-1">
									{isMaster && <><dt className="text-[var(--base-texto-2)]">Margem deste preço</dt><dd className="font-semibold tnum">{margem?.mc_pct != null ? `${Number(margem.mc_pct).toLocaleString('pt-BR')}%` : '—'}</dd></>}
									<dt className="text-[var(--base-texto-2)]">Mínimo exigido</dt><dd className="font-semibold tnum">{margem?.mc_minima_pct != null ? `${Number(margem.mc_minima_pct).toLocaleString('pt-BR')}% de margem` : '—'}</dd>
									<dt className="text-[var(--base-texto-2)]">Menor preço aceito</dt><dd className="font-semibold tnum">{margem?.preco_minimo != null ? reais(margem.preco_minimo, 2) : '—'}</dd>
								</dl>
							</div>
						</div>
						{!problema && precoMudou && <Campo rotulo="Motivo do preço abaixo do mínimo do catálogo (se for o caso)" htmlFor="ia-abaixo" ajuda="Só é pedido quando o preço fica abaixo do mínimo do catálogo; o guarda da IA nunca deixa passar abaixo do menor preço aceito."><input id="ia-abaixo" value={motivoAbaixo} onChange={e => setMotivoAbaixo(e.target.value)} className={campoCls} /></Campo>}
					</Cartao>

					<Cartao titulo="Cadência" desc="Grátis / inicial / incremento, em segundos. Aplicada uma vez por ligação, sobre a soma dos trechos com a IA.">
						<div className="grid grid-cols-3 gap-3">
							<Campo rotulo="Grátis (s)" htmlFor="ia-g"><input id="ia-g" inputMode="numeric" value={txt.gratis} onChange={e => set('gratis', e.target.value)} className={campoCls} /></Campo>
							<Campo rotulo="Inicial (s)" htmlFor="ia-i"><input id="ia-i" inputMode="numeric" value={txt.inicial} onChange={e => set('inicial', e.target.value)} className={campoCls} /></Campo>
							<Campo rotulo="Incremento (s)" htmlFor="ia-n"><input id="ia-n" inputMode="numeric" value={txt.incremento} onChange={e => set('incremento', e.target.value)} className={campoCls} /></Campo>
						</div>
						{cadInvalida ? <div className="mt-3"><Aviso tom="erro">Grátis de 0 a 60 s e menor que o inicial; inicial e incremento de 1 a 600 s.</Aviso></div> : <>
							<p className="mt-3 text-[13.5px] text-[var(--base-texto)]">Exemplo: {exemploCadencia(47, g, i, n)}.</p>
							<ul className="mt-2 flex flex-wrap gap-2" aria-label="Régua da cadência">
								{regua.map(r => <li key={r.s}><Pilula tom={r.t === 0 ? 'neutro' : 'info'}>{r.s} s → {r.t} s</Pilula></li>)}
							</ul>
						</>}
					</Cartao>

					<Cartao titulo="Limite de conversas simultâneas" desc="Teto de capacidade do contrato, sem preço. Entra na divisão do teto global como os robôs.">
						<div className="flex flex-wrap items-center gap-3">
							<div className="inline-flex items-center overflow-hidden rounded-lg border border-[var(--base-field-border)]">
								<button type="button" aria-label="Menos uma conversa" onClick={() => passoLimite(-1)} className="grid h-10 w-10 place-items-center hover:bg-[var(--base-fill)]"><Minus size={16} /></button>
								<input aria-label="Conversas ao mesmo tempo" inputMode="numeric" value={txt.limite} onChange={e => set('limite', e.target.value)} className="h-10 w-20 border-x border-[var(--base-field-border)] bg-[var(--base-cartao)] text-center text-[16px] font-semibold outline-none tnum" />
								<button type="button" aria-label="Mais uma conversa" onClick={() => passoLimite(1)} className="grid h-10 w-10 place-items-center hover:bg-[var(--base-fill)]"><Plus size={16} /></button>
							</div>
							{dados.teto != null && <span className="text-[13px] text-[var(--base-texto-2)]">Total vendido: <b className="tnum">{int(vendidoNovo)}</b> de {int(dados.teto)} contratadas com o provedor</span>}
						</div>
						{precisaConfirmar && <div className="mt-3 space-y-2">
							<Aviso tom="erro">{overServidor || `Overbooking: ${int(vendidoNovo)} conversas vendidas para ${int(dados.teto)} contratadas com o provedor de voz.`} Nos horários em que todos usam juntos, o limite de cada empresa cai proporcionalmente.</Aviso>
							<label className="flex items-center gap-2 text-[13px]"><input type="checkbox" checked={confirmaOver} onChange={e => setConfirmaOver(e.target.checked)} /> Confirmo o overbooking (a equipe recebe o aviso)</label>
						</div>}
					</Cartao>

					<Cartao titulo="Franquia (opcional)" desc="Compromisso mínimo de minutos tarifados no mês, ao mesmo preço; o que passar sai como excedente. Vazio ou 0 = sem franquia.">
						<Campo rotulo="Franquia (min/mês)" htmlFor="ia-fr" ajuda={franquia > 0 && Number.isFinite(preco) ? `Mínimo do mês: ${moneyBR(franquia * preco)}` : undefined}><input id="ia-fr" inputMode="numeric" value={txt.franquia} onChange={e => set('franquia', e.target.value)} className={campoCls} placeholder="sem franquia" /></Campo>
					</Cartao>
				</>}

				<Cartao titulo="Vigência e motivo">
					<div className="flex flex-wrap gap-2">
						<Opcao name="quando" checked={quando === 'proximo'} onChange={() => setQuando('proximo')} titulo="No próximo ciclo">Este ciclo continua como está.</Opcao>
						<Opcao name="quando" checked={quando === 'agora'} disabled={trocaModelo} onChange={() => setQuando('agora')} titulo="Neste ciclo, a partir de agora">{trocaModelo ? 'Troca de modelo só no próximo ciclo.' : 'Vale para as ligações a partir de agora; as anteriores ficam com o que valia.'}</Opcao>
					</div>
					<div className="mt-4"><Campo rotulo="Motivo (obrigatório; o cliente não vê)" htmlFor="ia-motivo" erro={motivo && !motivoOk ? 'Escreva o motivo (5 a 300 letras).' : undefined}><input id="ia-motivo" value={motivo} maxLength={300} onChange={e => setMotivo(e.target.value)} className={campoCls} placeholder="Ex.: contrato assinado em 10/11" /></Campo></div>
					{erroSalvar && <div className="mt-3"><Aviso tom="erro">{erroSalvar}</Aviso></div>}
					<div className="mt-4 flex flex-wrap gap-2">
						<button type="button" className={btnPrim} disabled={!podeSalvar} onClick={() => void salvar()}>{salvando ? 'Salvando...' : 'Salvar'}</button>
						<Link to={ROTA} className={btnSec}>Cancelar</Link>
					</div>
				</Cartao>
			</div>

			<div className="min-w-0 space-y-5">
				<Cartao titulo="Histórico">
					{dados.hist.length === 0 ? <p className="text-[13px] text-[var(--base-texto-3)]">Nenhuma mudança gravada ainda.</p> : (
						<ol className="space-y-3 text-[13px]">
							{dados.hist.map(h => (
								<li key={String(h.id)} className="border-b border-[var(--base-borda)] pb-2.5 last:border-0">
									<div className="flex flex-wrap items-center gap-2"><Pilula tom={h.situacao === 'vigente' ? 'ok' : h.situacao === 'agendada' ? 'info' : 'neutro'}>{String(h.situacao)}</Pilula><span className="text-[var(--base-texto-2)]">{dateTimeBR(h.vigente_desde)}</span></div>
									<p className="mt-1 text-[var(--base-texto)]">{MODELO[String(h.modelo)]}{h.modelo === 'por_minuto' ? ` · ${h.cadencia} · ${int(h.limite_conversas)} conversas${h.preco_minuto != null ? ` · ${reais(h.preco_minuto, 2)}/min` : ''}${h.franquia_min ? ` · franquia ${int(h.franquia_min)} min` : ''}` : ''}</p>
									<p className="text-[12px] text-[var(--base-texto-3)]">{String(h.motivo)} · {String(h.quem)}</p>
								</li>
							))}
						</ol>
					)}
				</Cartao>
			</div>
		</div>
	);
}
