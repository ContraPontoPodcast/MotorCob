// Agente Voz/CX › Discagem › aba "Ritmo" (Power ou Preditivo, por carteira; PREDITIVO.md 5.1, protótipo proto-canais
// fotos 70–75). Edita credores.discagem › ritmo no rascunho da Discagem (salva com o resto, por salvar_discagem: versão,
// validação e auditoria). Mostra o dia (ritmo_voz_hoje, SQL 106/108), o que acontece quando alguém atende sem robô,
// os freios fixos (teto de abandono e chamadas curtas) e a gaveta "Qual escolher?".
import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { Aviso, Cartao, Gaveta, Kpis, ListaRegras, Pilula, Rotulo, campoCls, campoStyle } from '@/components/ds';
import { supabase } from '@/lib/supabase';
import {
	CURTAS, MENSAGEM_ABANDONO, POWER_SUGERIDO, RAZOES_MAX, RAZOES_POWER, RAZAO_MAX_1A_SEMANA, TETO_ABANDONO, fraseEstado,
	fraseRitmo, num, pct, type Ritmo, type RitmoHoje,
} from '@/lib/ritmo';

export function useRitmoHoje(empresaId: number | null, credorId: number | null): RitmoHoje | null {
	const [h, setH] = useState<RitmoHoje | null>(null);
	useEffect(() => {
		let vivo = true;
		async function ler() {
			if (!supabase || empresaId == null) return;
			const { data } = await supabase.rpc('ritmo_voz_hoje', { empresa: empresaId, credor: credorId });
			if (vivo) setH((data as RitmoHoje | null) ?? null);
		}
		void ler();
		const t = window.setInterval(() => { void ler(); }, 15_000);
		return () => { vivo = false; window.clearInterval(t); };
	}, [empresaId, credorId]);
	return h;
}

function Escolha({ ativo, titulo, selo, texto, onClick, children, disabled }: { ativo: boolean; titulo: string; selo?: string; texto: string; onClick: () => void; children?: React.ReactNode; disabled?: boolean }) {
	return (
		<div className="flex min-w-0 flex-1 basis-[280px] flex-col gap-3 rounded-2xl border p-4" style={{ borderColor: ativo ? 'var(--destaque)' : 'var(--base-borda)', boxShadow: ativo ? '0 0 0 1px var(--destaque)' : undefined }}>
			<button type="button" role="radio" aria-checked={ativo} disabled={disabled} onClick={onClick} className="flex items-start gap-2.5 text-left disabled:cursor-default">
				<span aria-hidden className="mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-full border-2" style={{ borderColor: ativo ? 'var(--destaque)' : 'var(--base-borda)' }}>
					{ativo && <i className="block h-2 w-2 rounded-full bg-[var(--destaque)]" />}
				</span>
				<span className="min-w-0">
					<span className="flex flex-wrap items-center gap-2 text-[15px] font-semibold text-[var(--base-texto)]">{titulo}{selo && <Pilula tom="info">{selo}</Pilula>}</span>
					<span className="mt-1 block text-[13px] leading-relaxed text-[var(--base-texto-2)]">{texto}</span>
				</span>
			</button>
			{ativo && children}
		</div>
	);
}

