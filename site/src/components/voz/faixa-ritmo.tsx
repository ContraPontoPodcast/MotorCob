// Agente Voz/CX › Ligações: faixa ao vivo do ritmo (Power e Preditivo, V7b; PREDITIVO.md 5.2, protótipo proto-canais
// fotos 72–73). Da carteira escolhida no topo (ou da empresa toda), por ritmo_voz_hoje (SQL 106/108), a cada 15 s: modo e
// razão agora, robôs (conversando, reservados), atendimento por pessoa, abandono (meta e teto), transferência sem
// operador (separada), curtas por linha e no total, a frase de estado, o dia por 30 min e por linha (bina mascarada).
// O Admin pode liberar as linhas paradas pelas curtas até 950/linha e 9.500/total só hoje (liberar_curtas_voz, SQL 109).
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { useMotorAuth } from '@/components/auth-provider';
import { Aviso, Botao, Cartao, Detalhes, Kpis, ListaValores, Modal, Pilula, Rotulo, Tabela, textareaCls } from '@/components/ds';
import { supabase, friendlyError } from '@/lib/supabase';
import { CURTAS, TETO_ABANDONO, fraseEstado, num, pct, type RitmoHoje } from '@/lib/ritmo';
import { useRitmoHoje } from '@/components/discagem/ritmo';

const hora = (iso: string) => new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' });

/** Uma linha parada pelas curtas (a mesma regra da VM, voz/orquestrador/curtas.py). */
export function linhaParada(t: { discadas: number; curtas: number }, liberado: boolean): boolean {
	const limite = liberado ? CURTAS.linhaLiberada : CURTAS.linha;
	return t.discadas >= limite && t.discadas > 0 && (100 * t.curtas) / t.discadas >= CURTAS.corte;
}

export function FaixaRitmoVista({ h, liberado, podeLiberar, onLiberar, metaPct }: { h: RitmoHoje; liberado: boolean; podeLiberar: boolean; onLiberar: () => void; metaPct?: number | null }) {
	const t = h.totais, u = h.ultima;
	const estado = fraseEstado(u?.estado, u?.razao);
	const modo = u ? (u.modo === 'preditivo' ? 'Preditivo' : 'Power') : '—';
	const paradas = h.por_tronco.filter(x => linhaParada(x, liberado));
	return (
		<Cartao titulo="Ritmo agora" linha={u ? `Atualizado às ${hora(u.janela)} · a cada 15 s` : 'Sem ligações hoje.'}>
			<Kpis itens={[
				{ rotulo: 'Modo', valor: u ? `${modo} · ${num(Number(u.razao))}` : '—', detalhe: 'números chamando por robô livre' },
				{ rotulo: 'Robôs', valor: u ? `${u.conversas} conversando` : '—', detalhe: u ? `${u.reservas} reservados · ${u.linhas} linhas no ar` : 'reservado = alguém acabou de atender' },
				{ rotulo: 'Abandono hoje', valor: pct(t.abandono_pct), detalhe: `${metaPct != null ? `meta ${num(metaPct)}% · ` : ''}teto ${TETO_ABANDONO}%`, tom: t.abandono_pct != null && t.abandono_pct > TETO_ABANDONO ? 'alerta' : undefined },
				{ rotulo: 'Curtas hoje', valor: pct(t.curtas_pct), detalhe: `${t.discadas.toLocaleString('pt-BR')} ligações · o ritmo cai a partir de ${CURTAS.aviso}%`, tom: t.curtas_pct != null && t.curtas_pct >= CURTAS.aviso ? 'atencao' : undefined },
			]} />
			<div className="mt-3 grid gap-3 md:grid-cols-2">
				<ListaValores itens={[
					['Atendem por pessoa', pct(t.atendimento_pct)],
					['Transferência sem operador (separada do abandono)', pct(t.transf_sem_operador_pct)],
					['Abandono em 30 dias', pct(h.abandono_30d?.abandono_pct)],
				]} />
				<p className="text-[12px] leading-relaxed text-[var(--base-texto-3)]">Abandono = atendeu e não teve robô em até 2 s; a pessoa ouviu a mensagem de identificação e não recebe outra ligação hoje. Transferência sem operador = pediu um humano e a sua fila não atendeu; o robô agendou retorno.</p>
			</div>
			{estado && <div className="mt-3"><Aviso tom={estado.tom} titulo={estado.titulo}>{estado.texto}</Aviso></div>}
			{(paradas.length > 0 || u?.estado === 'parado') && (
				<div className="mt-3">
					<Aviso tom={liberado ? 'info' : 'erro'} titulo={liberado ? 'Liberado hoje pelo Admin' : 'Linha parada pelas chamadas curtas'}
						acao={podeLiberar && !liberado ? <Botao tipo="perigo" pequeno onClick={onLiberar}>Liberar até 950/linha e 9.500/total hoje</Botao> : undefined}>
						{liberado ? `As linhas voltam a parar em ${CURTAS.linhaLiberada} ligações (e a empresa em ${CURTAS.empresaLiberada.toLocaleString('pt-BR')}) com ${CURTAS.corte}% de curtas. Só hoje.`
							: `${paradas.length ? paradas.map(p => p.bina ?? `tronco ${p.tronco_id}`).join(', ') : 'Uma linha'} chegou a ${CURTAS.linha} ligações com ${CURTAS.corte}% ou mais de curtas e volta amanhã às 08:00. Nunca trocamos a bina nem desviamos para outra linha.`}
					</Aviso>
				</div>
			)}
			{h.janelas.length > 0 && (
				<Detalhes resumo="O dia por meia hora" qtd={h.janelas.length}>
					<Tabela rotulo="O dia por meia hora" linhas={h.janelas} chave={j => j.inicio}
						colunas={[
							{ id: 'h', titulo: 'Desde', celula: j => hora(j.inicio) },
							{ id: 'r', titulo: 'Razão', num: true, celula: j => num(Number(j.razao)) },
							{ id: 'a', titulo: 'Atendem', num: true, celula: j => pct(j.atendimento_pct) },
							{ id: 'b', titulo: 'Abandono', num: true, celula: j => pct(j.abandono_pct) },
							{ id: 'c', titulo: 'Curtas', num: true, celula: j => pct(j.curtas_pct) },
						]}
						celular={j => ({ titulo: hora(j.inicio), valor: `razão ${num(Number(j.razao))}`, resumo: `atendem ${pct(j.atendimento_pct)} · abandono ${pct(j.abandono_pct)} · curtas ${pct(j.curtas_pct)}` })} />
				</Detalhes>
			)}
			{h.por_tronco.length > 0 && (
				<Detalhes resumo="Por linha (bina)" qtd={h.por_tronco.length}>
					<Tabela rotulo="Por linha" linhas={h.por_tronco} chave={x => x.tronco_id}
						colunas={[
							{ id: 'l', titulo: 'Linha', celula: x => x.bina ?? `Tronco ${x.tronco_id}` },
							{ id: 'd', titulo: 'Ligações', num: true, celula: x => `${x.discadas.toLocaleString('pt-BR')} de ${(liberado ? CURTAS.linhaLiberada : CURTAS.linha).toLocaleString('pt-BR')}` },
							{ id: 'c', titulo: 'Curtas', num: true, celula: x => pct(x.curtas_pct) },
							{ id: 'b', titulo: 'Abandono', num: true, celula: x => pct(x.abandono_pct) },
							{ id: 's', titulo: 'Situação', celula: x => linhaParada(x, liberado) ? <Pilula tom="erro">Parada hoje</Pilula> : (x.curtas_pct ?? 0) >= CURTAS.aviso ? <Pilula tom="atencao">Ritmo reduzido</Pilula> : <Pilula tom="ok">Ligando</Pilula> },
						]}
						celular={x => ({ titulo: x.bina ?? `Tronco ${x.tronco_id}`, valor: linhaParada(x, liberado) ? 'Parada hoje' : pct(x.curtas_pct), resumo: `${x.discadas.toLocaleString('pt-BR')} ligações · curtas ${pct(x.curtas_pct)}` })} />
				</Detalhes>
			)}
		</Cartao>
	);
}

