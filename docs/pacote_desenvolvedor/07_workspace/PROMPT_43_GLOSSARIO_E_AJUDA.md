# Prompt Horizons — 43: "O que significa" e ajuda pelo tempo de casa (bloco 5)

Rode depois do SQL 32. Protótipo aprovado: `docs/homologacao/bloco5-repaginada-prototipo.html` (aba Glossário).

```text
MotorCX (motorcob.online), plataforma e Console. NÃO crie, altere ou apague tabelas, views ou políticas.

## 1. Página Ajuda › O que significa (/ajuda/o-que-significa)
- Fonte: tabela glossario (slug, grupo, termo, definicao, exemplo, antes, ordem), ordenada por ordem.
- Topo: busca ("Buscar um termo ou um nome antigo") → rpc buscar_glossario(texto); filtros por grupo em pílulas
  (Todos, Fases da cobrança, Régua e estratégia, Operação, Mensageria, Financeiro).
- Cada termo é um cartão com id = slug (âncora): termo em negrito, etiqueta do grupo, definição, exemplo em cinza
  (se houver) e "Antes: ~~nomes antigos~~" (se houver).
- Vazio: "Nenhum termo encontrado. Tente outra palavra ou fale com o suporte."
- Sempre acessível: item "O que significa" no grupo Ajuda do menu e ícone "?" na barra do topo (todas as telas).
- Console (Master): botão "Editar" no cartão, gravando direto na tabela glossario.

## 2. Todo (i) leva ao termo
Componente único Info(termo-slug): ícone (i) 14 px; ao passar o mouse mostra a definição curta (glossario.definicao,
até 140 caracteres) e "Ver no glossário" → /ajuda/o-que-significa#slug. Use em: MC, %MC, Fallback, DLR, Bounce,
Auditoria, Orçamento do canal, Travas, Contato principal, Simulação e envio real, Produto, Ciclo de faturamento.

## 3. Ajuda pelo tempo de casa
Ao entrar: rpc minha_ajuda() → (modo, dias_de_casa, preferencia, tema). Guarde no contexto do app.
- modo 'aberta' (até 15 dias): os textos de ajuda das telas ficam abertos, em caixas cinza-claras com o título
  "Primeiros dias"; o (i) aparece na cor do texto secundário.
- modo 'discreta' (16 a 30 dias): textos recolhidos; só o (i) cinza (#8E8E93).
- modo 'desligada' (depois de 30 dias): nem textos nem (i) nas telas; o glossário e o "?" do topo continuam.
Nos primeiros 15 dias, faixa fina no topo do Início: "Você está nos primeiros dias: as explicações ficam abertas.
Elas se recolhem sozinhas com o tempo. Mudar em Minha conta."

## 4. Minha conta › Preferências
- "Ajuda nas telas": Automática (pelo tempo de casa) · Sempre aberta · Só o (i) · Desligada →
  rpc salvar_preferencias(p_ajuda => 'automatica'|'aberta'|'discreta'|'desligada').
- "Tema": Claro · Escuro · Do sistema → rpc salvar_preferencias(p_tema => 'claro'|'escuro'|'sistema').
  Aplica na hora, sem recarregar.

Confira em 1440 e 390 px, claro e escuro.
```
