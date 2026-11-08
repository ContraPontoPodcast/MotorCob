// Créditos de IA (SQL 78; SPEC do Especialista telas 11 e 12). Peças do cliente: o contador ("Créditos de IA [barra]
// 87 de 100 no mês · excedente 0 · renova em 01/12"), o aviso da franquia (80% e 100%; nada bloqueia) e o hook que lê
// o ciclo de hoje. Só quantidade e o preço do excedente; nunca custo. O painel do Especialista e o "Descrever" (etapas
// 5 e 6) usam as mesmas peças; o rótulo dos botões vem de rotuloCreditos (lib/creditos-ia).
import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { Aviso } from '@/components/ds';
import { supabase } from '@/lib/supabase';
import {
	avisoCreditos, carregarResumoCreditos, fracaoCreditos, inteiroBR, nivelCreditos, diaMes,
	type DiaUso, type ResumoCreditos,
} from '@/lib/creditos-ia';

const COR: Record<string, { borda: string; barra: string }> = {
	ok: { borda: 'var(--base-borda)', barra: 'var(--destaque)' },
	atencao: { borda: 'var(--estado-atencao)', barra: 'var(--estado-atencao)' },
	excedente: { borda: 'var(--estado-erro)', barra: 'var(--estado-erro)' },
};

/** Contador do ciclo. `compacto`: só a pílula (cabeçalho do painel); senão, a mesma pílula com o texto inteiro. */
export function ContadorCreditosIA({ resumo, className = '' }: { resumo: ResumoCreditos; className?: string }) {
	const nivel = nivelCreditos(resumo);
	const cor = COR[nivel];
	const pct = Math.round(fracaoCreditos(resumo) * 100);
	return (
		<span role="status" data-creditos-nivel={nivel}
			aria-label={`Créditos de IA: ${resumo.usados} de ${resumo.franquia} no mês, excedente ${resumo.excedente}, renova em ${diaMes(resumo.renova_em)}`}
			className={`inline-flex max-w-full flex-wrap items-center gap-x-2 gap-y-1 rounded-xl bg-[var(--base-cartao)] px-3 py-1.5 text-[13px] text-[var(--base-texto-2)] ${className}`}
			style={{ boxShadow: `0 0 0 1.5px ${cor.borda}` }}>
			<span className="text-[var(--base-texto)]">Créditos de IA</span>
			<span aria-hidden="true" className="inline-block h-1.5 w-14 overflow-hidden rounded-full bg-[var(--base-fill)]">
				<span className="block h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: cor.barra }} />
			</span>
			<b className="font-semibold text-[var(--base-texto)] tnum">{inteiroBR(resumo.usados)} de {inteiroBR(resumo.franquia)}</b>
			<span className="tnum">no mês · excedente {inteiroBR(resumo.excedente)} · renova em {diaMes(resumo.renova_em)}</span>
		</span>
	);
}

/** Aviso de 80% / 100% (ou do teto). `linkUso`: botão "Ver o uso de IA" (tela 11). */
export function AvisoCreditosIA({ resumo, diaPico, linkUso }: { resumo: ResumoCreditos; diaPico?: DiaUso | null; linkUso?: boolean }) {
	const a = avisoCreditos(resumo, diaPico);
	if (!a) return null;
	return (
		<Aviso tom={a.tom} titulo={a.titulo || undefined}
			acao={linkUso ? <Link to="/empresa/uso-ia" className="inline-flex h-8 items-center rounded-lg px-3 text-[13px] font-medium text-[var(--base-texto)]" style={{ boxShadow: '0 0 0 1px var(--base-borda)' }}>Ver o uso de IA</Link> : undefined}>
			{a.texto}
		</Aviso>
	);
}

/** Ciclo de hoje da empresa (view ia_creditos_ciclo). `null` enquanto carrega, sem acesso ou banco sem o SQL 78. */
export function useCreditosIA(empresaId: number | string | null | undefined, recarregar = 0): ResumoCreditos | null {
	const [r, setR] = useState<ResumoCreditos | null>(null);
	useEffect(() => {
		if (!supabase || empresaId == null) { setR(null); return; }
		let ativo = true;
		void carregarResumoCreditos(supabase, empresaId).then(x => { if (ativo) setR(x); });
		return () => { ativo = false; };
	}, [empresaId, recarregar]);
	return r;
}