/** A faixa com dados (ritmo_voz_hoje a cada 15 s e a liberação de hoje). Nada sem empresa. */
export function FaixaRitmo({ metaPct }: { metaPct?: number | null }) {
	const { empresa, credor, perfil } = useMotorAuth();
	const h = useRitmoHoje(empresa ? Number(empresa.id) : null, credor ? Number(credor.id) : null);
	const [liberado, setLiberado] = useState(false);
	const [pedindo, setPedindo] = useState(false);
	const [motivo, setMotivo] = useState('');
	const [ocupado, setOcupado] = useState(false);
	const hoje = new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });
	useEffect(() => {
		if (!supabase || !empresa) return;
		void supabase.from('voz_curtas_liberacoes').select('id').eq('empresa_id', empresa.id).eq('dia', hoje).maybeSingle()
			.then(({ data }) => setLiberado(!!data));
	}, [empresa?.id, hoje]);
	if (!empresa || !h) return null;
	async function liberar() {
		if (!supabase || !empresa) return;
		setOcupado(true);
		const { error } = await supabase.rpc('liberar_curtas_voz', { empresa: Number(empresa.id), motivo: motivo.trim() });
		setOcupado(false);
		if (error) { toast.error(friendlyError(error)); return; }
		setPedindo(false); setLiberado(true); setMotivo('');
		toast.success('Liberado até 950 por linha e 9.500 no total, só hoje. Vale na VM em até 5 minutos.');
	}
	return (
		<>
			<FaixaRitmoVista h={h} liberado={liberado} podeLiberar={perfil?.papel === 'admin'} onLiberar={() => setPedindo(true)} metaPct={metaPct} />
			{pedindo && (
				<Modal titulo="Liberar até 950/linha e 9.500/total hoje?" perigo confirmar="Liberar e assumir o risco" ocupado={ocupado}
					desabilitado={motivo.trim().length < 10} onConfirmar={() => void liberar()} onFechar={() => setPedindo(false)}
					texto="Acima de 1.000 ligações numa linha (ou 10.000 no total) com 85% de curtas, a operadora bloqueia todas as linhas da empresa por 15 dias. A liberação vale só hoje, fica na Auditoria com o seu nome e não desliga a redução do ritmo.">
					<Rotulo texto="Motivo (de 10 a 300 caracteres, sem dados de clientes)">
						<textarea className={textareaCls} maxLength={300} value={motivo} onChange={e => setMotivo(e.target.value)} placeholder="Ex.: campanha de feirão autorizada pela diretoria" />
					</Rotulo>
				</Modal>
			)}
		</>
	);
}
