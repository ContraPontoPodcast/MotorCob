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

## Relatórios e montador — em aprovação (15/10/2026)

Protótipo: `relatorios-prototipo.html`.
- Aprovado: envio por e-mail agendado, só para usuários da empresa, com os números do topo e um link, sem anexo ("Ok").
- Aprovado: relatório salvo editado por quem criou e pelo Admin; os outros abrem e duplicam ("Ok").
- Aprovado com ajuste: exportação até 50 mil linhas na hora; acima, em segundo plano com aviso no sino e link de 7
  dias; **limite de 1 milhão de linhas** ("Limitar em 1 milhão de linhas").
- Aprovado: taxas de resposta, descadastro e clique sobre os entregues ("Correto").
- Pedido do operador: "Não entregues" com a taxa em todo relatório de entrega; no e-mail, bounce permanente e
  temporário.
- Relatórios da Orquestração entram agora ("Entram"): régua, carteira, movimento, acordos, indicadores por safra e
  Jornada do MotorCli — aguardando aprovação da tela.

## Fila para rodar (quando liberar)

1. Merge da PR 108. Depois: SQL 29 → publicar a função `cobranca` (passo 50b) → prompts 55 e 56.
2. Pendências anteriores: confirmar o SQL 26, prompts 53 e 54 e o passo 41 (MotorCli Jornada); salvar de novo a
   Contratação da empresa criada pela metade e convidar o Admin dela.
3. Bloco 2: SQL 30 e prompts (a gerar).
4. Blocos 3, 4 e 5 (a gerar depois das aprovações).
