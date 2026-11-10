// Página do operador pelo link pessoal de treino: /treino/:token ("Meus treinamentos") e /treino/:token/:atr (briefing).
// Sem login e sem o menu do MotorCX: o token vai para treino_meus (SQL 90), que confere o hash, a validade, a
// revogação, o operador ativo e o módulo, devolve só os treinos daquele operador e registra o acesso (sem IP). Quando o
// link não abre, treino_estado_link (SQL 99) diz por quê (venceu, foi trocado, treinos indisponíveis).
// Tom formativo (SPEC §2.4): "Isto é treino" aparece ANTES de começar; nada de "reprovado".
import { useEffect, useState, type ReactNode } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { ArrowLeft } from 'lucide-react';
import { Aviso, Botao, Cartao, Estado, Pilula } from '@/components/ds';
import { supabase } from '@/lib/supabase';
import { dataBR, diaSP } from '@/lib/speech';
import { FAIXAS_SALDO, GRAVIDADE_RP, rotaBriefing, rotaTreino, rotuloTipoCliente, textoAlcada, textoDuracao, tokenValido } from '@/lib/roleplay';
import {
	TELA_LINK, gruposMeus, pilulaTreino, podeComecar, textoIstoETreino,
	type EstadoLink, type MeusTreinos, type TreinoOperador,
} from '@/lib/treino-operador';

type Carga = { d: MeusTreinos } | { estado: Exclude<EstadoLink, 'ativo'>; ate?: string | null } | { erro: string } | null;

/** treino_meus pelo token; se não abrir, o estado do link (venceu, foi trocado...). */
export function useMeusTreinos(token: string, versao = 0): Carga {
	const [c, setC] = useState<Carga>(null);
	useEffect(() => {
		let ativo = true;
		setC(null);
		if (!tokenValido(token)) { setC({ estado: 'invalido' }); return; }
		if (!supabase) { setC({ erro: 'Configuração ausente.' }); return; }
		const sb = supabase;
		void sb.rpc('treino_meus', { token }).then(async ({ data, error }) => {
			if (!ativo) return;
			if (!error && data) { setC({ d: data as MeusTreinos }); return; }
			const r = await sb.rpc('treino_estado_link', { token });
			if (!ativo) return;
			const e = (r.data ?? {}) as { estado?: EstadoLink; ate?: string };
			if (e.estado && e.estado !== 'ativo') setC({ estado: e.estado, ate: e.ate ?? null });
			else setC({ erro: 'Não deu para abrir os seus treinos agora. Tente de novo em alguns minutos.' });
		});
		return () => { ativo = false; };
	}, [token, versao]);
	return c;
}

/** Moldura da página do operador: só o nome do produto e o aviso de privacidade, sem menu. */
export function MolduraTreino({ titulo, children, voltar }: { titulo: string; children: ReactNode; voltar?: ReactNode }) {
	useEffect(() => { document.title = `${titulo} · Treino · MotorCX`; }, [titulo]);
	return (
		<div className="min-h-screen bg-[var(--base-fundo,var(--base-fill))] text-[var(--base-texto)]">
			<header className="border-b bg-[var(--base-cartao)]" style={{ borderColor: 'var(--base-borda)' }}>
				<div className="mx-auto flex max-w-[880px] items-center justify-between gap-2 px-4 py-3">
					<span className="text-[14px] font-bold">MotorCX · Treino</span>
					<span className="text-[12px] text-[var(--base-texto-3)]">Link pessoal: só os seus treinos</span>
				</div>
			</header>
			<main className="mx-auto max-w-[880px] space-y-4 px-4 py-5 sm:py-8">
				{voltar}
				<h1 tabIndex={-1} className="text-[22px] font-semibold leading-tight">{titulo}</h1>
				{children}
				<p className="pt-4 text-[12px] text-[var(--base-texto-3)]">Treino com cliente simulado: tudo é ficção. O áudio não é guardado e a conversa do treino fica 90 dias, separada das ligações reais.</p>
			</main>
		</div>
	);
}

export function TelaLinkFechado({ estado, ate }: { estado: Exclude<EstadoLink, 'ativo'>; ate?: string | null }) {
	const t = TELA_LINK[estado];
	return <MolduraTreino titulo={t.titulo}><Cartao><p className="text-[14px] leading-relaxed text-[var(--base-texto-2)]">{t.texto(ate)}</p></Cartao></MolduraTreino>;
}

function Carregando({ titulo }: { titulo: string }) {
	return <MolduraTreino titulo={titulo}><Estado tipo="carregando" /></MolduraTreino>;
}

/** Voltar da página do operador: pelo histórico quando veio de "Meus treinamentos", senão o link direto. */
function VoltarMeus({ token }: { token: string }) {
	const loc = useLocation();
	const navegar = useNavigate();
	const veio = (loc.state as { de?: string } | null)?.de === rotaTreino(token);
	const cls = 'inline-flex min-h-[32px] items-center gap-1.5 text-[13px] font-medium text-[var(--base-texto-2)] hover:text-[var(--base-texto)]';
	return veio
		? <button type="button" className={cls} onClick={() => navegar(-1)} aria-label="Voltar para Meus treinamentos"><ArrowLeft size={14} aria-hidden="true" />Meus treinamentos</button>
		: <Link to={rotaTreino(token)} replace className={cls} aria-label="Voltar para Meus treinamentos"><ArrowLeft size={14} aria-hidden="true" />Meus treinamentos</Link>;
}

