// Tela 4 · Extrato do cliente › "Ligações do agente virtual".
// Só o resultado e a tarifação de cada tentativa (voz_chamadas), sem transcrição. Número sempre mascarado.
// O custo é de telefonia (pago à operadora) e não entra na fatura do MotorCX; rota sem cadastro fica sem custo.
import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { Lock } from 'lucide-react';
import { usePermissao } from '@/components/app-shell';
import { useMotorAuth } from '@/components/auth-provider';
import { supabase } from '@/lib/supabase';
import {
	PERM_VOZ, TIPOS_ROTA, codigosEmPilulas, dataCurta, dataHoraCurta, duracao, duracaoExtensa, inteiro, numeroMascarado, reais,
	resultadoVoz, type CodigosVoz,
} from '@/lib/voz';
import { Aviso, Cartao, CartaoLinha, Pilula, Tabela } from './ui';

type Chamada = {
	id: number; ocorrido_em: string; destino_mascara: string | null; tentativa: number; resultado: string | null;
	duracao_s: number | null; billsec: number | null; tech_prefix: string | null; rota_id: number | null;
	segundos_tarifados: number | null; custo_operadora: number | null; tarifada_em: string | null; tem_gravacao: boolean;
	codigos: CodigosVoz | null; identidade_confirmada: boolean | null; data_promessa: string | null; retorno_em: string | null;
	transferencia: string | null; canal: string;
};
type Rota = { id: number; tipo: string; cadencia_inicial_s: number; cadencia_incremento_s: number };

const CONVERSA = new Set(['promessa', 'cpc', 'identidade_confirmada', 'recusa', 'retorno_agendado', 'opt_out', 'recado', 'atendida_sem_cpc', 'atendida_terceiro_desconhece']);

function custoCelula(c: Chamada): { texto: string; semCadastro: boolean } {
	if (!c.tarifada_em) return { texto: '—', semCadastro: false };
	if (!c.billsec || c.billsec <= 0) return { texto: 'não tarifada', semCadastro: false };
	if (c.rota_id == null || c.custo_operadora == null) return { texto: 'sem custo', semCadastro: true };
	return { texto: reais(c.custo_operadora, 4), semCadastro: false };
}

function resumoConversa(c: Chamada): string {
	const partes: string[] = [];
	if (c.identidade_confirmada) partes.push('Identidade confirmada');
	if (c.resultado === 'promessa' || c.data_promessa) partes.push(c.data_promessa ? `prometeu pagar em ${dataCurta(c.data_promessa)}` : 'promessa');
	if (c.resultado === 'retorno_agendado' || c.retorno_em) partes.push(c.retorno_em ? `pediu retorno em ${dataHoraCurta(c.retorno_em)}` : 'pediu retorno');
	if (c.resultado === 'recusa') partes.push('recusou');
	if (c.resultado === 'opt_out') partes.push('pediu para não ligar');
	if (c.transferencia === 'atendida') partes.push('passou para o operador');
	if (partes.length === 0) partes.push(resultadoVoz(c.resultado).label);
	return partes.join(' · ');
}