export function RitmoCarteira({ ritmo, onTrocar, canEdit, hoje }: { ritmo: Ritmo; onTrocar: (r: Ritmo) => void; canEdit: boolean; hoje: RitmoHoje | null }) {
	const [qual, setQual] = useState(false);
	const t = hoje?.totais;
	const estado = fraseEstado(hoje?.ultima?.estado, hoje?.ultima?.razao);
	const trocar = (p: Partial<Ritmo>) => canEdit && onTrocar({ ...ritmo, ...p });
	return (
		<div className="flex flex-col gap-4">
			<Cartao titulo="Hoje nesta carteira" linha={fraseRitmo(ritmo)} direita={<Link to="/voz/discagem/robos" className="text-[13px] font-semibold text-[var(--destaque)] hover:underline">Como os robôs funcionam com o Power e o Preditivo →</Link>}>
				<Kpis itens={[
					{ rotulo: 'Razão agora', valor: hoje?.ultima ? num(Number(hoje.ultima.razao)) : '—', detalhe: 'números chamando por robô livre' },
					{ rotulo: 'Abandono hoje', valor: pct(t?.abandono_pct), detalhe: ritmo.modo === 'preditivo' ? `meta ${num(ritmo.meta_abandono)}% · teto ${TETO_ABANDONO}%` : `teto ${TETO_ABANDONO}%`, tom: t?.abandono_pct != null && t.abandono_pct > TETO_ABANDONO ? 'alerta' : undefined },
					{ rotulo: 'Atendem por pessoa', valor: pct(t?.atendimento_pct), detalhe: t ? `${t.discadas.toLocaleString('pt-BR')} ligações hoje` : 'sem ligações hoje' },
					{ rotulo: 'Curtas hoje', valor: pct(t?.curtas_pct), detalhe: `a partir de ${CURTAS.aviso}% o ritmo cai`, tom: t?.curtas_pct != null && t.curtas_pct >= CURTAS.aviso ? 'atencao' : undefined },
				]} />
				{estado && <div className="mt-3"><Aviso tom={estado.tom} titulo={estado.titulo}>{estado.texto}</Aviso></div>}
			</Cartao>

			<Cartao titulo="Como o MotorCX disca" linha="Por carteira. Vale no minuto seguinte ao salvar." direita={<button type="button" onClick={() => setQual(true)} className="text-[13px] font-semibold text-[var(--destaque)] hover:underline">Qual escolher?</button>}>
				<div role="radiogroup" aria-label="Modo de discagem" className="flex flex-wrap gap-3">
					<Escolha ativo={ritmo.modo === 'power'} titulo="Power" disabled={!canEdit}
						texto="Para cada robô livre, ligue N números. Você escolhe o N."
						onClick={() => trocar({ modo: 'power' })}>
						<Rotulo texto="Números por robô livre" dica="1,0 = ninguém atende sem robô (progressivo). Acima de 2,0, em horário de muito atendimento, pode haver abandono.">
							<select className={campoCls} style={campoStyle} disabled={!canEdit} value={ritmo.razao} onChange={e => trocar({ razao: Number(e.target.value) })}>
								{RAZOES_POWER.map(r => <option key={r} value={r}>{num(r)}{r === 1 ? ' · progressivo' : r === POWER_SUGERIDO ? ' · sugerido' : ''}</option>)}
							</select>
						</Rotulo>
					</Escolha>
					<Escolha ativo={ritmo.modo === 'preditivo'} titulo="Preditivo" selo="para carteiras com volume" disabled={!canEdit}
						texto={`O MotorCX calcula a cada minuto quantos números ligar para os robôs não ficarem parados, com no máximo ${num(ritmo.meta_abandono)}% de pessoas atendendo sem robô.`}
						onClick={() => trocar({ modo: 'preditivo' })}>
						<div className="grid gap-3 sm:grid-cols-2">
							<Rotulo texto="Meta de abandono (%)" dica={`De 0,5% a ${TETO_ABANDONO}%. O teto de ${TETO_ABANDONO}% é fixo.`}>
								<input type="number" min={0.5} max={TETO_ABANDONO} step={0.1} className={campoCls} style={campoStyle} disabled={!canEdit} value={ritmo.meta_abandono}
									onChange={e => { const v = Number(e.target.value); if (v >= 0.5 && v <= TETO_ABANDONO) trocar({ meta_abandono: Math.round(v * 10) / 10 }); }} />
							</Rotulo>
							<Rotulo texto="Razão máxima" dica={`Razão 2,0 = no máximo 2 números chamando por robô livre. Na primeira semana, até ${num(RAZAO_MAX_1A_SEMANA)}.`}>
								<select className={campoCls} style={campoStyle} disabled={!canEdit} value={ritmo.razao_max} onChange={e => trocar({ razao_max: Number(e.target.value) })}>
									{RAZOES_MAX.map(r => <option key={r} value={r}>{num(r)}</option>)}
								</select>
							</Rotulo>
						</div>
						<p className="text-[12px] text-[var(--base-texto-3)]">Começa em aquecimento: liga 1 por robô até juntar 200 atendimentos por pessoa nos últimos 7 dias. Nos primeiros 15 minutos do dia, até 1,5 por robô.</p>
					</Escolha>
				</div>
			</Cartao>

			<Cartao titulo="Quando alguém atende e não há robô" linha="Só leitura. Vale para os dois modos.">
				<blockquote className="rounded-xl bg-[var(--base-fill)] px-3.5 py-2.5 text-[13.5px] italic text-[var(--base-texto)]">“{MENSAGEM_ABANDONO}”</blockquote>
				<ul className="mt-3 list-disc space-y-1 pl-5 text-[13px] text-[var(--base-texto-2)]">
					<li>A pessoa nunca fica no silêncio: ouve a mensagem na hora, sem falar de dívida nem de credor.</li>
					<li><b className="text-[var(--base-texto)]">Não ligamos de novo no mesmo dia.</b> Na próxima vez, ela vai com robô reservado.</li>
					<li>2 abandonos em 7 dias tiram o cliente da voz por 3 dias.</li>
					<li>Todo abandono conta como chamada curta.</li>
				</ul>
			</Cartao>

			<Cartao titulo="Freios" linha="Fixos. Ninguém desliga.">
				<ListaRegras regras={[
					{ titulo: `Teto de abandono: ${TETO_ABANDONO}%`, texto: ritmo.modo === 'preditivo' ? 'Passou disso, o MotorCX corta a margem pela metade; se continuar por 10 minutos, liga 1 por robô até o fim do dia.' : 'Passou disso na última meia hora, liga 1 por robô até o fim do dia.' },
					{ titulo: `Chamadas curtas: o ritmo cai a partir de ${CURTAS.aviso}%`, texto: `Em ${CURTAS.corte}% com ${CURTAS.linha} ligações numa linha, a linha para no dia; com ${CURTAS.empresa.toLocaleString('pt-BR')} no total, a empresa para no dia. Veja a aba Chamadas curtas.` },
					{ titulo: 'Transferência sem operador não é abandono', texto: 'Quando a sua fila humana não atende, o robô agenda um retorno. Isso não freia o discador.' },
				]} />
			</Cartao>

			<Gaveta aberta={qual} onFechar={() => setQual(false)} titulo="Power ou Preditivo?" largura={560}>
				<QualEscolher />
			</Gaveta>
		</div>
	);
}

