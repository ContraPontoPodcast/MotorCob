// Roleplay › Cenários › Novo a partir dos padrões das ligações (/cenarios/novo?de=insights, SQL 122).
// A Qualidade vê os padrões do período (só grupos com 30 ou mais ligações: motivos, objeções e os itens do checklist
// com menos "sim"), escolhe o que o cenário deve exercitar e a Edge Function `treino` gera um cliente simulado FICTÍCIO
// (acao gerar_cenario): vai ao modelo só o JSON de códigos e porcentagens, nunca trecho, nome, CPF, telefone ou valor de
// cliente. O cenário entra em RASCUNHO e abre no editor com o selo "Cenário gerado de padrões agregados": uma pessoa
// revisa e publica. A tela de geração não fica no histórico (o editor do cenário toma o lugar dela).
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { Aviso, Botao, Cartao, Estado, Segmentos } from '@/components/ds';
import { friendlyError, supabase } from '@/lib/supabase';
import { erroDaFuncao } from '@/lib/funcoes';
import { MOTIVOS, OBJECOES, dataBR, nf } from '@/lib/speech';
import { itemChecklist, rotaCenarioRP, type ItemChecklistRP } from '@/lib/roleplay';
import { MolduraRP } from './moldura';
import { SeloLgpdTreino } from './comum';
import { lerItensChecklist } from './dados';
import type { PodeRP } from './index';

export type PadroesRP = {
	de: string; ate: string; base: number; minimo: number; suficiente: boolean;
	motivos: { codigo: string; conversas: number; pct: number; acordo_pct: number }[];
	objecoes: { codigo: string; conversas: number; pct: number; acordo_pct: number }[];
	itens: { item: string; avaliadas: number; sim_pct: number }[];
};
export type EscolhaRP = { motivo: string | null; objecao: string | null; item: string | null };
const DIAS = [{ v: '7', n: '7 dias' }, { v: '30', n: '30 dias' }, { v: '90', n: '90 dias' }];
const pctBR = (v: number) => `${Math.round(v * 100)}%`;

export function NovoDeInsights({ empresa, pode }: { empresa: number; pode: PodeRP }) {
	const navegar = useNavigate();
	const [dias, setDias] = useState('30');
	const [p, setP] = useState<PadroesRP | null>(null);
	const [itens, setItens] = useState<Record<string, ItemChecklistRP>>({});
	const [erro, setErro] = useState('');
	const [gerando, setGerando] = useState(false);
	useEffect(() => {
		if (!supabase || !pode.cenarios) return;
		let ativo = true;
		setP(null); setErro('');
		Promise.all([supabase.rpc('padroes_insights_treino', { empresa, dias: Number(dias) }), lerItensChecklist(supabase, empresa)])
			.then(([r, i]) => {
				if (!ativo) return;
				if (r.error) { setErro(friendlyError(r.error)); return; }
				setP(r.data as PadroesRP); setItens(i);
			}).catch(e => { if (ativo) setErro(e instanceof Error ? e.message : 'Não deu para carregar.'); });
		return () => { ativo = false; };
	}, [empresa, dias, pode.cenarios]);

	async function gerar(e: EscolhaRP) {
		if (!supabase) return;
		setGerando(true); setErro('');
		const { data, error } = await supabase.functions.invoke('treino', { body: { acao: 'gerar_cenario', empresa, dias: Number(dias), ...e } });
		setGerando(false);
		const id = (data as { cenario?: number } | null)?.cenario;
		if (error || !id) { setErro((await erroDaFuncao(error, data, 'Não deu para gerar o cenário agora.')) ?? 'Não deu para gerar o cenário agora.'); return; }
		// o editor do cenário gerado toma o lugar desta tela (a geração não fica no histórico)
		navegar(`${rotaCenarioRP(id)}?gerado=1`, { replace: true });
	}

	return (
		<MolduraRP titulo="Novo a partir dos padrões das ligações" detalhe="Novo a partir dos padrões"
			descricao="Um cliente simulado fictício que representa o que mais aparece nas ligações. Entra em rascunho para você revisar e publicar." acoes={<SeloLgpdTreino />}>
			{!pode.cenarios ? <Estado tipo="semPermissao" titulo="Seu perfil não cria cenários.">Quem tem a permissão de editar cenários de treino cria e publica os cenários da empresa.</Estado>
				: !p && !erro ? <Estado tipo="carregando" />
				: <div className="space-y-4">
					<Segmentos rotulo="Período dos padrões" valor={dias} onTrocar={setDias} itens={DIAS} />
					{erro && <div role="alert"><Aviso tom="erro">{erro}</Aviso></div>}
					{p && <PadroesView p={p} itens={itens} gerando={gerando} onGerar={e => void gerar(e)} />}
				</div>}
		</MolduraRP>
	);
}

