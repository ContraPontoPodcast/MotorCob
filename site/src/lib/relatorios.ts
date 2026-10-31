// Tipos e helpers da área de Relatórios.
// Nenhuma tabela/view/política é criada ou alterada — tudo já existe no banco.
// As RPCs (rodar_relatorio, contar_relatorio, pedir_exportacao,
// salvar_envio_relatorio, apagar_envio_relatorio) e as tabelas
// (relatorio_bases, relatorio_campos, relatorios_modelos, relatorio_envios,
// relatorio_exportacoes, empresa_modulos, empresa_score) são lidas pelo Supabase.

export type ProdutoRelatorio = 'mensageria' | 'orquestracao' | 'jornada';

export const PRODUTO_REL_LABEL: Record<ProdutoRelatorio, string> = {
	mensageria: 'Mensageria',
	orquestracao: 'Orquestração',
	jornada: 'Jornada',
};

export type RelatorioBase = {
	id: string;
	nome: string;
	descricao: string | null;
	produto: string;
	ordem: number;
	visivel: boolean;
	foto_do_dia: boolean | null;
};

export type RelatorioCampo = {
	id: string;
	base: string;
	nome: string;
	rotulo: string;
	tipo: string;
	ordem: number;
	agrupavel: boolean;
	filtravel: boolean;
};

export type Metrica = {
	funcao: string; // contar | distinto | somar | media | min | max | taxa
	campo: string | null;
	nome: string;
	rotulo?: string | null;
	sentido?: string | null; // maior_melhor | menor_melhor
	divisor?: string | null; // para taxa: campo do divisor
};

export type ModeloRelatorio = {
	id: string;
	nome: string;
	descricao: string | null;
	categoria: string | null;
	base: string;
	colunas: string[] | null;
	agrupar: string[] | null;
	metricas: Metrica[] | null;
	ordem: string | null;
	empresa_id: string | null;
	requer: string | null;
	destaque: boolean | null;
	criado_por: string | null;
};

export type EnvioRelatorio = {
	id: string;
	modelo: string;
	frequencia: string; // dia | semana | mes
	destinatarios: string[];
	dia_semana: number | null;
	dia_mes: number | null;
	hora: number;
	ultimo_erro: string | null;
	proximo_envio: string | null;
};

export type Exportacao = {
	id: string;
	nome: string;
	linhas: number | null;
	linhas_feitas: number | null;
	linhas_total: number | null;
	situacao: string; // pendente | processando | pronto | erro
	arquivo_url: string | null;
	expira_em: string | null;
	criado_em: string | null;
};

/** Opções de período (padrão: 7 dias). */
export const PERIODO_REL = [
	{ id: 'hoje', label: 'Hoje' },
	{ id: '7d', label: 'Últimos 7 dias' },
	{ id: '30d', label: 'Últimos 30 dias' },
	{ id: 'mes_atual', label: 'Este mês' },
	{ id: 'mes_anterior', label: 'Mês passado' },
	{ id: 'personalizado', label: 'Escolher datas' },
];

const fmtIso = (d: Date) =>
	new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);

/** Calcula o intervalo de datas (ISO AAAA-MM-DD) de um período. */
export function periodoDatas(periodo: string, customDe?: string, customAte?: string): { de: string; ate: string } {
	const hoje = new Date();
	const ate = fmtIso(hoje);
	let de = ate;
	switch (periodo) {
		case '7d': { const d = new Date(hoje); d.setDate(d.getDate() - 6); de = fmtIso(d); break; }
		case '30d': { const d = new Date(hoje); d.setDate(d.getDate() - 29); de = fmtIso(d); break; }
		case 'mes_atual': { de = fmtIso(new Date(hoje.getFullYear(), hoje.getMonth(), 1)); break; }
		case 'mes_anterior': {
			const ini = new Date(hoje.getFullYear(), hoje.getMonth() - 1, 1);
			const fim = new Date(hoje.getFullYear(), hoje.getMonth(), 0);
			return { de: fmtIso(ini), ate: fmtIso(fim) };
		}
		case 'personalizado': return { de: customDe ?? ate, ate: customAte ?? ate };
		default: de = ate; // hoje
	}
	return { de, ate };
}

/** Período anterior de mesmo tamanho, logo antes (para "Comparar com"). */
export function periodoAnterior(de: string, ate: string): { de: string; ate: string } {
	const d1 = new Date(de + 'T00:00:00');
	const d2 = new Date(ate + 'T00:00:00');
	if (isNaN(d1.getTime()) || isNaN(d2.getTime())) return { de, ate };
	const dias = Math.round((d2.getTime() - d1.getTime()) / 86400000) + 1;
	const novoAte = new Date(d1);
	novoAte.setDate(novoAte.getDate() - 1);
	const novoDe = new Date(novoAte);
	novoDe.setDate(novoDe.getDate() - (dias - 1));
	return { de: fmtIso(novoDe), ate: fmtIso(novoAte) };
}

