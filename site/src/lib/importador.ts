// Importador das gravações do discador (SQL 64, supabase/migrations/20261231000001_voz_importador.sql): rótulos,
// validação das fontes (a mesma do banco) e a montagem do envio pelo site. Sem import de alias: este arquivo roda
// também no `node --test` (site/importador/importador.test.ts).
// LGPD: o nome original dos arquivos nunca vai ao banco nem ao caminho do bucket; só o sha-256 do nome (minúsculo).

/** Permissões (permissoes_catalogo): configurar as fontes (Admin) e enviar arquivos (Admin e Planejamento). */
export const PERM_IMPORT = { configurar: 'importar_gravacoes', enviar: 'enviar_arquivos' } as const;

export const BUCKET_ENVIO = 'gravacoes-discador';
export const MAX_ARQUIVO = 200 * 1024 * 1024;     // limite do bucket
export const MAX_ARQUIVOS = 2000;
export const EXT_AUDIO = ['wav', 'mp3', 'ogg', 'opus', 'flac', 'm4a'] as const;
export const EXT_MANIFESTO = ['csv', 'json'] as const;

export type Forma = 'arquivo' | 'sftp' | 'url';
export const FORMAS: { id: Forma; nome: string; desc: string }[] = [
	{ id: 'arquivo', nome: 'Envio pelo site', desc: 'Vocês enviam aqui o manifesto (CSV ou JSON) e os áudios, ou um zip com tudo. O MotorCX lê em até 15 minutos e apaga os arquivos do envio depois de importar.' },
	{ id: 'sftp', nome: 'SFTP do discador', desc: 'O MotorCX lê a pasta do discador com a chave pública do servidor fixada. A credencial fica no cofre; quem grava é a equipe MotorCX.' },
	{ id: 'url', nome: 'HTTPS (lista de URLs)', desc: 'Uma URL que devolve o manifesto com a URL de cada áudio. Só HTTPS e só nos domínios autorizados. Token, se houver, no cofre.' },
];
export const NOME_FORMA: Record<string, string> = { arquivo: 'Envio pelo site', sftp: 'SFTP', url: 'HTTPS', api: 'API própria (sob demanda)' };

/** Motivos da quarentena (voz_import_quarentena_motivo_check). */
export const MOTIVOS: Record<string, string> = {
	sem_par: 'Sem transferência do agente de IA que case',
	par_ambiguo: 'Mais de uma transferência possível: não casa no palpite',
	par_conflitante: 'Cliente do arquivo diferente do da transferência',
	chamada_com_gravacao: 'A chamada já tem outra gravação do discador',
	sem_cliente: 'Sem par e sem id_cliente',
	nome_com_dado_pessoal: 'Nome do arquivo com telefone ou CPF (nome descartado)',
	dado_pessoal: 'Linha com CPF, telefone ou e-mail (descartada)',
	campo_invalido: 'Campo obrigatório vazio ou fora do formato',
	carteira_desconhecida: 'Carteira que não é desta empresa',
	audio_ausente: 'Áudio citado no manifesto não encontrado',
	audio_invalido: 'Áudio corrompido ou de outro formato',
	formato: 'Formato de áudio não suportado',
	grande_demais: 'Áudio acima de 50 MB',
	url_nao_permitida: 'URL fora dos domínios autorizados ou sem HTTPS',
	download: 'Falha ao baixar o áudio',
	duplicada_no_arquivo: 'id_chamada repetido no mesmo manifesto',
	outro: 'Outro motivo',
};
export const motivoLabel = (m: string) => MOTIVOS[m] ?? m;

export const ORIGEM: Record<string, string> = { agendada: 'Leitura automática', pedido: 'Ler agora', envio: 'Envio pelo site' };

/** Modelo do manifesto (o mesmo que o importador aceita; voz/importador/manifesto.py). Dados fictícios. */
export const MODELO_MANIFESTO = [
	'id_chamada;inicio;duracao_s;arquivo;operador_ref;id_cliente;id_acao;carteira;id_chamada_motorcx',
	'88120-17;2026-11-19 10:01:05;93;88120-17.wav;OP-7;CLI-0001;A-1;cartao;0f8e2a1c1b2c4d3e8f9a01b2c3d4e5f6',
	'88121-02;2026-11-19 10:15:40;41;88121-02.mp3;OP-8;CLI-0002;;cartao;',
].join('\n') + '\n';

// ---------------------------------------------------------------- dado pessoal (a mesma regra do importador)
const CPF_FMT = /\d{3}\.\d{3}\.\d{3}-\d{2}/;
const EMAIL = /[^@\s]+@[^@\s]+\.[A-Za-z]{2,}/;
const FONE_FMT = /\(?\d{2}\)?[\s.-]?9?\d{4}[\s.-]\d{4}/;
export function temDadoPessoal(v: string): boolean {
	return CPF_FMT.test(v) || EMAIL.test(v) || FONE_FMT.test(v) || /\d{10,}/.test(v);
}