// ------------------------------------------------------------------ Meus treinamentos
export function PaginaMeusTreinos({ token }: { token: string }) {
	const c = useMeusTreinos(token);
	if (!c) return <Carregando titulo="Meus treinamentos" />;
	if ('estado' in c) return <TelaLinkFechado estado={c.estado} ate={c.ate} />;
	if ('erro' in c) return <MolduraTreino titulo="Meus treinamentos"><Estado tipo="erro" titulo="Não abriu agora.">{c.erro}</Estado></MolduraTreino>;
	return <MeusTreinosView d={c.d} token={token} hoje={diaSP(0)} />;
}

export function MeusTreinosView({ d, token, hoje }: { d: MeusTreinos; token: string; hoje: string }) {
	const g = gruposMeus(d.treinos, hoje);
	const primeiro = d.apelido.trim().split(/\s+/)[0] || d.apelido;
	const cartao = (t: TreinoOperador) => {
		const p = pilulaTreino(t, hoje);
		return (
			<li key={t.atribuicao} className="flex min-w-0 flex-wrap items-center justify-between gap-3 rounded-2xl bg-[var(--base-cartao)] p-4" style={{ boxShadow: '0 0 0 1px var(--base-borda)' }}>
				<div className="min-w-0">
					<h3 className="text-[15px] font-semibold">{t.cenario.nome}</h3>
					<p className="mt-0.5 text-[12.5px] text-[var(--base-texto-2)]">Cliente simulado: {t.cenario.persona_nome} · meta {t.nota_minima}</p>
					<p className="mt-1.5"><Pilula tom={p.tom}>{p.texto}</Pilula></p>
				</div>
				<Link to={rotaBriefing(token, t.atribuicao)} state={{ de: rotaTreino(token) }} className="inline-flex h-9 items-center rounded-lg bg-[var(--destaque)] px-3.5 text-[13px] font-semibold text-[var(--destaque-texto,#fff)]">
					{podeComecar(t, hoje) ? 'Abrir o treino' : 'Ver'}<span className="sr-only"> {t.cenario.nome}</span>
				</Link>
			</li>
		);
	};
	const grupo = (titulo: string, lista: TreinoOperador[], vazio?: string) => (
		<section className="space-y-2" aria-label={titulo}>
			<h2 className="text-[15px] font-semibold">{titulo} <span className="font-normal text-[var(--base-texto-3)]">({lista.length})</span></h2>
			{lista.length ? <ul className="space-y-2">{lista.map(cartao)}</ul> : vazio ? <p className="text-[13px] text-[var(--base-texto-2)]">{vazio}</p> : null}
		</section>
	);
	return (
		<MolduraTreino titulo="Meus treinamentos">
			<p className="text-[14px] text-[var(--base-texto-2)]">Oi, {primeiro}! Aqui ficam os treinos que a Qualidade passou para você. Este link vale até {dataBR(d.valido_ate)}.</p>
			{d.treinos.length === 0 ? <Estado tipo="vazio" titulo="Nenhum treino para você agora.">Quando a Qualidade passar um treino, ele aparece aqui, neste mesmo link.</Estado> : (
				<>
					{grupo('Para fazer', g.fazer, 'Nada pendente. Bom trabalho!')}
					{g.aguardando.length > 0 && <>
						{grupo('Aguardando conversa com a Qualidade', g.aguardando)}
						<p className="text-[12.5px] text-[var(--base-texto-2)]">A Qualidade vai combinar com você o próximo passo desses treinos.</p>
					</>}
					{g.feitos.length > 0 && grupo('Feitos', g.feitos)}
				</>
			)}
		</MolduraTreino>
	);
}

// ------------------------------------------------------------------ briefing
export function PaginaBriefing({ token, atr, comecar }: { token: string; atr: string; comecar?: (t: TreinoOperador, modo: string) => ReactNode }) {
	const c = useMeusTreinos(token);
	if (!c) return <Carregando titulo="Treino" />;
	if ('estado' in c) return <TelaLinkFechado estado={c.estado} ate={c.ate} />;
	if ('erro' in c) return <MolduraTreino titulo="Treino"><Estado tipo="erro" titulo="Não abriu agora.">{c.erro}</Estado></MolduraTreino>;
	const t = c.d.treinos.find(x => String(x.atribuicao) === atr);
	if (!t) return <MolduraTreino titulo="Treino não encontrado" voltar={<VoltarMeus token={token} />}><Estado tipo="vazio" titulo="Este treino não está na sua lista.">Volte para “Meus treinamentos” e abra o treino por lá.</Estado></MolduraTreino>;
	return <BriefingView t={t} token={token} hoje={diaSP(0)} vozDisponivel={c.d.voz_disponivel} comecar={comecar} />;
}

