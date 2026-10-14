# Homologação — aprovações e fila para rodar

Nada desta lista foi rodado no site ou no banco de produção. A regra combinada (14/10/2026): primeiro
prototipar e aprovar todos os blocos, guardar aqui, e só depois rodar tudo na ordem da fila no fim deste arquivo.

## Bloco 1 · Correções rápidas do Console — pronto, aguardando merge

PR 108 (SQL 29, função `cobranca` reempacotada e prompts 36 e 37), com os testes verdes:
- chave liga/desliga única em todo o Console;
- suspender, encerrar e reativar empresa (com motivo) e excluir empresa de teste (só Master);
- avisos do Atendimento (cliente respondeu, contador) e do Suporte no Workspace;
- "Recebe faturas" em qualquer contato da empresa;
- plano de rota mostrando fornecedores inativos e a mensagem quando ninguém tem o canal.

## Bloco 2 · Produtos da Mensageria, fornecedores, rotas e perfil Administrativo — APROVADO em 14/10/2026

Protótipo aprovado: `bloco2-produtos-prototipo.html` (nesta pasta).

Decisões:
1. **Produto = rota que se vende.** Catálogo por canal, por exemplo:
   - SMS: OTP, Short, Marketing (e novos, como SMS Bet);
   - WhatsApp: Utilidade, Serviço, Marketing;
   - RCS: Basic, Single, Conversacional;
   - E-mail: com e sem anexo.

   Cada produto tem código da API, unidade, preço mínimo e preço de tabela. O Administrativo e o Master criam produtos.
2. **Fornecedores.**
   - Cadastro aberto para qualquer fornecedor do mercado, feito pelo Administrativo e pelo Master, com edição depois.
   - A credencial nunca é digitada no site: só o nome do segredo.
   - Sem integração, o fornecedor fica "simulado" e o motor usa a reserva no envio.
3. **Negociação por fornecedor e produto.**
   - **Flat:** um custo para qualquer operadora.
   - **Por operadora:** escolhe as operadoras (Vivo, Claro, TIM, Outras) e o custo de cada uma.
   - **Custo zero ou vazio é proibido** (trava no site e no banco).
4. **Rota do produto.**
   - **Preço flat:** composição com um ou mais fornecedores e % do tráfego.
   - **Por operadora:** blocos por operadora marcada, mais o bloco opcional **Demais operadoras**, que reúne as não marcadas. Ex.: Claro 100% Pontaltech; demais 50% Sinch e 50% Zenvia.
   - Operadora sem bloco e sem "Demais" vai para a rota de reserva do canal.
   - Cada bloco soma 100%.
   - Fornecedor sem custo para aquele produto ou operadora trava a rota.
   - **Rota incompleta não pode ser contratada.**
   - O custo digitado na rota grava na negociação do fornecedor, e vice-versa.
   - Pode cadastrar fornecedor novo de dentro da rota.
5. **Custo previsto.**
   - Na rota flat, é a composição.
   - Na rota por operadora, é a mistura pelo market share de celulares da Teleco (dados Anatel), editável, com fonte e mês, mais a consulta de operadora.
   - O realizado continua envio a envio, pelo fornecedor e pela operadora que levaram a mensagem.
   - A tela mostra também o custo pela mistura real do mês anterior e o pior caso.
6. **Preço.**
   - O Comercial negocia entre o mínimo e a tabela.
   - Abaixo do mínimo, só o Administrativo ou o Master, com motivo obrigatório (vai para a Auditoria).
   - A MC no mínimo aparece na tabela.
7. **Contratação por produto.**
   - Ligar o produto o libera na campanha e na API.
   - A campanha escolhe canal e produto.
   - A API recebe `produto`; se o produto não estiver contratado, responde 422 `produto_nao_contratado`; sem `produto`, vale o padrão do canal.
8. **Regra do canal no canal da empresa.**
   - O credor herda a regra e pode sobrescrever, com selo e o botão "voltar ao padrão".
   - As travas da estratégia só restringem.
9. **Comitê:** % do gasto × % dos CPCs por produto, com índice e custo por CPC.
10. **Perfil Administrativo.**
    - Responsável por: ativação da empresa (Implantação → Ativa), suspender, encerrar e reativar, faturamento, NF, produtos e preços, preço abaixo do mínimo, e fornecedores com custos e rotas.
    - Não acessa Orquestração nem Equipe. Na Auditoria, vê só preços, fornecedores e faturas.
    - O Master continua com tudo.

A escrever, depois de aprovados os blocos 3 e 4: SQL 30, testes, ajustes no motor (custo por operadora, produto no envio) e
prompts do Console, do Workspace e da API.

