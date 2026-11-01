// Regras do importador de gravações no site (src/lib/importador.ts): as mesmas do banco (SQL 64) e do importador.
// node --experimental-strip-types --test site/importador/importador.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { FONTE_PADRAO, MODELO_MANIFESTO, caminhoEnvio, conferirEnvio, dadosDaFonte, dominiosDe, hashNome, motivoLabel, resumoMotivos, situacaoExecucao, temDadoPessoal, tipoArquivo, validarFonte, type FonteDraft } from '../src/lib/importador.ts';

const SFTP: FonteDraft = { ...FONTE_PADRAO, nome: 'SFTP do discador', forma: 'sftp', host: 'sftp.discador.exemplo.com.br', usuario: 'motorcx', chave_host: `ssh-ed25519 ${'A'.repeat(68)}`, pasta: '/gravacoes' };

test('fonte SFTP válida e as recusas do banco', () => {
	assert.deepEqual(validarFonte(SFTP), []);
	assert.match(validarFonte({ ...SFTP, host: '10.0.0.8' }).join(), /rede interna/);
	assert.match(validarFonte({ ...SFTP, host: '169.254.169.254' }).join(), /rede interna/);
	assert.match(validarFonte({ ...SFTP, chave_host: 'AAAA' }).join(), /Chave pública/);
	assert.match(validarFonte({ ...SFTP, pasta: '/x/../y' }).join(), /Pasta/);
	assert.match(validarFonte({ ...SFTP, nome: 'Fonte 11987654321' }).join(), /Nome/);
	assert.match(validarFonte({ ...SFTP, janela_par_s: 5 }).join(), /Janela/);
});

test('fonte HTTPS: só TLS e domínios em lista', () => {
	const url: FonteDraft = { ...FONTE_PADRAO, nome: 'Lista HTTPS', forma: 'url', url_lista: 'https://api.discador.exemplo.com.br/gravacoes', dominios: 'gravacoes.discador.exemplo.com.br, https://cdn.exemplo.com/x' };
	assert.deepEqual(validarFonte(url), []);
	assert.deepEqual(dominiosDe(url.dominios), ['gravacoes.discador.exemplo.com.br', 'cdn.exemplo.com']);
	assert.match(validarFonte({ ...url, url_lista: 'http://api.exemplo.com/x' }).join(), /só HTTPS/);
	assert.match(validarFonte({ ...url, url_lista: 'https://user@api.exemplo.com/x' }).join(), /só HTTPS/);
	const d = dadosDaFonte(url, true);
	assert.equal(d.forma, 'url');
	assert.deepEqual(d.dominios_url, ['gravacoes.discador.exemplo.com.br', 'cdn.exemplo.com']);
	assert.equal('host' in d, false);
	assert.equal('transcrever' in d || 'segredo_ref' in d, false);           // nunca pelo cliente
	assert.equal('forma' in dadosDaFonte(url, false), false);
});

test('envio: tipos, tamanho, repetidos e manifesto obrigatório', () => {
	assert.equal(tipoArquivo('A.WAV'), 'audio');
	assert.equal(tipoArquivo('indice.csv'), 'manifesto');
	assert.equal(tipoArquivo('lote.zip'), 'zip');
	assert.equal(tipoArquivo('x.gsm'), null);
	const r = conferirEnvio([{ name: 'a.wav', size: 10 }, { name: 'A.wav', size: 10 }, { name: 'x.gsm', size: 1 }]);
	assert.ok(r.erros.some(e => /manifesto/.test(e)));
	assert.equal(r.itens[1].erro, 'Nome repetido no envio.');
	assert.ok(r.itens[2].erro);
	assert.deepEqual(conferirEnvio([{ name: 'indice.csv', size: 10 }, { name: 'a.wav', size: 10 }]).erros, []);
	assert.equal(conferirEnvio([{ name: 'a.zip', size: 300 * 1024 * 1024 }]).itens[0].erro, 'Acima de 200 MB.');
});

test('caminho no bucket sem o nome original e hash igual ao do importador', async () => {
	assert.equal(caminhoEnvio('alfa', '0f8e2a1c-1b2c-4d3e-8f9a-0123456789ab', 3, 'Gravação 11987654321.WAV'), 'alfa/0f8e2a1c-1b2c-4d3e-8f9a-0123456789ab/3.wav');
	// voz/importador/fontes.py › hash_nome: sha-256 do nome (só o nome, minúsculo)
	assert.equal(await hashNome('pasta\\Op Sete.WAV'), createHash('sha256').update('op sete.wav').digest('hex'));
});

test('dado pessoal, motivos e situação da execução', () => {
	for (const v of ['123.456.789-09', '(11) 98765-4321', '11987654321', 'a@b.com']) assert.equal(temDadoPessoal(v), true, v);
	for (const v of ['OP-7', 'CLI-0001', '88120-17']) assert.equal(temDadoPessoal(v), false, v);
	assert.equal(motivoLabel('sem_par'), 'Sem transferência do agente de IA que case');
	assert.equal(motivoLabel('novo'), 'novo');
	assert.equal(resumoMotivos({ sem_par: 3, dado_pessoal: 1, formato: 0 }), '3 sem transferência do agente de ia que case · 1 linha com cpf, telefone ou e-mail (descartada)');
	assert.deepEqual(situacaoExecucao({ terminada_em: null, erro: null, quarentena: 0, importadas: 0 }), { tom: 'info', txt: 'Lendo' });
	assert.equal(situacaoExecucao({ terminada_em: 'x', erro: 'falhou', quarentena: 0, importadas: 0 }).tom, 'erro');
	assert.equal(situacaoExecucao({ terminada_em: 'x', erro: null, quarentena: 2, importadas: 1 }).tom, 'atencao');
});

test('modelo do manifesto sem dado pessoal e com as colunas do importador', () => {
	const [cab, ...linhas] = MODELO_MANIFESTO.trim().split('\n');
	assert.equal(cab, 'id_chamada;inicio;duracao_s;arquivo;operador_ref;id_cliente;id_acao;carteira;id_chamada_motorcx');
	for (const l of linhas) for (const c of l.split(';').slice(3, 8)) assert.equal(temDadoPessoal(c), false, c);
});
