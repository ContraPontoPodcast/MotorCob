// Empresa › Uso de IA (SQL 78; SPEC do Especialista, tela 12 aprovada). Créditos de IA no ciclo da empresa: o
// contador, 3 KPIs (ciclo, excedente, projeção no ritmo dos últimos 7 dias), o aviso de 80%/100%, a tabela por função
// (créditos por uso × usos), o uso por dia e "Na fatura" (franquia incluída; "Créditos de IA excedentes · N × R$ X").
// Só quantidade e o preço do excedente: o custo da IA nunca aparece aqui. Lê uso_ia_empresa (quem vê a empresa).
import { useEffect, useState } from 'react';
import { Cartao, Estado, Kpis, Tabela } from '@/components/ds';
import { ErrorDetail } from '@/components/error-detail';
import { useMotorAuth } from '@/components/auth-provider';
import { AvisoCreditosIA, ContadorCreditosIA } from '@/components/ia/creditos-ia';
import { supabase, friendlyError } from '@/lib/supabase';
import {
	carregarUsoIA, diaDePico, diaMes, inteiroBR, nivelCreditos, precoCredito, textoProjecao, type GrupoUso, type UsoIA,
} from '@/lib/creditos-ia';
import { EmpresaShell } from './empresa-shell';

export function UsoIAPage() {
	const { empresa } = useMotorAuth();
	const [uso, setUso] = useState<UsoIA | null>(null);
	const [erro, setErro] = useState('');

	useEffect(() => {
		if (!supabase || !empresa) return;
		let ativo = true;
		setUso(null); setErro('');
		carregarUsoIA(supabase, empresa.id)
			.then(u => { if (ativo) setUso(u); })
			.catch(e => { if (ativo) setErro(friendlyError(e)); });
		return () => { ativo = false; };
	}, [empresa?.id]);

	return (
		<EmpresaShell>
			{erro ? <Estado tipo="erro" titulo="Não deu para carregar o uso de IA.">{erro}<ErrorDetail /></Estado>
				: !uso ? <Estado tipo="carregando" />
				: <PainelUsoIA uso={uso} />}
		</EmpresaShell>
	);
}

export function PainelUsoIA({ uso }: { uso: UsoIA }) {
	const proj = textoProjecao(uso);
	const pico = diaDePico(uso.por_dia);
	const maxDia = Math.max(1, ...uso.por_dia.map(d => d.creditos));
	const nivel = nivelCreditos(uso);
	const total = uso.por_funcao.reduce((t, g) => t + g.creditos, 0);
	return (
		<div className="space-y-4" data-uso-ia="">
			<div>
				<h2 className="text-[22px] font-bold tracking-tight text-[var(--base-texto)]">Uso de IA</h2>
				<div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-2 text-[13.5px] text-[var(--base-texto-2)]">
					<span>Créditos de IA da empresa no ciclo, por função e por dia.</span>
					<ContadorCreditosIA resumo={uso} />
				</div>
			</div>

			<Kpis itens={[
				{ rotulo: `CICLO ${diaMes(uso.inicio)} A ${diaMes(uso.fim)}`, valor: `${inteiroBR(uso.usados)} de ${inteiroBR(uso.franquia)}`, detalhe: `créditos da franquia · renova em ${diaMes(uso.renova_em)}`, tom: nivel === 'excedente' ? 'alerta' : nivel === 'atencao' ? 'atencao' : undefined },
				{ rotulo: 'EXCEDENTE NO CICLO', valor: inteiroBR(uso.excedente), detalhe: `cada crédito acima de ${inteiroBR(uso.franquia)}: ${precoCredito(uso.preco_excedente)}` },
				uso.atual ? { rotulo: 'PROJEÇÃO DO CICLO', valor: proj.valor, detalhe: proj.detalhe } : null,
			]} />

			<AvisoCreditosIA resumo={uso} diaPico={pico} />

			<Cartao semPadding>
				<Tabela<GrupoUso> rotulo="Uso de IA por função" linhas={uso.por_funcao} chave={g => g.grupo}
					colunas={[
						{ id: 'funcao', titulo: 'Função', celula: g => g.grupo },
						{ id: 'peso', titulo: 'Créditos por uso', num: true, celula: g => <span className="tnum">{g.creditos_por_uso}</span> },
						{ id: 'usos', titulo: 'Usos', num: true, celula: g => <span className="tnum">{inteiroBR(g.usos)}</span> },
						{ id: 'creditos', titulo: 'Créditos', num: true, celula: g => <b className="font-semibold tnum">{inteiroBR(g.creditos)}</b> },
					]}
					celular={g => ({ titulo: g.grupo, valor: <b className="font-semibold tnum">{inteiroBR(g.creditos)}</b>, resumo: `${g.creditos_por_uso} por uso × ${inteiroBR(g.usos)} ${g.usos === 1 ? 'uso' : 'usos'}` })}
					rodape={<><b className="font-semibold text-[var(--base-texto)]">Total</b><b className="font-semibold tnum text-[var(--base-texto)]">{inteiroBR(total)}</b></>} />
			</Cartao>

			<div className="grid gap-4 lg:grid-cols-[1.5fr_1fr]">
				<Cartao titulo="Por dia">
					<ul className="space-y-1.5" aria-label="Créditos por dia">
						{uso.por_dia.map(d => (
							<li key={d.dia} className="grid grid-cols-[84px_1fr_36px] items-center gap-3 text-[13px] text-[var(--base-texto)]">
								<span className="tnum">{diaMes(d.dia)}{d.dia === uso.hoje ? ' (hoje)' : ''}</span>
								<span aria-hidden="true" className="h-2.5 overflow-hidden rounded-full bg-[var(--base-fill)]">
									<span className="block h-full rounded-full bg-[var(--destaque)]" style={{ width: `${Math.round((d.creditos / maxDia) * 100)}%` }} />
								</span>
								<span className="text-right tnum">{inteiroBR(d.creditos)}</span>
							</li>
						))}
					</ul>
				</Cartao>
				<Cartao titulo="Na fatura">
					<dl className="divide-y text-[13.5px] [&>*]:border-[var(--base-borda)]">
						<div className="flex items-start justify-between gap-3 py-2.5">
							<dt className="text-[var(--base-texto)]">Créditos de IA (franquia de {inteiroBR(uso.franquia)}, incluída no contrato)</dt>
							<dd className="shrink-0 text-[var(--base-texto)]">incluído</dd>
						</div>
						<div className="flex items-start justify-between gap-3 py-2.5">
							<dt className="text-[var(--base-texto)]">Créditos de IA excedentes · {inteiroBR(uso.excedente)} × {precoCredito(uso.preco_excedente)}</dt>
							<dd className="shrink-0 tnum text-[var(--base-texto)]">{precoCredito(uso.valor_excedente)}</dd>
						</div>
					</dl>
					<p className="mt-3 text-[12.5px] leading-relaxed text-[var(--base-texto-2)]">
						Aqui aparece só quantidade e o preço do excedente. O custo da IA para a MotorCX não aparece.
						{uso.teto != null ? ` Limite da empresa: ${inteiroBR(uso.teto)} créditos por ciclo.` : ''} Para mudar a franquia ou pôr um teto, fale com o suporte.
					</p>
				</Cartao>
			</div>
		</div>
	);
}