export function BriefingView({ t, token, hoje, vozDisponivel, comecar }: { t: TreinoOperador; token: string; hoje: string; vozDisponivel: boolean; comecar?: (t: TreinoOperador, modo: string) => ReactNode }) {
	const c = t.cenario;
	const d = c.divida ?? {};
	const modos = t.modos.filter(m => c.modos.includes(m));
	const [modo, setModo] = useState(modos.includes('texto') && (!vozDisponivel || !modos.includes('voz')) ? 'texto' : modos[0] ?? 'texto');
	const p = pilulaTreino(t, hoje);
	const sim = /fictícia/.test(c.persona_nome) ? 'simulada' : 'simulado';
	return (
		<MolduraTreino titulo={c.nome} voltar={<VoltarMeus token={token} />}>
			<Aviso tom="info" titulo="Isto é treino.">{textoIstoETreino(t)}</Aviso>
			<p><Pilula tom={p.tom}>{p.texto}</Pilula></p>
			<Cartao titulo={`Cliente ${sim}`} linha="Ficha fictícia: nada aqui é de um cliente de verdade.">
				<dl className="grid gap-x-4 gap-y-2 text-[13.5px] sm:grid-cols-[auto_1fr]">
					<dt className="text-[var(--base-texto-3)]">Cliente</dt><dd className="m-0">{c.persona_nome} · {rotuloTipoCliente(c.perfil).toLowerCase()}</dd>
					{d.produto && <><dt className="text-[var(--base-texto-3)]">Produto</dt><dd className="m-0">{d.produto}</dd></>}
					{d.dias_atraso != null && <><dt className="text-[var(--base-texto-3)]">Atraso</dt><dd className="m-0">{d.dias_atraso} dias</dd></>}
					{d.faixa && <><dt className="text-[var(--base-texto-3)]">Saldo</dt><dd className="m-0">{FAIXAS_SALDO[d.faixa] ?? '—'} (o valor exato aparece na ligação)</dd></>}
					<dt className="text-[var(--base-texto-3)]">Alçada</dt><dd className="m-0">{textoAlcada(d.alcada)}</dd>
					<dt className="text-[var(--base-texto-3)]">Duração</dt><dd className="m-0">até {textoDuracao(c.duracao_max_s)}</dd>
				</dl>
				{c.descricao && <p className="mt-3 text-[13px] text-[var(--base-texto-2)]">{c.descricao}</p>}
			</Cartao>
			{(c.itens_foco.length > 0 || c.objetivo_cenario) && (
				<Cartao titulo="O que a Qualidade vai olhar">
					{c.itens_foco.length > 0 && (
						<ul className="space-y-1.5 text-[13.5px]">
							{c.itens_foco.map(i => <li key={i.id} className="flex flex-wrap items-center gap-2"><span>{i.texto ?? 'Item do checklist da empresa'}</span>{i.gravidade === 'bloqueante' && <Pilula tom="erro">{GRAVIDADE_RP.bloqueante}</Pilula>}</li>)}
						</ul>
					)}
					{c.objetivo_cenario && <p className="mt-3 text-[13px]"><span className="text-[var(--base-texto-3)]">Objetivo da ligação:</span> {c.objetivo_cenario}</p>}
					<p className="mt-2 text-[12px] text-[var(--base-texto-3)]">A nota usa o mesmo checklist das ligações reais. Item crítico com “não” reprova a sessão.</p>
				</Cartao>
			)}
			{podeComecar(t, hoje) ? (
				<Cartao titulo="Como você quer treinar?">
					<fieldset className="flex flex-wrap gap-3 text-[13.5px]">
						<legend className="sr-only">Modo do treino</legend>
						{modos.includes('voz') && <label className="inline-flex items-center gap-1.5"><input type="radio" name="modo" checked={modo === 'voz'} disabled={!vozDisponivel} onChange={() => setModo('voz')} />Voz (padrão){!vozDisponivel && ' · minutos de voz do mês acabaram'}</label>}
						{modos.includes('texto') && <label className="inline-flex items-center gap-1.5"><input type="radio" name="modo" checked={modo === 'texto'} onChange={() => setModo('texto')} />Texto</label>}
					</fieldset>
					<div className="mt-3">
						{comecar ? comecar(t, modo) : (
							<>
								<Botao disabled>Começar · em breve</Botao>
								<p className="mt-2 text-[12.5px] text-[var(--base-texto-2)]">A sessão de treino abre aqui em breve. O seu treino já está guardado neste link, com o prazo de {dataBR(t.prazo)}.</p>
							</>
						)}
					</div>
				</Cartao>
			) : t.situacao === 'aprovado' ? (
				<Aviso tom="ok" titulo="Você chegou na meta neste treino.">Bom trabalho! A Qualidade acompanha a sua evolução.</Aviso>
			) : (
				<Aviso tom="neutro" titulo={t.situacao === 'precisa_apoio' ? `Você usou ${t.tentativas_usadas === 1 ? 'a tentativa' : `as ${t.tentativas_usadas} tentativas`}.` : 'O prazo deste treino acabou.'}>A Qualidade vai combinar com você o próximo passo.</Aviso>
			)}
		</MolduraTreino>
	);
}