/** Formata um valor conforme o tipo do campo / métrica. */
export function formatValor(v: unknown, tipo?: string): string {
	if (v == null || v === '') return '—';
	if (tipo === 'booleano') return v === true || v === 't' || v === 'true' ? 'Sim' : 'Não';
	if (tipo === 'data') {
		const s = String(v);
		if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
			return s.slice(8, 10) + '/' + s.slice(5, 7) + '/' + s.slice(0, 4);
		}
		return s;
	}
	if (tipo === 'moeda') return Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2, maximumFractionDigits: 2 });
	if (tipo === 'taxa') return Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + '%';
	if (tipo === 'razao') return Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
	if (tipo === 'numero' || typeof v === 'number') return Number(v).toLocaleString('pt-BR');
	return String(v);
}

/** Diz se uma base tem campo de data (habilita agrupar por Semana/Mês). */
export function baseTemData(campos: RelatorioCampo[]): boolean {
	return campos.some(c => c.tipo === 'data' || c.nome === 'data' || c.nome === 'dia');
}

/** Métricas prontas por base (funcao, campo=num, divisor=den, nome, rotulo, sentido). */
export const METRICAS_PRESET: Record<string, Metrica[]> = {
	funil: [
		{ funcao: 'taxa', campo: 'entregues', divisor: 'enviados', nome: 'taxa_entrega', rotulo: 'Taxa de entrega', sentido: 'maior_melhor' },
		{ funcao: 'somar', campo: 'nao_entregues', nome: 'nao_entregues', rotulo: 'Não entregues', sentido: 'menor_melhor' },
		{ funcao: 'taxa', campo: 'nao_entregues', divisor: 'enviados', nome: 'taxa_nao_entrega', rotulo: 'Taxa de não entrega', sentido: 'menor_melhor' },
		{ funcao: 'taxa', campo: 'respostas', divisor: 'entregues', nome: 'taxa_resposta', rotulo: 'Taxa de resposta', sentido: 'maior_melhor' },
		{ funcao: 'taxa', campo: 'descadastros', divisor: 'entregues', nome: 'taxa_descadastro', rotulo: 'Taxa de descadastro', sentido: 'menor_melhor' },
		{ funcao: 'taxa', campo: 'cliques', divisor: 'entregues', nome: 'taxa_clique', rotulo: 'Taxa de clique', sentido: 'maior_melhor' },
	],
	email: [
		{ funcao: 'taxa', campo: 'bounce_permanente', divisor: 'enviados', nome: 'taxa_bounce_perm', rotulo: 'Taxa de bounce permanente', sentido: 'menor_melhor' },
		{ funcao: 'taxa', campo: 'bounce_temporario', divisor: 'enviados', nome: 'taxa_bounce_temp', rotulo: 'Taxa de bounce temporário', sentido: 'menor_melhor' },
		{ funcao: 'taxa', campo: 'aberturas', divisor: 'entregues', nome: 'taxa_abertura', rotulo: 'Taxa de abertura', sentido: 'maior_melhor' },
	],
	mensagens: [
		{ funcao: 'somar', campo: 'enviada', nome: 'enviadas', rotulo: 'Enviadas' },
		{ funcao: 'taxa', campo: 'entregue', divisor: 'enviada', nome: 'taxa_entrega', rotulo: 'Taxa de entrega', sentido: 'maior_melhor' },
		{ funcao: 'taxa', campo: 'nao_entregue', divisor: 'enviada', nome: 'taxa_nao_entrega', rotulo: 'Taxa de não entrega', sentido: 'menor_melhor' },
		{ funcao: 'distinto', campo: 'id_cliente', nome: 'pessoas_diferentes', rotulo: 'Pessoas diferentes' },
	],
	acoes_regua: [
		{ funcao: 'taxa', campo: 'com_retorno', divisor: 'acionamentos', nome: 'taxa_retorno', rotulo: 'Taxa de retorno', sentido: 'maior_melhor' },
		{ funcao: 'taxa', campo: 'cpcs', divisor: 'acionamentos', nome: 'taxa_cpc', rotulo: 'Taxa de CPC', sentido: 'maior_melhor' },
		{ funcao: 'razao', campo: 'custo', divisor: 'cpcs', nome: 'custo_por_cpc', rotulo: 'Custo por CPC', sentido: 'menor_melhor' },
		{ funcao: 'razao', campo: 'acoes_ate_primeiro_cpc', divisor: 'primeiros_cpc', nome: 'acoes_ate_primeiro_cpc', rotulo: 'Ações até o 1º CPC', sentido: 'menor_melhor' },
	],
};