// ---------------------------------------------------------------- fonte (as mesmas regras dos checks do banco)
export type FonteDraft = {
	nome: string; adaptador: string; forma: Forma; host: string; porta: number; usuario: string; chave_host: string;
	pasta: string; url_lista: string; dominios: string; leitura_automatica: boolean; intervalo_horas: number;
	so_transferencias: boolean; janela_par_s: number; dias_busca: number; ativo: boolean;
};
export const FONTE_PADRAO: FonteDraft = {
	nome: '', adaptador: 'generico', forma: 'sftp', host: '', porta: 22, usuario: '', chave_host: '', pasta: '/', url_lista: '',
	dominios: '', leitura_automatica: false, intervalo_horas: 24, so_transferencias: true, janela_par_s: 120, dias_busca: 7, ativo: true,
};

const RE_HOST = /^[A-Za-z0-9][A-Za-z0-9.-]{1,252}$/;
const RE_INTERNO = /^(10|127|0)\.|^192\.168\.|^169\.254\.|^172\.(1[6-9]|2\d|3[01])\.|^localhost$|^metadata\.google\.internal$/i;
const RE_USUARIO = /^[A-Za-z0-9_.-]{1,64}$/;
const RE_CHAVE = /^(ssh-ed25519|ssh-rsa|ecdsa-sha2-nistp256|ecdsa-sha2-nistp384|ecdsa-sha2-nistp521) [A-Za-z0-9+/]{40,}={0,2}$/;
const RE_PASTA = /^[A-Za-z0-9_\-/.]{1,200}$/;
const RE_URL = /^https:\/\/[a-z0-9][a-z0-9.-]{1,252}(:\d{2,5})?(\/[A-Za-z0-9_\-./~%?=&+]*)?$/;
const RE_DOMINIO = /^[a-z0-9.-]{3,253}$/;

export function dominiosDe(texto: string): string[] {
	return [...new Set(texto.split(/[\s,;]+/).map(d => d.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '')).filter(Boolean))];
}

/** Erros da fonte (lista vazia = pode salvar). */
export function validarFonte(d: FonteDraft): string[] {
	const e: string[] = [];
	const nome = d.nome.trim();
	if (nome.length < 2 || nome.length > 60) e.push('Nome: de 2 a 60 caracteres.');
	else if (/\d{8,}/.test(nome) || nome.includes('@') || /[<>{}]/.test(nome)) e.push('Nome: sem telefone, CPF, e-mail ou < > { }.');
	if (d.forma === 'sftp') {
		const host = d.host.trim().toLowerCase();
		if (!RE_HOST.test(host) || host.includes('..')) e.push('Servidor SFTP inválido.');
		else if (RE_INTERNO.test(host)) e.push('Servidor em rede interna não é aceito.');
		if (!Number.isInteger(d.porta) || d.porta < 1 || d.porta > 65535) e.push('Porta de 1 a 65535.');
		if (!RE_USUARIO.test(d.usuario.trim()) || /\d{8,}/.test(d.usuario)) e.push('Usuário: letras, números, _ . - (até 64).');
		if (!RE_CHAVE.test(d.chave_host.trim()) || d.chave_host.trim().length > 1500) e.push('Chave pública do servidor: a linha "ssh-ed25519 AAAA…" (ssh-keyscan).');
		if (!RE_PASTA.test(d.pasta.trim()) || d.pasta.includes('..') || /\d{10,}/.test(d.pasta)) e.push('Pasta: caminho sem ".." nem número longo.');
	}
	if (d.forma === 'url') {
		const u = d.url_lista.trim();
		if (!RE_URL.test(u) || u.length > 500 || /\d{10,}/.test(u) || u.includes('@')) e.push('URL da lista: só HTTPS, sem usuário nem número longo.');
		const doms = dominiosDe(d.dominios);
		if (doms.some(x => !RE_DOMINIO.test(x))) e.push('Domínios autorizados: só nomes (ex.: gravacoes.discador.com.br).');
		if (doms.length > 9) e.push('Até 10 domínios autorizados.');
	}
	if (!Number.isInteger(d.intervalo_horas) || d.intervalo_horas < 1 || d.intervalo_horas > 24) e.push('Intervalo da leitura: de 1 a 24 horas.');
	if (!Number.isInteger(d.janela_par_s) || d.janela_par_s < 10 || d.janela_par_s > 900) e.push('Janela do par: de 10 a 900 segundos.');
	if (!Number.isInteger(d.dias_busca) || d.dias_busca < 1 || d.dias_busca > 30) e.push('Dias de busca: de 1 a 30.');
	return e;
}