export function LigacoesAgenteVirtual({ idCliente, credorId }: { idCliente: string; credorId: string | null }) {
	const { empresa } = useMotorAuth();
	const podeOuvir = usePermissao(PERM_VOZ.ouvirGravacoes);
	const [chamadas, setChamadas] = useState<Chamada[]>([]);
	const [rotas, setRotas] = useState<Record<number, Rota>>({});
	const [carregado, setCarregado] = useState(false);
	const [falhou, setFalhou] = useState(false);

	useEffect(() => {
		if (!supabase || !empresa || !idCliente) return;
		const sb = supabase;
		let active = true;
		(async () => {
			let q = sb.from('voz_chamadas')
				.select('id,ocorrido_em,destino_mascara,tentativa,resultado,duracao_s,billsec,tech_prefix,rota_id,segundos_tarifados,custo_operadora,tarifada_em,tem_gravacao,codigos,identidade_confirmada,data_promessa,retorno_em,transferencia,canal')
				.eq('empresa_id', empresa.id).eq('id_cliente', idCliente).eq('canal', 'agente_voz')
				.order('ocorrido_em', { ascending: false }).limit(50);
			if (credorId) q = q.eq('credor_id', credorId);
			const { data, error } = await q;
			if (!active) return;
			if (error) { setFalhou(true); setCarregado(true); return; }
			const lista = (data ?? []) as Chamada[];
			setChamadas(lista);
			const ids = [...new Set(lista.map(c => c.rota_id).filter((x): x is number => x != null))];
			if (ids.length) {
				// voz_rotas só abre para quem vê faturamento; sem acesso, a coluna mostra só o tech prefix.
				const { data: rs } = await sb.from('voz_rotas').select('id,tipo,cadencia_inicial_s,cadencia_incremento_s').in('id', ids);
				if (!active) return;
				setRotas(Object.fromEntries(((rs ?? []) as Rota[]).map(r => [r.id, r])));
			}
			setCarregado(true);
		})();
		return () => { active = false; };
	}, [empresa?.id, idCliente, credorId]);

	if (!carregado) return null;

	const ultima = chamadas.find(c => (c.billsec ?? 0) > 0 && (c.identidade_confirmada || CONVERSA.has(String(c.resultado)))) ?? null;
	const comCodigos = chamadas.find(c => c.codigos && Object.keys(c.codigos).length > 0) ?? null;
	const pilulas = codigosEmPilulas(comCodigos?.codigos);
	const mes = new Date().toISOString().slice(0, 7);
	const doMes = chamadas.filter(c => c.ocorrido_em.slice(0, 7) === mes);
	const totTel = doMes.reduce((t, c) => t + Number(c.custo_operadora ?? 0), 0);
	const semCadastro = chamadas.filter(c => custoCelula(c).semCadastro);
	const linkGrav = `/gravacoes?cliente=${encodeURIComponent(idCliente)}`;

	const rotaTxt = (c: Chamada) => {
		if (!c.tech_prefix) return '—';
		const r = c.rota_id != null ? rotas[c.rota_id] : null;
		if (c.rota_id == null && c.tarifada_em && (c.billsec ?? 0) > 0) return <><span className="font-mono">{c.tech_prefix}</span> · <Pilula tom="atencao">sem cadastro</Pilula></>;
		return <><span className="font-mono">{c.tech_prefix}</span>{r ? ` · ${TIPOS_ROTA[r.tipo] ?? r.tipo} · ${r.cadencia_inicial_s}/${r.cadencia_incremento_s}` : ''}</>;
	};
	const gravTxt = (c: Chamada) => !c.tem_gravacao ? '—'
		: podeOuvir ? <Link to={linkGrav} className="font-semibold underline">Abrir em Gravações</Link>
		: <Pilula><Lock size={11} /> Sem permissão</Pilula>;

	return (
		<Cartao semPadding titulo={<span className="flex items-center gap-2">Ligações do agente virtual</span>} linha="Só o resultado e a tarifação de cada tentativa. A conversa fica em Gravações, para quem tem permissão."
			direita={podeOuvir && chamadas.some(c => c.tem_gravacao) ? <Link to={linkGrav} className="text-[13px] font-semibold underline">Gravações deste cliente</Link> : undefined}>
			{falhou ? <p className="px-4 pb-4 text-[13px] text-[var(--base-texto-2)] sm:px-5">Não foi possível ler as ligações do agente virtual agora.</p>
				: chamadas.length === 0 ? (
					<div className="px-4 pb-5 sm:px-5"><div className="rounded-xl bg-[var(--base-fill)] px-4 py-5 text-center text-[13px] text-[var(--base-texto-2)]">Nenhuma ligação do agente virtual para este cliente{credorId ? ' nesta carteira' : ''}.</div></div>
				) : (
					<>
						<div className="grid gap-3 px-4 pb-4 sm:px-5 lg:grid-cols-2">
							<div className="rounded-xl bg-[var(--base-fill)] p-3.5">
								<h3 className="text-[13.5px] font-semibold text-[var(--base-texto)]">{ultima ? `Última conversa: ${dataHoraCurta(ultima.ocorrido_em)} · ${duracaoExtensa(ultima.duracao_s ?? ultima.billsec)}` : 'Ainda sem conversa com o titular'}</h3>
								<p className="mt-1 text-[13px] text-[var(--base-texto-2)]">{ultima ? resumoConversa(ultima) : 'As tentativas abaixo não chegaram a uma conversa.'}</p>
							</div>
							<div className="rounded-xl bg-[var(--base-fill)] p-3.5">
								<h3 className="text-[13.5px] font-semibold text-[var(--base-texto)]">Para a próxima ligação</h3>
								{pilulas.length ? <div className="mt-1.5 flex flex-wrap gap-1.5">{pilulas.map(p => <Pilula key={p}>{p}</Pilula>)}</div> : <p className="mt-1 text-[13px] text-[var(--base-texto-2)]">Nenhum código guardado (ou já apagado com a gravação).</p>}
								<p className="mt-2 text-[11.5px] text-[var(--base-texto-3)]">Só códigos fechados, nunca texto livre. É o mesmo resumo que o agente recebe na próxima ligação.</p>
							</div>
						</div>
						<Tabela
							cabecalho={['Quando', 'Número', 'Tentativa no dia', 'Resultado', 'Duração', 'Rota', 'Seg. tarifados', 'Custo estimado', 'Gravação']}
							numericas={[2, 4, 6, 7]}
							linhas={chamadas.map(c => {
								const r = resultadoVoz(c.resultado ?? (c.tarifada_em ? null : 'em_andamento'));
								const cu = custoCelula(c);
								return [
									dataHoraCurta(c.ocorrido_em), <span key="n" className="font-mono">{numeroMascarado(c.destino_mascara)}</span>, `${c.tentativa}ª`,
									<Pilula key="r" tom={r.tom}>{r.label}</Pilula>, duracao(c.duracao_s ?? c.billsec), rotaTxt(c),
									c.segundos_tarifados != null ? `${inteiro(c.segundos_tarifados)} s` : '—',
									cu.semCadastro ? <span key="c" title="Rota sem cadastro: o custo não é calculado">sem custo</span> : cu.texto,
									gravTxt(c),
								];
							})}
							cartoes={chamadas.map(c => {
								const r = resultadoVoz(c.resultado ?? (c.tarifada_em ? null : 'em_andamento'));
								const cu = custoCelula(c);
								return (
									<CartaoLinha key={c.id}>
										<div className="flex items-center justify-between gap-2"><b>{dataHoraCurta(c.ocorrido_em)}</b><Pilula tom={r.tom}>{r.label}</Pilula></div>
										<small className="mt-1 block font-mono text-[var(--base-texto-2)]">{numeroMascarado(c.destino_mascara)} · {c.tentativa}ª tentativa · {duracao(c.duracao_s ?? c.billsec)}</small>
										<small className="block text-[var(--base-texto-2)]">Rota {c.tech_prefix ?? '—'}{c.segundos_tarifados != null ? ` · ${inteiro(c.segundos_tarifados)} s tarifados` : ''} · {cu.texto}</small>
										{c.tem_gravacao && <div className="mt-1">{gravTxt(c)}</div>}
									</CartaoLinha>
								);
							})}
						/>
						<div className="flex flex-wrap items-center justify-between gap-2 border-t px-4 py-3 text-[12.5px] text-[var(--base-texto-2)] sm:px-5" style={{ borderColor: 'var(--base-borda)' }}>
							<span>Telefonia estimada deste cliente no mês: <b className="text-[var(--base-texto)]">{reais(totTel, 4)}</b>{semCadastro.length ? ` (sem ${semCadastro.length === 1 ? 'a tentativa' : `as ${semCadastro.length} tentativas`} de rota sem cadastro)` : ''}. Paga pela empresa à operadora; não entra na fatura do MotorCX.</span>
							<span className="text-[var(--base-texto-3)]">Sem carência: qualquer segundo atendido paga o mínimo inicial.</span>
						</div>
						{semCadastro.length > 0 && (
							<div className="px-4 pb-4 sm:px-5">
								<Aviso titulo={`${semCadastro.length === 1 ? 'Uma tentativa saiu' : `${semCadastro.length} tentativas saíram`} por rota sem cadastro (${[...new Set(semCadastro.map(c => c.tech_prefix ?? '—'))].join(', ')}).`}>
									Fica sem custo calculado até a equipe MotorCX cadastrar a rota com o preço do contrato da operadora. O MotorCX não estima preço.
								</Aviso>
							</div>
						)}
					</>
				)}
		</Cartao>
	);
}