/** Métricas pré-selecionadas por base (chaves 'preset:<nome>'). */
export function metricasPreSelecionadas(baseId: string): Set<string> {
	const s = new Set<string>();
	if (baseId === 'funil') {
		const pre = METRICAS_PRESET.funil;
		const ne = pre.find(m => m.nome === 'nao_entregues');
		const tne = pre.find(m => m.nome === 'taxa_nao_entrega');
		if (ne) s.add('preset:' + ne.nome);
		if (tne) s.add('preset:' + tne.nome);
	}
	return s;
}

/** Rótulo legível de uma métrica (rotulo > nome). */
export function metricaRotulo(m: Metrica): string {
	return m.rotulo || m.nome || m.funcao;
}

/** Variação entre dois valores: texto + cor (verde/vermelho/cinza) pelo sentido. */
export function variacao(atual: number, anterior: number, sentido?: string | null, ehTaxa = false): { texto: string; cor: string } {
	if (!anterior && anterior !== 0) return { texto: '', cor: '#8E8E93' };
	const diff = atual - anterior;
	if (ehTaxa) {
		// variação em pontos
		const pts = diff;
		const sinal = pts > 0 ? '+' : pts < 0 ? '−' : '';
		const texto = `${sinal}${Math.abs(pts).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} ponto${Math.abs(pts) >= 2 ? 's' : ''}`;
		return { texto, cor: corVariacao(diff, sentido) };
	}
	if (!anterior) return { texto: '', cor: '#8E8E93' };
	const pctV = (diff / anterior) * 100;
	const sinal = pctV > 0 ? '+' : pctV < 0 ? '−' : '';
	const texto = `${sinal}${Math.abs(pctV).toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}%`;
	return { texto, cor: corVariacao(diff, sentido) };
}

function corVariacao(diff: number, sentido?: string | null): string {
	if (!sentido) return '#8E8E93';
	if (Math.abs(diff) < 1e-9) return '#8E8E93';
	const bom = sentido === 'menor_melhor' ? diff < 0 : diff > 0;
	return bom ? '#248A3D' : '#FF3B30';
}

/** Monta o objeto filtros para a RPC rodar_relatorio. */
export function montarFiltros(empresaId: string, de?: string, ate?: string, campos: { campo: string; op?: string; valor: string | string[] }[] = []): Record<string, unknown> {
	const c: Record<string, unknown>[] = [{ campo: 'empresa', op: 'igual', valor: empresaId }];
	if (de) c.push({ campo: 'data', op: 'maior', valor: de });
	if (ate) c.push({ campo: 'data', op: 'menor', valor: ate });
	for (const f of campos) {
		const op = f.op ?? 'igual';
		if (op === 'vazio' || op === 'preenchido') c.push({ campo: f.campo, op, valor: null });
		else if (f.valor !== '' && f.valor != null) c.push({ campo: f.campo, op, valor: f.valor });
	}
	return { campos: c };
}

/** Descrição curta do envio por e-mail de um relatório. */
export function envioDescricao(e: EnvioRelatorio): string {
	const h = String(e.hora ?? 8).padStart(2, '0') + 'h';
	if (e.frequencia === 'dia') return `Todo dia, ${h}`;
	if (e.frequencia === 'semana') {
		const dias = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
		return `Toda ${dias[e.dia_semana ?? 1]}, ${h}`;
	}
	if (e.frequencia === 'mes') return `Dia ${e.dia_mes ?? 1}, ${h}`;
	return 'Não';
}

/** Rótulo da situação de uma exportação. */
export function exportacaoSituacao(s: string): { label: string; cor: string } {
	switch (s) {
		case 'pronto': return { label: 'Pronto', cor: '#248A3D' };
		case 'processando': return { label: 'Processando', cor: '#0A60D0' };
		case 'erro': return { label: 'Erro', cor: '#FF3B30' };
		default: return { label: 'Na fila', cor: '#8E8E93' };
	}
}

/** Detecta o produto ativo pela aba ou query. */
/** Produto que a tela de Relatórios abre: o do ?produto= (se contratado); sem ele, Cobrança, depois Jornada,
 *  depois Mensageria, conforme o que a empresa contratou (áreas liberadas, a mesma regra do menu). */
export function produtoAtivo(query: string | null, contratado: Record<ProdutoRelatorio, boolean>): ProdutoRelatorio | null {
	if ((query === 'orquestracao' || query === 'jornada' || query === 'mensageria') && contratado[query]) return query;
	if (contratado.orquestracao) return 'orquestracao';
	if (contratado.jornada) return 'jornada';
	if (contratado.mensageria) return 'mensageria';
	return null;
}