/** O que vai para salvar_fonte_gravacoes (só os campos da forma; transcrição e credencial nunca daqui). */
export function dadosDaFonte(d: FonteDraft, nova: boolean): Record<string, unknown> {
	const base: Record<string, unknown> = {
		nome: d.nome.trim(), adaptador: d.adaptador, leitura_automatica: d.forma !== 'arquivo' && d.leitura_automatica,
		intervalo_horas: d.intervalo_horas, so_transferencias: d.so_transferencias, janela_par_s: d.janela_par_s,
		dias_busca: d.dias_busca, ativo: d.ativo,
	};
	if (nova) base.forma = d.forma;
	if (d.forma === 'sftp') Object.assign(base, { host: d.host.trim().toLowerCase(), porta: d.porta, usuario: d.usuario.trim(), chave_host: d.chave_host.trim(), pasta: d.pasta.trim() });
	if (d.forma === 'url') Object.assign(base, { url_lista: d.url_lista.trim(), dominios_url: dominiosDe(d.dominios) });
	return base;
}

// ---------------------------------------------------------------- envio pelo site
export type TipoArquivo = 'manifesto' | 'audio' | 'zip';
export function extensao(nome: string): string {
	const i = nome.lastIndexOf('.');
	return i < 0 ? '' : nome.slice(i + 1).toLowerCase();
}
export function tipoArquivo(nome: string): TipoArquivo | null {
	const x = extensao(nome);
	if ((EXT_AUDIO as readonly string[]).includes(x)) return 'audio';
	if ((EXT_MANIFESTO as readonly string[]).includes(x)) return 'manifesto';
	if (x === 'zip') return 'zip';
	return null;
}

export type ItemEnvio = { nome: string; tamanho: number; tipo: TipoArquivo | null; erro: string | null };
/** Confere a lista antes de subir: formatos, tamanho, repetidos e se há manifesto (ou zip). */
export function conferirEnvio(arquivos: { name: string; size: number }[]): { itens: ItemEnvio[]; erros: string[] } {
	const erros: string[] = [];
	const vistos = new Set<string>();
	const itens = arquivos.map(a => {
		const tipo = tipoArquivo(a.name);
		const chave = a.name.trim().toLowerCase();
		let erro: string | null = null;
		if (!tipo) erro = 'Formato não aceito (áudio wav, mp3, ogg, opus, flac, m4a; manifesto CSV ou JSON; zip).';
		else if (a.size <= 0) erro = 'Arquivo vazio.';
		else if (a.size > MAX_ARQUIVO) erro = 'Acima de 200 MB.';
		else if (vistos.has(chave)) erro = 'Nome repetido no envio.';
		vistos.add(chave);
		return { nome: a.name, tamanho: a.size, tipo, erro };
	});
	if (itens.length === 0) erros.push('Escolha os arquivos.');
	if (itens.length > MAX_ARQUIVOS) erros.push(`No máximo ${MAX_ARQUIVOS} arquivos por envio (use um zip).`);
	if (itens.length && !itens.some(i => i.tipo === 'manifesto' || i.tipo === 'zip')) erros.push('Falta o manifesto (CSV ou JSON) ou um zip com ele.');
	if (itens.some(i => i.erro)) erros.push('Tire os arquivos marcados para enviar.');
	return { itens, erros };
}

/** Caminho no bucket: <slug>/<lote>/<n>.<ext> (o nome original nunca vai ao Storage). */
export function caminhoEnvio(slug: string, lote: string, indice: number, nome: string): string {
	return `${slug}/${lote}/${indice}.${extensao(nome)}`;
}

/** sha-256 (hex) do nome do arquivo em minúsculo: casa com a coluna arquivo do manifesto no importador. */
export async function hashNome(nome: string): Promise<string> {
	const base = nome.replace(/\\/g, '/').split('/').pop()!.trim().toLowerCase();
	const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(base));
	return [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join('');
}

export const TIPO_CONTEUDO: Record<string, string> = {
	wav: 'audio/wav', mp3: 'audio/mpeg', ogg: 'audio/ogg', opus: 'audio/ogg', flac: 'audio/flac', m4a: 'audio/mp4',
	csv: 'text/csv', json: 'application/json', zip: 'application/zip',
};

// ---------------------------------------------------------------- registro
export type Execucao = {
	id: number; config_id: number; origem: string; iniciada_em: string; terminada_em: string | null; arquivos: number; lidas: number;
	importadas: number; casadas: number; duplicadas: number; quarentena: number; sem_operador: number; minutos: number; erro: string | null;
};
export function situacaoExecucao(e: Pick<Execucao, 'terminada_em' | 'erro' | 'quarentena' | 'importadas'>): { tom: 'ok' | 'atencao' | 'erro' | 'info'; txt: string } {
	if (!e.terminada_em) return { tom: 'info', txt: 'Lendo' };
	if (e.erro) return { tom: 'erro', txt: 'Erro' };
	if (e.quarentena > 0) return { tom: 'atencao', txt: 'Com recusas' };
	return { tom: 'ok', txt: 'Ok' };
}

/** "3 sem par · 1 dado pessoal" (os maiores primeiro). */
export function resumoMotivos(m: Record<string, number> | null | undefined, max = 3): string {
	const lista = Object.entries(m ?? {}).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]);
	const txt = lista.slice(0, max).map(([k, n]) => `${n.toLocaleString('pt-BR')} ${motivoLabel(k).toLowerCase()}`);
	return txt.join(' · ') + (lista.length > max ? ` · +${lista.length - max}` : '');
}
