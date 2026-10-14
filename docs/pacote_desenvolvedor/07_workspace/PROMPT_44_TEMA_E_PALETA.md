# Prompt Horizons — 44: tema e paleta por área (bloco 5)

Rode depois do SQL 32. Protótipo aprovado: `docs/homologacao/bloco5-paleta-areas-prototipo.html`.

```text
MotorCX (motorcob.online), plataforma, Console e login. Só visual: NÃO crie, altere ou apague tabelas, views
ou políticas e não mude textos nem fluxos.

## 1. Cores em variáveis
Ao abrir o app (antes do login também), leia a tabela tema_tokens (chave, claro, escuro) e escreva cada chave como
variável CSS em :root (ex.: base.menu → --base-menu; area.cobranca.ativo_texto → --area-cobranca-ativo-texto).
Tema escuro: as mesmas variáveis com a coluna escuro, sob [data-tema="escuro"]. Nenhuma cor fixa no código fora
dessas variáveis e das cores dos canais. Se a leitura falhar, use os valores do claro como reserva no CSS.

## 2. Base igual em todas as áreas (estilo Apple)
Menu lateral --base-menu (#EEEFF1) com borda --base-menu-borda; conteúdo --base-conteudo (#F8F8F9), LISO;
cartões --base-cartao (#FFF) com borda --base-borda (#E3E4E8), raio 12 px, sem sombra pesada; texto --base-texto
(#1D1D1F) e --base-texto-2 (#6E6E73). Fonte do sistema (-apple-system, Segoe UI, Roboto).

## 3. Uma cor de destaque por área
Área ativa: Cobrança = --area-cobranca (#8A6A2E, dourado/ocre), Jornada do Cliente = --area-jornada (#4F6B3A,
verde musgo), Mensageria = --area-mensageria (#7A2E3B, vinho). Console usa a da Mensageria só nas telas da
Mensageria; no resto, neutro (#1D1D1F).
A cor da área aparece SOMENTE em: botão principal (fundo; pressionado = .forte), item ativo do menu (fundo .ativo
e texto .ativo_texto), etiqueta da área no topo e filete de 3 px à esquerda do título da página. Links, ícones,
tabelas e gráficos ficam neutros.

## 4. Cores fixas (não mudam com a área)
Verde = pronto (--estado-pronto / fundo), âmbar = atenção (--estado-atencao / fundo), vermelho = erro
(--estado-erro / fundo) e as cores dos canais que já existem (WhatsApp, SMS, RCS, e-mail, voz).

## 5. Halo só onde não se trabalha
Halo suave na cor da área (radial, 8% de opacidade, canto superior direito) apenas no login, no Início e nas telas
vazias ("Nenhum lote hoje" etc.). Telas de trabalho: fundo liso.

## 6. Modo escuro por pessoa
Tema vem de minha_ajuda().tema (prompt 43): claro, escuro ou do sistema (prefers-color-scheme). Preto puro só no
logo e no site público; dentro da plataforma o escuro usa os valores da coluna escuro.

Confira as telas Início, Lista do dia, Orquestração, Mensageria › Painel e Console › Empresas em 1440 e 390 px,
nos dois temas. Contraste mínimo AA em texto e botões.
```