const LINHAS_QUAL: [string, string, string][] = [
	['Abandono', 'Previsível só com N baixo. N alto num horário de muito atendimento gera picos, porque N não se ajusta.', 'Fica perto da meta o dia todo: o MotorCX se ajusta quando muda a chance de atender.'],
	['Chamadas curtas', 'Quase iguais. Volume por linha mais previsível.', 'Quase iguais. Liga mais rápido e chega antes aos limites de volume; os freios seguram.'],
	['Uso dos robôs', '60% a 80%, oscilando com a hora.', '80% a 90%, estável.'],
	['Conversas por hora', '1,6 a 1,9 vez o progressivo.', 'Cerca de 2 vezes o progressivo.'],
	['Risco', 'Baixo com N até 1,5; médio com N a partir de 2,5.', 'Baixo depois do aquecimento.'],
	['Quando usar', 'Carteira pequena, nova, sensível ou quando você quer previsibilidade.', 'Carteira com volume (mais de 2.000 ligações por dia) e histórico.'],
];

export function QualEscolher() {
	return (
		<div className="flex flex-col gap-3 text-[13px]">
			<p className="text-[var(--base-texto-2)]">Os dois respeitam os mesmos freios. Power 1,0 é o progressivo: ninguém atende sem robô.</p>
			{LINHAS_QUAL.map(([k, p, d]) => (
				<div key={k} className="rounded-xl border p-3" style={{ borderColor: 'var(--base-borda)' }}>
					<b className="text-[var(--base-texto)]">{k}</b>
					<div className="mt-1.5 grid gap-2 sm:grid-cols-2">
						<p className="text-[var(--base-texto-2)]"><span className="font-semibold text-[var(--base-texto)]">Power:</span> {p}</p>
						<p className="text-[var(--base-texto-2)]"><span className="font-semibold text-[var(--base-texto)]">Preditivo:</span> {d}</p>
					</div>
				</div>
			))}
		</div>
	);
}
