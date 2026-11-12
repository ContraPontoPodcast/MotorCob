// Agente Voz/CX › Discagem › "Robôs e o Preditivo" (proto-robos SPEC §4.3, tela 5; ficou pendente no PR 229): por que a
// licença conta conversas com o robô e não linhas discando, com um exemplo ilustrativo no contrato da empresa (robôs
// disponíveis e canais dos troncos, voz_divisao_concorrencia / voz_licenca_vigente): Power 1,0, Power 2,0 ou Preditivo.
// Regra prática: canais ≈ robôs × razão. Só leitura; o ritmo de cada carteira se escolhe na aba Ritmo da Discagem.
import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { useMotorAuth } from '@/components/auth-provider';
import { PageHeading, Notice } from '@/components/app-shell';
import { Aviso, Cartao, Segmentos } from '@/components/ds';
import { supabase, type Row } from '@/lib/supabase';
import { MODOS_ILUSTRACAO, ilustrarRobos, type ModoIlustracao } from '@/lib/ritmo';

function Bolinhas({ total, acesas, rotulo }: { total: number; acesas: number; rotulo: string }) {
	const n = Math.min(total, 60);
	return (
		<div role="img" aria-label={rotulo} className="mt-2 flex flex-wrap gap-1">
			{Array.from({ length: n }, (_, i) => <i key={i} className="block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: i < acesas ? 'var(--destaque)' : 'var(--base-fill)' }} />)}
		</div>
	);
}

export function ExemploRobos({ robos, canais, modo, onModo }: { robos: number; canais: number; modo: ModoIlustracao; onModo: (m: ModoIlustracao) => void }) {
	const m = MODOS_ILUSTRACAO[modo];
	const x = ilustrarRobos(robos, canais, modo);
	return (
		<Cartao titulo="Veja com o seu contrato" linha={m.texto} direita={
			<Segmentos rotulo="Ritmo" valor={modo} onTrocar={onModo} itens={(Object.keys(MODOS_ILUSTRACAO) as ModoIlustracao[]).map(k => ({ v: k, n: MODOS_ILUSTRACAO[k].nome }))} />
		}>
			<div className="grid gap-3 sm:grid-cols-3">
				<div className="rounded-xl border p-3" style={{ borderColor: 'var(--base-borda)' }}>
					<small className="text-[12px] text-[var(--base-texto-2)]">Linhas discando</small>
					<b className="block text-[22px] tnum text-[var(--base-texto)]">{x.linhas}</b>
					<small className="text-[12px] text-[var(--base-texto-3)]">tocando no tronco ({canais} canais)</small>
					<Bolinhas total={x.linhas} acesas={x.linhas} rotulo={`${x.linhas} linhas discando`} />
				</div>
				<div className="rounded-xl border p-3" style={{ borderColor: 'var(--base-borda)' }}>
					<small className="text-[12px] text-[var(--base-texto-2)]">Atende uma pessoa</small>
					<b className="block text-[22px] text-[var(--base-texto)]">~12%</b>
					<small className="text-[12px] text-[var(--base-texto-3)]">o resto: não atende, caixa postal, ocupado</small>
				</div>
				<div className="rounded-xl border p-3" style={{ borderColor: 'var(--destaque)' }}>
					<small className="text-[12px] text-[var(--base-texto-2)]">Robôs conversando</small>
					<b className="block text-[22px] tnum text-[var(--base-texto)]">{x.conversando} de {robos}</b>
					<small className="text-[12px] text-[var(--base-texto-3)]">a licença conta só aqui</small>
					<Bolinhas total={robos} acesas={x.conversando} rotulo={`${x.conversando} de ${robos} robôs conversando`} />
				</div>
			</div>
			<p className="mt-2 text-[11.5px] text-[var(--base-texto-3)]">Exemplo ilustrativo (média de uma simulação com conversa de 90 s). O que acontece de verdade na sua carteira está na aba Ritmo e em Ligações.</p>
			{x.troncoSegura && (
				<div className="mt-3"><Aviso tom="atencao" titulo="O tronco segura o ritmo.">
					Para {robos} robôs no {m.nome} seriam {x.ideal} linhas, mas o tronco tem {canais} canais. Os robôs ficam parados esperando. Regra prática: <b>canais ≈ robôs × razão</b>.
				</Aviso></div>
			)}
		</Cartao>
	);
}

export function RobosPreditivo() {
	const { empresa } = useMotorAuth();
	const [modo, setModo] = useState<ModoIlustracao>('power1');
	const [d, setD] = useState<{ robos: number; canais: number } | null>(null);
	useEffect(() => {
		let vivo = true;
		void (async () => {
			if (!supabase || !empresa) return;
			const [l, dv] = await Promise.all([
				supabase.from('voz_licenca_vigente').select('robos').eq('empresa_id', empresa.id).maybeSingle(),
				supabase.from('voz_divisao_concorrencia').select('limite,canais').eq('empresa_id', empresa.id).maybeSingle(),
			]);
			if (!vivo) return;
			const lic = l.data ? Number((l.data as Row).robos ?? 0) : 0;
			const lim = dv.data ? Number((dv.data as Row).limite ?? 0) : 0;
			const canais = dv.data ? Number((dv.data as Row).canais ?? 0) : 0;
			setD({ robos: Math.max(0, lic > 0 ? Math.min(lic, lim || lic) : lim) || 10, canais: canais || 30 });
		})();
		return () => { vivo = false; };
	}, [empresa?.id]);
	return (
		<>
			<PageHeading title="Robôs e o Preditivo" description="A licença conta conversas com o robô, não linhas discando." />
			{!empresa ? <Notice variant="warning">Escolha a empresa no topo para ver esta página.</Notice> : (
				<div className="flex flex-col gap-4">
					<Cartao titulo="Em uma frase">
						<p className="text-[15px] leading-relaxed text-[var(--base-texto)]">Cada robô é <b>uma conversa ao mesmo tempo</b>. O discador pode ter <b>várias linhas tocando</b> para cada robô livre, porque a maioria das pessoas não atende. Linha tocando não gasta robô: só quem atende e fala com o agente ocupa um.</p>
					</Cartao>
					{d && <ExemploRobos robos={d.robos} canais={d.canais} modo={modo} onModo={setModo} />}
					<div className="grid gap-4 md:grid-cols-2">
						<Cartao titulo="Quando todos os robôs estão ocupados">
							<ul className="list-disc space-y-1 pl-5 text-[13px] text-[var(--base-texto-2)]">
								<li>O discador para de abrir linhas novas.</li>
								<li>Ninguém é desligado no meio da conversa.</li>
								<li>O lote continua quando um robô fica livre.</li>
							</ul>
						</Cartao>
						<Cartao titulo="E se alguém atender e não houver robô?">
							<p className="text-[13px] text-[var(--base-texto-2)]">Com 1 linha por robô (Power 1,0), isso não acontece: cada linha sai com o seu robô. Acima disso, o robô é reservado na hora em que a pessoa atende. Se não houver nenhum livre, ela ouve uma mensagem curta, sem falar de dívida; a próxima tentativa segue a Renitência da carteira (situação “Abandonada”), com robô reservado. O Preditivo mantém isso perto da meta (1%) e o teto de 3% vale para os dois modos.</p>
						</Cartao>
					</div>
					<p className="text-[13px]"><Link to="/voz/discagem" className="font-semibold text-[var(--destaque)] hover:underline">Escolher o ritmo de cada carteira na aba Ritmo da Discagem →</Link></p>
				</div>
			)}
		</>
	);
}
