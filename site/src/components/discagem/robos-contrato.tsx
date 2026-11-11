// Agente Voz/CX › Discagem: cartão "Seu contrato: N robôs" (Robôs contratados, PR 7; protótipo proto-robos
// `#/voz/discagem`). Só leitura: contratados (voz_licenca_vigente, sem preço), disponíveis agora e o motivo
// (voz_divisao_concorrencia, SQL 101), em uso agora e pico de hoje (voz_robos_agora / voz_robos_dia, SQL 102, gravados
// pela VM a cada 15 s). O que acontece no limite e "Pedir mais robôs" (Suporte com o chamado pré-preenchido).
// O cliente nunca vê preço de custo nem o teto global: o corte do teto aparece como "limite temporário da plataforma".
import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { supabase, type Row } from '@/lib/supabase';
import { inteiro } from '@/lib/voz';
import { detalhePico, emUsoAgora, linhaDivisao, porQueCliente, type LinhaDivisao } from '@/lib/robos-voz';
import { Aviso, Kpis } from '@/components/ds';
import { Cartao } from '@/components/comuns/voz-ui';

export type DadosRobos = {
	robos: number | null;
	divisao: LinhaDivisao | null;
	agora: Row | null;
	dia: Row | null;
};

const hojeSP = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });

/** Lê os quatro e atualiza a cada 15 s (o ritmo da VM). */
export function RobosContrato({ empresaId }: { empresaId: number }) {
	const [d, setD] = useState<DadosRobos | null>(null);
	const [agoraMs, setAgoraMs] = useState(() => Date.now());
	useEffect(() => {
		let vivo = true;
		async function ler() {
			if (!supabase) return;
			const [l, dv, ag, di] = await Promise.all([
				supabase.from('voz_licenca_vigente').select('robos').eq('empresa_id', empresaId).maybeSingle(),
				supabase.from('voz_divisao_concorrencia').select('empresa_id,canais,limite,teto,pico_multiplo,licencas,motivo').eq('empresa_id', empresaId).maybeSingle(),
				supabase.from('voz_robos_agora').select('em_uso,limite,no_limite,atualizado_em').eq('empresa_id', empresaId).maybeSingle(),
				supabase.from('voz_robos_dia').select('pico,pico_em,segundos_no_limite').eq('empresa_id', empresaId).eq('dia', hojeSP()).maybeSingle(),
			]);
			if (!vivo) return;
			setD({
				robos: l.data ? Number((l.data as Row).robos ?? 0) : null,
				divisao: dv.data ? linhaDivisao(dv.data as Row) : null,
				agora: (ag.data as Row | null) ?? null,
				dia: (di.data as Row | null) ?? null,
			});
			setAgoraMs(Date.now());
		}
		void ler();
		const t = window.setInterval(() => { void ler(); }, 15_000);
		return () => { vivo = false; window.clearInterval(t); };
	}, [empresaId]);
	if (!d) return null;
	return <CartaoRobos d={d} agoraMs={agoraMs} />;
}

/** O cartão em si (sem banco: o teste renderiza com dados prontos). Nada quando a empresa não tem agente de voz. */
export function CartaoRobos({ d, agoraMs }: { d: DadosRobos; agoraMs: number }) {
	const robos = d.robos ?? 0;
	if (robos <= 0) {
		if (!d.divisao) return null;      // sem licença e sem voz ligada: nada a mostrar
		return (
			<Cartao titulo="Robôs do agente de voz" className="mb-4"
				desc="1 robô = 1 conversa ao mesmo tempo com o agente de voz."
				acoes={<Link to="/suporte/novo?assunto=robos" className={botao}>Pedir robôs</Link>}>
				<p className="text-[13.5px] text-[var(--base-texto-2)]">
					Seu contrato ainda não tem robôs cadastrados. Hoje o agente faz até <b className="text-[var(--base-texto)]">{inteiro(d.divisao.limite)}</b> {d.divisao.limite === 1 ? 'conversa' : 'conversas'} ao mesmo tempo. Para garantir uma quantidade fixa, peça à equipe MotorCX.
				</p>
			</Cartao>
		);
	}
	const lim = d.divisao ? Math.min(d.divisao.limite, robos) : null;
	const uso = emUsoAgora(d.agora, agoraMs);
	const pico = Number(d.dia?.pico ?? 0);
	const segLimite = Number(d.dia?.segundos_no_limite ?? 0);
	const porque = d.divisao && lim != null && lim < robos ? porQueCliente(d.divisao) : '';
	const base = lim ?? robos;
	return (
		<Cartao titulo={`Seu contrato: ${inteiro(robos)} ${robos === 1 ? 'robô' : 'robôs'}`} className="mb-4"
			desc="1 robô = 1 conversa ao mesmo tempo com o agente de voz. Só leitura: quem muda é a equipe MotorCX."
			acoes={<Link to={`/suporte/novo?assunto=robos&robos=${robos}`} className={botao}>Pedir mais robôs</Link>}>
			<div className="space-y-4">
				<Kpis itens={[
					{ rotulo: 'Contratados', valor: inteiro(robos), detalhe: 'licenças' },
					{ rotulo: 'Disponíveis agora', valor: lim == null ? '—' : inteiro(lim), detalhe: lim == null ? 'precisa de um tronco ativo' : lim < robos ? 'menos que o contrato' : 'todos', tom: lim != null && lim < robos ? 'atencao' : undefined },
					{ rotulo: 'Em uso agora', valor: uso == null ? '—' : inteiro(uso), detalhe: uso == null ? 'sem leitura agora' : 'atualiza a cada 15 s' },
					{ rotulo: 'Pico hoje', valor: inteiro(pico), detalhe: detalhePico(pico, d.dia?.pico_em, base, segLimite) },
				]} />
				{uso != null && base > 0 && (
					<div>
						<div role="img" aria-label={`${uso} de ${base} robôs em uso`} className="h-2.5 overflow-hidden rounded-full bg-[var(--base-fill)]">
							<i className="block h-full rounded-full bg-[var(--destaque)]" style={{ width: `${Math.min(100, (100 * uso) / Math.max(1, robos))}%` }} />
						</div>
						<div className="mt-1 flex justify-between text-[12px] text-[var(--base-texto-2)]"><span>{inteiro(uso)} em uso</span><span>{inteiro(base)} disponíveis de {inteiro(robos)}</span></div>
					</div>
				)}
				{porque && <Aviso tom={d.divisao?.motivo === 'teto' ? 'info' : 'atencao'}>{porque}</Aviso>}
				<details className="group rounded-xl bg-[var(--base-fill)] px-3.5 py-2.5 text-[13px]">
					<summary className="cursor-pointer font-semibold text-[var(--base-texto)]">O que acontece quando todos os robôs estão ocupados</summary>
					<ul className="mt-2 list-disc space-y-1 pl-5 text-[var(--base-texto-2)]">
						<li><b className="text-[var(--base-texto)]">Nenhuma ligação cai.</b> Quem está conversando com o robô continua até o fim.</li>
						<li><b className="text-[var(--base-texto)]">O número espera na lista.</b> O próximo cliente só é discado quando um robô fica livre: cada número sai com um robô reservado para ele.</li>
						<li>O lote demora mais. Se isso acontece todo dia no mesmo horário, vale pedir mais robôs.</li>
					</ul>
				</details>
			</div>
		</Cartao>
	);
}

const botao = 'inline-flex h-9 items-center justify-center rounded-full bg-[var(--destaque)] px-4 text-[13.5px] font-semibold text-[var(--destaque-texto)] hover:opacity-90';
