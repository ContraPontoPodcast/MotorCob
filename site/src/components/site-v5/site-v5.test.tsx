// Testes do site público v5 (npm test): links internos apontam para as rotas do site (nada de *.html do
// protótipo nem rotas do app), a demonstração tem os campos e o aviso aprovados, e o texto que vai para
// contatos_site.mensagem junta as respostas da carteira.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router';
import { PaginaHome } from './paginas/home';
import { PaginaComoDecide } from './paginas/como-decide';
import { PaginaCobranca } from './paginas/cobranca';
import { PaginaVoz } from './paginas/voz';
import { PaginaSpeech } from './paginas/speech-analytics';
import { PaginaSeguranca } from './paginas/seguranca';
import { PaginaDemonstracao, mensagemDaCarteira, origemDe } from './paginas/demonstracao';

const html = (n: ReactNode, url = '/') => renderToStaticMarkup(<MemoryRouter initialEntries={[url]}>{n}</MemoryRouter>);
const ROTAS_DO_SITE = ['/', '/como-decide', '/solucoes/cobranca', '/solucoes/voz', '/solucoes/speech-analytics', '/seguranca', '/demonstracao', '/login', '/privacidade'];

test('os links internos das páginas vão para as rotas públicas do site', () => {
	for (const pagina of [<PaginaHome key="h" />, <PaginaComoDecide key="c" />, <PaginaCobranca key="b" />, <PaginaVoz key="v" />, <PaginaSpeech key="s" />, <PaginaSeguranca key="g" />]) {
		const s = html(pagina);
		assert.ok(!/\.html/.test(s), 'sobrou link do protótipo');
		for (const [, href] of s.matchAll(/href="([^"#][^"]*)"/g)) {
			const caminho = href.split(/[?#]/)[0];
			assert.ok(ROTAS_DO_SITE.includes(caminho), `link fora do site: ${href}`);
		}
	}
});

test('a ficha do topo começa no cliente 100004817', () => {
	assert.match(html(<PaginaHome />), /CLIENTE 100004817/);
});

test('demonstração: campos, aviso de arquivos, origem e sem a nota do protótipo', () => {
	const s = html(<PaginaDemonstracao />, '/demonstracao?de=speech');
	for (const nome of ['nome', 'empresa', 'email', 'telefone', 'interesse', 'credor', 'tamanho', 'discador', 'canais', 'consentimento']) assert.ok(s.includes(`name="${nome}"`), nome);
	assert.ok(s.includes('Não envie arquivos nem dados de clientes. A conversa basta.'));
	assert.ok(s.includes('Recebemos.'));
	assert.ok(!s.includes('Protótipo'));
	assert.match(s, /name="origem" value="speech"/);
	assert.match(s, /<option value="speech" selected="">Speech Analytics<\/option>/);
});

test('origem do ?de= e o texto da carteira para contatos_site', () => {
	assert.equal(origemDe(null), 'direto');
	assert.equal(origemDe('Home<script>'), 'omescript');
	assert.equal(origemDe('como-decide'), 'como-decide');
	assert.equal(
		mensagemDaCarteira({ interesse: 'cobranca', credor: 'Varejo', tamanho: '', discador: ' Discador X ', canais: ['sms', 'whatsapp'] }),
		'Pedido de demonstração pelo site.\nO que interessa: Cobrança\nTipo de credor: Varejo\nDiscador atual: Discador X\nCanais que usa hoje: WhatsApp, SMS',
	);
});
