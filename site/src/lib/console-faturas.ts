// Console › Faturamento: regras pequenas separadas da tela (testadas em console-faturas.test.tsx).
import type { Row } from '@/lib/supabase';

/** A view `faturas_painel` só tem `empresa_id`: junta o nome e a situação da empresa e ordena pelo nome. */
export function comNomeDaEmpresa(faturas: Row[], empresas: Row[]): Row[] {
	const por = new Map(empresas.map(e => [String(e.id), e]));
	return faturas
		.map(f => {
			const e = por.get(String(f.empresa_id));
			return { ...f, empresa: e?.nome ?? f.empresa ?? null, empresa_situacao: e?.situacao ?? f.empresa_situacao ?? null };
		})
		.sort((a, b) => String(a.empresa ?? '').localeCompare(String(b.empresa ?? ''), 'pt-BR'));
}

/** Retorno de `gerar_rascunhos` (quantos gerou) → frase da tela. Nunca diz "gerados" quando não gerou nenhum. */
export function mensagemRascunhos(n: number): string {
	if (!Number.isFinite(n) || n <= 0) {
		return 'Nenhum rascunho novo: as faturas deste ciclo já existem ou o ciclo ainda não terminou (o rascunho sai no dia seguinte ao fim do ciclo).';
	}
	return n === 1 ? '1 rascunho gerado para o ciclo.' : `${n} rascunhos gerados para o ciclo.`;
}

/** `resumo_emissao.sem_contato` é text[] (nomes das empresas sem e-mail de fatura). */
export function listaSemContato(v: unknown): string[] {
	if (Array.isArray(v)) return v.map(String).filter(Boolean);
	if (typeof v === 'string' && v.trim()) return [v.trim()];
	return [];
}
