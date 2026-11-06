// Painel de Empresa › Faturas montado direto do banco (RLS: `ve_faturamento`), sem a Edge Function.
// A função `cobranca` nunca teve a ação "painel" (só pagar, demonstrativo, nota e as do servidor): a tela chamava
// uma ação inexistente e ficava sempre em "Sem dados de faturamento". Aqui o mesmo formato que a tela já lê.
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Row } from '@/lib/supabase';

export type Painel = {
	modelo: 'pos' | 'pre';
	fatura_aberta: Row | null;
	faturas: Row[];
	saldo: Row | null;
	recargas: Row[];
	cartao: Row | null;
	recarga_automatica: boolean;
	aviso_saldo: number | null;
	recarga_minima: number | null;
	dados: { cnpj: string | null; email_financeiro: string | null; formas: string[] };
};

/** Situações que a tela mostra no cartão "fatura em aberto". */
const EM_ABERTO = new Set(['aberta', 'vencida', 'em_acordo']);
/** A tabela `recargas` usa 'pendente'; a tela, 'aguardando'. */
const SIT_RECARGA: Record<string, string> = { pendente: 'aguardando', paga: 'paga', cancelada: 'cancelada' };

/** Quem recebe as faturas: contatos com "Recebe faturas"; sem nenhum, os de papel Financeiro (`papel_contrato`). */
export function destinatariosFaturas(contatos: Row[]): string[] {
	const marcados = contatos.filter(r => r.recebe_faturas && r.email).map(r => String(r.email));
	return marcados.length > 0 ? marcados : contatos.filter(r => r.papel_contrato === 'financeiro' && r.email).map(r => String(r.email));
}

/** Junta as linhas lidas do banco no formato da tela (pura: testada sem rede). */
export function montarPainel(entrada: {
	ciclo: Row | null; empresa: Row | null; faturas: Row[]; itens: Row[]; notas: Row[];
	saldo: Row | null; recargas: Row[]; cartao: Row | null; contatos?: Row[];
}): Painel {
	const c = entrada.ciclo ?? {};
	const nota = new Map<string, Row>();
	for (const n of entrada.notas) {
		const chave = n.fatura_id != null ? `f:${n.fatura_id}` : n.recarga_id != null ? `r:${n.recarga_id}` : '';
		if (chave && (n.situacao === 'autorizada' || !nota.has(chave))) nota.set(chave, { numero: n.numero ?? null, link_pdf: n.link_pdf ?? null, situacao: n.situacao ?? null });
	}
	const itensPor = new Map<string, Row[]>();
	for (const i of [...entrada.itens].sort((a, b) => Number(a.ordem ?? 0) - Number(b.ordem ?? 0))) {
		const k = String(i.fatura_id);
		itensPor.set(k, [...(itensPor.get(k) ?? []), { nome: i.descricao || i.item, item: i.item, quantidade: i.quantidade, preco: i.preco, valor: i.valor }]);
	}
	const faturas = entrada.faturas
		.filter(f => f.situacao !== 'rascunho')
		.map((f): Row => ({
			...f,
			situacao: String(f.situacao_atual ?? f.situacao ?? ''),
			valor_total: Number(f.valor_total ?? 0),
			boleto_pdf: f.boleto_pdf ?? f.link_boleto ?? null,
			nota: nota.get(`f:${f.id}`) ?? (f.link_nota_fiscal ? { numero: null, link_pdf: f.link_nota_fiscal, situacao: 'autorizada' } : null),
			itens: itensPor.get(String(f.id)) ?? [],
		}))
		.sort((a, b) => String(b.competencia ?? '').localeCompare(String(a.competencia ?? '')));
	// mais antiga em aberto primeiro (é a que vence antes)
	const abertas = faturas.filter(f => EM_ABERTO.has(f.situacao)).sort((a, b) => String(a.vencimento ?? '').localeCompare(String(b.vencimento ?? '')));
	const fatura_aberta = abertas[0] ?? null;
	return {
		modelo: c.modelo_pagamento === 'pre' ? 'pre' : 'pos',
		fatura_aberta,
		faturas: faturas.filter(f => f !== fatura_aberta),
		saldo: entrada.saldo && entrada.saldo.pre_pago ? entrada.saldo : null,
		recargas: entrada.recargas.map(r => ({ ...r, situacao: SIT_RECARGA[String(r.situacao)] ?? r.situacao, nota: nota.get(`r:${r.id}`) ?? null })),
		cartao: entrada.cartao ? { bandeira: entrada.cartao.bandeira ?? null, final: entrada.cartao.final ?? null, validade: entrada.cartao.validade ?? null } : null,
		recarga_automatica: !!c.recarga_automatica,
		aviso_saldo: c.aviso_saldo != null ? Number(c.aviso_saldo) : null,
		recarga_minima: c.recarga_minima != null ? Number(c.recarga_minima) : null,
		dados: {
			cnpj: (entrada.empresa?.cnpj as string | null) ?? null,
			email_financeiro: destinatariosFaturas(entrada.contatos ?? [])[0] ?? null,
			formas: Array.isArray(c.formas) && c.formas.length ? (c.formas as string[]) : ['boleto', 'pix'],
		},
	};
}

