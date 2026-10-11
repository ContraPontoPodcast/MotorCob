# Prompt Horizons — Carrossel da plataforma em fundo escuro

Rode depois do site v3 (PROMPT_SITE_V3_CARROSSEL.md). Só muda o visual do carrossel #plataforma.

```text
No site público "/", mude só o visual do carrossel #plataforma. Não mude textos dos slides, telas internas,
outras seções, login, plataforma ou banco.

1. Envolva o carrossel num bloco escuro: fundo #000000, raio 28px (20px no celular), padding 56px em cima e 40px
   embaixo (36px em cima no celular), largura min(1180px, 100vw - 32px), centralizado, margem superior 56px.
   Ele pode ser mais largo que a coluna de texto acima; nunca pode causar rolagem lateral.
2. Dentro do bloco, antes dos slides, título centralizado: "Uma plataforma." em #F5F5F7 + " Seis funções." em
   #86868B, 40px (26px no celular), peso 700, letter-spacing -0.03em, margem inferior 28px.
3. Slides: fundo #1C1C1E (no lugar do #F5F5F7). Número "01".."06" em champanhe #C9A35A; título #F5F5F7; texto
   #A1A1A6. As janelas e cartões brancos dentro dos slides continuam brancos, com sombra
   0 0 0 1px rgba(255,255,255,.08), 0 30px 60px -30px rgba(0,0,0,.8). Moldura do celular do RCS: #3A3A3C.
4. Controles: setas com fundo rgba(255,255,255,.12) e ícone #F5F5F7 (hover rgba(255,255,255,.22); desabilitada
   com opacidade .35); pontos #48484A e o atual #F5F5F7. Foco do trilho pelo teclado: contorno 2px #C9A35A.

O resto da página continua claro. Sem rolagem lateral em 1440, 1024 e 390px.
```