/** A escolha do padrão com os dados já lidos (sem banco: é o que os testes renderizam). */
export function PadroesView({ p, itens, gerando, onGerar }: { p: PadroesRP; itens: Record<string, ItemChecklistRP>; gerando: boolean; onGerar: (e: EscolhaRP) => void }) {
	const [e, setE] = useState<EscolhaRP>({ motivo: p.motivos[0]?.codigo ?? null, objecao: null, item: p.itens[0]?.item ?? null });
	if (!p.suficiente) {
		return <Estado tipo="vazio" titulo="Ainda não há ligações suficientes no período.">Para gerar um cenário dos padrões, são precisas pelo menos {p.minimo} ligações analisadas ({nf(p.base)} no período). Tente um período maior ou crie o cenário do zero.</Estado>;
	}
	const nada = !p.motivos.length && !p.objecoes.length && !p.itens.length;
	const grupo = (titulo: string, nome: 'motivo' | 'objecao' | 'item', ops: { v: string; rotulo: string; detalhe: string }[]) => (
		<fieldset className="space-y-1.5">
			<legend className="mb-1 text-[13px] font-semibold">{titulo}</legend>
			{ops.length === 0 ? <p className="text-[12.5px] text-[var(--base-texto-3)]">Nenhum com {p.minimo} ou mais no período.</p> : <>
				<label className="flex items-center gap-2 text-[13px]"><input type="radio" name={nome} checked={e[nome] == null} onChange={() => setE(x => ({ ...x, [nome]: null }))} />Nenhum</label>
				{ops.map(o => (
					<label key={o.v} className="flex items-start gap-2 text-[13px]">
						<input type="radio" className="mt-0.5" name={nome} checked={e[nome] === o.v} onChange={() => setE(x => ({ ...x, [nome]: o.v }))} />
						<span>{o.rotulo}<small className="block text-[12px] text-[var(--base-texto-3)]">{o.detalhe}</small></span>
					</label>
				))}
			</>}
		</fieldset>
	);
	return (
		<div className="space-y-4">
			<Aviso tom="info" titulo="Só padrões agregados.">De {dataBR(p.de)} a {dataBR(p.ate)}, sobre {nf(p.base)} ligações analisadas. Entram só grupos com {p.minimo} ou mais ligações, como códigos e porcentagens: nenhum trecho, nome, CPF, telefone ou valor de cliente vai para o cenário nem para o modelo.</Aviso>
			{nada ? <Estado tipo="vazio" titulo="Nenhum padrão com ligações suficientes.">Os motivos, as objeções e os itens aparecem aqui quando cada um tiver {p.minimo} ou mais ligações no período.</Estado> : (
				<Cartao titulo="O que o cenário deve exercitar" linha="Escolha um motivo, uma objeção e, se quiser, o item do checklist em foco.">
					<div className="grid gap-5 sm:grid-cols-3">
						{grupo('Motivo do atraso', 'motivo', p.motivos.map(m => ({ v: m.codigo, rotulo: MOTIVOS[m.codigo] ?? 'Outro motivo', detalhe: `${pctBR(m.pct)} das ligações · ${pctBR(m.acordo_pct)} com acordo` })))}
						{grupo('Objeção', 'objecao', p.objecoes.map(o => ({ v: o.codigo, rotulo: OBJECOES[o.codigo] ?? 'Outra objeção', detalhe: `${pctBR(o.pct)} das ligações · ${pctBR(o.acordo_pct)} com acordo` })))}
						{grupo('Item do checklist em foco', 'item', p.itens.map(i => ({ v: i.item, rotulo: itemChecklist(i.item, itens).texto, detalhe: `${pctBR(i.sim_pct)} de “sim” em ${nf(i.avaliadas)} avaliações` })))}
					</div>
				</Cartao>
			)}
			<div className="flex flex-wrap items-center gap-3">
				<Botao onClick={() => onGerar(e)} disabled={gerando || nada || (!e.motivo && !e.objecao && !e.item)}>{gerando ? 'Gerando o rascunho…' : 'Gerar rascunho'}</Botao>
				<small className="text-[12px] text-[var(--base-texto-3)]">O rascunho abre no editor. Revise tudo antes de publicar: a geração só sugere.</small>
			</div>
		</div>
	);
}