/** Lê tudo com o JWT do usuário. Erro em leitura essencial (faturas/ciclo) lança; o resto vira vazio. */
export async function carregarPainel(sb: SupabaseClient, empresaId: string): Promise<Painel> {
	const [ciclo, emp, fat, rec, cart, cont] = await Promise.all([
		sb.from('ciclo_empresa').select('*').eq('empresa_id', empresaId).maybeSingle(),
		sb.from('empresas').select('cnpj').eq('id', empresaId).maybeSingle(),
		sb.from('faturas_painel').select('*').eq('empresa_id', empresaId).neq('situacao', 'rascunho').order('competencia', { ascending: false }).limit(60),
		sb.from('recargas').select('id,valor,forma,situacao,automatica,pedida_em,paga_em').eq('empresa_id', empresaId).order('pedida_em', { ascending: false }).limit(50),
		sb.from('cartoes_salvos').select('bandeira,final,validade').eq('empresa_id', empresaId).eq('padrao', true).maybeSingle(),
		sb.from('empresa_contatos').select('email,recebe_faturas,papel_contrato').eq('empresa_id', empresaId),
	]);
	if (fat.error) throw fat.error;
	if (ciclo.error) throw ciclo.error;
	const faturas = (fat.data ?? []) as Row[];
	const ids = faturas.map(f => f.id);
	const recargas = (rec.data ?? []) as Row[];
	const [itens, notas, saldo] = await Promise.all([
		ids.length ? sb.from('fatura_itens').select('fatura_id,ordem,item,descricao,quantidade,preco,valor').in('fatura_id', ids) : Promise.resolve({ data: [] as Row[] }),
		sb.from('notas_fiscais').select('fatura_id,recarga_id,numero,link_pdf,situacao').eq('empresa_id', empresaId),
		(ciclo.data as Row | null)?.modelo_pagamento === 'pre'
			? sb.rpc('saldo_empresa', { empresa: empresaId }).maybeSingle()
			: Promise.resolve({ data: null }),
	]);
	return montarPainel({
		ciclo: (ciclo.data as Row | null) ?? null,
		empresa: (emp.data as Row | null) ?? null,
		faturas,
		itens: ((itens as { data: unknown }).data ?? []) as Row[],
		notas: ((notas as { data: unknown }).data ?? []) as Row[],
		saldo: ((saldo as { data: unknown }).data ?? null) as Row | null,
		recargas,
		cartao: ((cart as { data: unknown }).data ?? null) as Row | null,
		contatos: ((cont as { data: unknown }).data ?? []) as Row[],
	});
}