## Bloco 3 · Orquestração — APROVADO em 14/10/2026 ("Ok! Somente a paleta")

Protótipo: `bloco3-orquestracao-prototipo.html`.
- Carteira no topo; aviso de estratégia compartilhada entre carteiras (causa do "aparece a estratégia do outro
  credor": a estratégia fica no segmento, que é da empresa) com "Separar só para esta carteira" / "Editar para as duas".
- "Copiar de outra carteira" sempre cria cópia independente.
- Barra única: vistas (Desenho, Etapas e fases, Travas, Visão geral) + estado + Copiar + Mais ▾ + Salvar.
- Fases do motor com orçamento por canal, prioridade e travas próprias; tabela de travas estratégia × fase.
- Mapa da Esteira em cartões na ordem da jornada (massivas × acordo), movimento em barras, sem códigos (G1/RE/T1).
Separar estratégia compartilhada = cópia só na carteira atual (recomendação aceita).

## Bloco 4 · Console — incluído no bloco 5 (menus)

Usuários, Permissões e Auditoria saem do grupo sem nome do fim de todos os menus: no cliente, Empresa › Pessoas e
perfis e Empresa › Auditoria; no Console, grupos Clientes · Suporte · Financeiro · Mensageria · Administração (Equipe
e Auditoria de todas as empresas). Empresas é a primeira tela do Console.

## Bloco 5 · Repaginada da experiência — APROVADO em 14/10/2026 (inclusive a paleta)

Protótipos: `bloco5-repaginada-prototipo.html` (glossário, nomes, antes e depois, menus, decisões) e
`bloco5-paletas-prototipo.html` (paletas e ajuda). Revisão das telas: `bloco5-revisao-telas-1.md` e `-2-console.md`.

Aprovado:
1. **Glossário** "O que significa", sempre acessível (menu Ajuda e "?" no topo); todo (i) leva ao termo.
2. **Mantêm o nome** (com (i)): **Fallback**, **MC** e **%MC**, **Auditoria**, **DLR (Delivery Report)** — só SMS e RCS; WhatsApp tem status, e-mail tem bounce.
3. **Ajuda pelo tempo de casa do usuário**: até 15 dias = explicações abertas ("Primeiros dias"); 16 a 30 dias = (i)
   discreto; depois de 30 dias = desligada. Glossário sempre disponível; a pessoa religa a ajuda em Minha conta.
4. Princípios: um nome por conceito; nenhum código interno nem erro técnico cru na tela.

5. Decisões de nome aceitas como recomendado: **MotorCX = plataforma** (áreas Cobrança e Jornada do Cliente);
   CPC A/B → **"CPC · em negociação" / "CPC · sem resposta"**; "Hot" → **"Contato principal"**; **uma regra de senha**
   (12+ caracteres, letra e número) em todas as telas; **CSV, TXT e XLSX** aceitos em todo lugar; demais nomes da
   tabela "Um nome por conceito".

6. **Paleta — APROVADA em 14/10/2026** (`bloco5-paleta-areas-prototipo.html`; insumos: `bloco5-cores-concorrentes.html`,
   `bloco5-laboratorio-cores.html`). Base Apple igual em todas as áreas + uma cor de destaque por área:
   - base: menu cinza-claro #EEEFF1, conteúdo #F8F8F9, cartões #FFFFFF, bordas #E3E4E8, texto #1D1D1F / #6E6E73;
   - **Cobrança: dourado/ocre #8A6A2E** · **Jornada do Cliente: verde musgo #4F6B3A** · **Mensageria: vinho/bordô #7A2E3B**;
   - a cor da área só no botão principal, item ativo do menu, etiqueta da área e filete do título;
   - fixos: verde = pronto, âmbar = atenção, vermelho = erro, e as cores dos canais;
   - fundo **liso** nas telas de trabalho; **halo** suave na cor da área só no login, Início e telas vazias;
   - modo escuro opcional por pessoa (Minha conta); preto só no logo e no site.
   Fora das cores ocupadas pelos concorrentes (azul, roxo, laranja, vermelho, amarelo, menta/turquesa, preto como base).
   Cores em variáveis (tema): trocar depois é mudar uma tabela.

**Todos os blocos (1 a 5) aprovados.** Próximo passo: gerar SQL, testes, ajustes no motor e prompts.

## Bloco 6 · Qualidade dos fornecedores e Score de Entrega — APROVADO em 14/10/2026

Protótipo: `bloco6-qualidade-score-prototipo.html`.
- **Qualidade dos fornecedores** (Console): no SMS o fornecedor é medido pela velocidade (aceite e DLR, mediana e
  p90), por DLR que não volta e por alertas, não pelo % entregue (que reflete o mailing). Comparação de entrega
  só dentro do mesmo lote.
- **Função Técnico** na equipe: vê qualidade e detalhe técnico (código original, horários, fallback), configura o
  filtro de inteligência e os nomes devolvidos. Atende chamados.
- **Fake DLR não é implementado.** No lugar, o **Score de Entrega**, contratado e declarado: o número fora das
  faixas não sai e volta ao cliente com um nome de "não enviado", nunca com status de operadora.
- **Modelo estatístico** por número (hash): histórico de toda a Mensageria (decisão do usuário; recomendação de
  cláusula de base legal no contrato), peso maior para o recente (meia-vida), falha permanente pesa mais, base da
  operadora para pouco histórico. Janela menor (30 dias). Fornecedores com DLR ruim podem ser tirados da análise.
- Faixas **Alto, Médio, Baixo e Sem histórico** (nome mantido, com (i)). Quarentena. Sem regra por DDD.
- **Grupo de controle** (amostra sorteada que sai mesmo assim) para provar o Score.
- **Nomes devolvidos editáveis pelo Técnico**, com trava contra nomes que imitam status de operadora.
- **Cobrança**: por número analisado ou só pelos represados; o SMS fica sempre no preço padrão (a opção de SMS
  inteligente mais caro foi retirada).
- **Campanha**: caixas Todos · Alto · Médio · Baixo · Sem histórico. **Prévia antes de agendar** (pela plataforma):
  divisão do mailing por faixa e custo unitário efetivo da campanha. Pela API segue direto e o resultado aparece
  depois, na Economia do Score.
- **Economia do Score** (cliente): período com data inicial e final, por campanha; economia líquida e **custo
  unitário efetivo** (total pago ÷ mailing carregado) com valores faturados, sem simulação.

## Revisão de UX · decisões de 14/10/2026

- **Economia do Score para quem não contratou:** vitrine ("Deixa como vitrine"). Só números reais do cliente
  (SMS que não chegaram no período e quanto pagou por eles), sem simulação, e o pedido de proposta. Tela no
  protótipo do bloco 6; banco e prompt depois da aprovação da tela.
- **Um nome para a lista de contatos** ("define o que for melhor"): *lista da campanha* na Mensageria, *carga* na
  Cobrança e na Jornada. "Mailing" sai das telas e fica no glossário como nome antigo. Aplicado no SQL 33, no
  Assistente e nos prompts 46 a 48.
- **Mistura de operadoras** ("pode fazer"): no fim da aba Rotas, como o prompt 39. Protótipo do bloco 2 ajustado.

## Fila para rodar (quando liberar)

1. Merge da PR 108. Depois: SQL 29 → publicar a função `cobranca` (passo 50b) → prompts 55 e 56.
2. Pendências anteriores: confirmar o SQL 26, prompts 53 e 54 e o passo 41 (MotorCli Jornada); salvar de novo a
   Contratação da empresa criada pela metade e convidar o Admin dela.
3. Merge da PR dos blocos 2 a 5 (branch `claude/geracao-blocos-2-5`, empilhada sobre a 108). Tudo já gerado e testado
   (RLS 882 ok, motor 383 ok); nada foi rodado no site nem no banco. Ordem (passos 63 a 71 do `00_LEIA_PRIMEIRO`):
   a. Conferir a mistura de operadoras do Teleco do mês (vem semeada com agosto/2026; dá para editar depois).
   b. SQL 30 → prompts 38, 39 e 40 (Produtos e preços, Fornecedores e rotas, Administrativo/produto/canal/comitê).
   c. SQL 31 → prompts 41 e 42 (Orquestração por carteira e Mapa da Esteira).
   d. SQL 32 → senha no painel do Supabase (12+, letras e números) → prompts 43, 44 e 45 (glossário e ajuda,
      paleta, menus e nomes).
   e. Publicar de novo a função `assistente` (`python3 scripts/juntar_funcao.py assistente`) e atualizar o motor na
      nuvem (`systemctl start motorcob-atualizar`).
   f. `CONFERENCIA_GERAL.sql`: itens 17, 18 e 19 devem dar OK.
4. Bloco 6 (branch `claude/geracao-bloco-6`, empilhada sobre a dos blocos 2 a 5): SQL 33 → prompts 46, 47 e 48 →
   função `assistente` de novo → motor na nuvem (passos 72 a 74). Conferência: item 20 OK.
5. Correção incluída no SQL 30: o perfil Administrativo não herda a Orquestração, as cargas, os canais nem os usuários
   do cliente (antes herdaria pelo papel Planejamento).
