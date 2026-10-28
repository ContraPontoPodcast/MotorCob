# Prompt 77 — padrão de página e listas (lista de itens, prompt a escrever depois do 75b)

UX, 25/10/2026. Ainda não é prompt: é o escopo, com a paginação mapeada pelo CX (`cx/respostas_ux_75v4.md`, pergunta 9).
Rodar depois do 75b. Visual de referência: `produto-prototipo.html` (Personas e Campanhas). Vai virar dois ou três
prompts de menos de 100 linhas (77a cabeçalho e ações, 77b listas, 77c estados).

## 1. Cabeçalho único em todas as telas
- Todas as telas com h1 próprio passam a usar o cabeçalho X/T, com o mesmo estilo:
  - home, conta, relatorios, montar-relatorio, suporte-detalhe, suporte-novo;
  - Mensageria: mensageria-atendimento, -radar, -config-atendimento, -score, -index, -campanha-detalhe;
  - estrategia-editor-core, docs, documentacao, role-gate, app-not-found;
  - Personas, Clientes, Enviar arquivos e Jornada.
- Uma ação principal por tela, em `--destaque`. As outras viram botões em contorno ou vão para "⋯":
  - Orquestração: o "Salvar" fixo (`bottom-6 right-6`, #0F4C5C) vira a ação do cabeçalho, ou fica fixo em ouro, um dos dois;
  - Lista do dia e Clientes: "Reenquadrar agora" vai para "⋯".
- "Buscar cliente" sai do X: no ⌘K, digitar um ID abre `/cliente?id=`.
- Recolorir os botões principais `#0F4C5C` e `#1D1D1F`, **tela a tela** (não por CSS global: `#1D1D1F` aparece 182 vezes e não é só botão).
- Títulos de página num tamanho só (24/600); raios 8, 12 e 999.

## 2. Listas: barra da seção, grade/lista e cartão
- **Barra da seção:**
  - rótulo em caixa alta e espaçado + contagem ("16 persona(s)");
  - à direita, busca em ícone (filtra a lista na tela) e alternância grade/lista, lembrada por tela no localStorage (`mc-vista:{rota}`).
- **Cartão da grade:**
  - avatar ou ícone e pílula com o dado principal e o botão copiar (código);
  - ações em ícone (etiqueta, desempenho, ›);
  - status em pílula, à esquerda;
  - selo à direita (maturidade, entrega);
  - divisória e metadados em duas colunas (rótulo cinza + valor).
- **Grade:** `repeat(auto-fill, minmax(270px, 1fr))`, que dá 4 por linha a partir de cerca de 1440 px; uma coluna abaixo de 600 px.
- **Lista:** a tabela de hoje, com cabeçalho fixo e rolagem lateral dentro do cartão.
- **Onde aplicar a grade:** Personas, Segmentos, Carteiras, Campanhas, Templates, Listas, Pessoas e Relatórios salvos.
- **Onde fica só a lista:** Lotes, Clientes, Ações, Auditoria e Envios.

## 3. Paginação (rodapé fixo do cartão)
**Rodapé:**
- "Itens por página [12 ▾]" (opções 12, 24 e 48);
- "1–12 de N resultados";
- "Página x de y", com ‹ e os números (até 5 visíveis, com reticências).

A página e o tamanho ficam na URL (`?pagina=`, `?por=`). Voltar no navegador restaura.

| Tela | Hoje (CX) | No 77 |
|---|---|---|
| Clientes | Pagina no banco (`count: 'exact'` + `.range`) | Só trocar o rodapé pelo padrão |
| Auditoria | Pagina no banco (`.range` + `count`) | Só trocar o rodapé |
| Ações, reenquadramento | `.range` em lotes de 1000 para buscar **tudo** (não é paginação de tela) | Paginar no banco (`range` + `count`), 24 por página |
| Relatórios | `.limit(50)` | Paginar os relatórios salvos e as exportações (`range` + `count`) |
| Personas, Segmentos, Carteiras | Trazem tudo | Paginar na tela (listas curtas, < 200) |
| Campanhas, Templates, Listas | Trazem tudo | Paginar no banco (`range` + `count`, ordem por data) |
| Lotes (`lotes-lista`, `mensageria-lotes`) | Trazem tudo | Paginar no banco por data (cresce todo dia) |
| Pessoas | Traz tudo (RPC `pessoas_empresa`) | Paginar na tela |
| Suporte | Traz tudo | Paginar na tela, 12; se o dono quiser, um filtro "Situação" explícito (não abas) |

## 4. Contadores das abas (consultas novas, só leitura, ficaram fora do 75b)
- **Lista do dia:** `count` de `fila_dia` por empresa, carteira e data de hoje.
- **Respostas sem dono:** `count` de `mensageria_conversas` com `situacao='aberta'` e `responsavel is null` (a regra do `para_hoje`), só para quem tem `enviar_mensagens`. Não é a soma de `nao_lidas` que o `app-shell` usa hoje.
- **Faturas em aberto:** `count` de `faturas` em `aberta`/`vencida`, só para quem tem `ver_faturamento`.

Atualizar a cada 60 s, como o contador do Suporte.

## 5. Estados
- **Vazio padrão:** ícone, uma frase do que falta e o próximo passo com botão. Substitui "Sem dados.", "Nada aqui.", "Nenhum lote encontrado." etc.
- **Carregando:** esqueleto no formato do cartão ou da linha, no lugar dos 63 "Carregando...".
- **Confirmação:** o `confirma-acao` do prompt 49 (título, texto com a consequência, botão destrutivo) no lugar das 16 chamadas `confirm()` em 13 módulos, listadas pelo CX:
  - canais, console-assistente, console-faturamento, conta;
  - credor-configuracoes (2), credores, empresa-contatos, jornada-mensagens;
  - mensageria-listas, mensageria-templates, orquestracao (2), personas, relatorios (2).

## 6. Aceite (para o prompt)
- Toda lista do item 2 tem a barra da seção e o rodapé de paginação.
- Nenhuma tela traz mais de 200 linhas de uma vez.
- Nenhuma tela tem `confirm()` nativo nem dois botões principais.
- Ações, Campanhas e Lotes abrem em menos de 1 s com 10 mil registros (conferir com a empresa de demonstração).
