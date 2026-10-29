# Prompt Horizons — 87: Propensão a pagamento na tela (estágio, Matriz, Clientes e Lista do dia)

UX, 29/10/2026. Rode depois do SQL 48 (propensao_carteira) e dos prompts 81–86 (com 84b, 84c e 86b). Motor:
branch claude/propensao-fase1 (motor/propensao.py). Protótipo: docs/homologacao/estagios-prototipo.html (Matriz
e faixas). Conferido no bundle publicado (manifest-e2b1db45): editor de condições do estágio com o grupo
"Fatos do MotorCX" e a opção "__propensao" desabilitada; Personas com "Suas personas" e "Personas da
inteligência MotorCX"; Clientes lendo estado_cliente com filtros; a Lista do dia (/fila) não lista clientes.

```text
NÃO crie, altere ou apague tabelas, views ou políticas. Leia só o que já existe: estado_cliente.propensao e
faixa_propensao, a view propensao_carteira, personas.propensao e personas.maturidade, execucoes.resumo. Não
mude a ordem da fila nem a escolha de canal. Nada de CPF ou nome de devedor; o cliente aparece pelo ID.
Banco sem o SQL 48: as colunas propensao/faixa_propensao e a view propensao_carteira não existem. Toda leitura
nova deste prompt trata esse erro (coluna/relação inexistente) assim: refaz a consulta sem as colunas novas,
esconde coluna, filtro, faixa e bloco de propensão e mostra "Coletando". Nenhuma tela pode quebrar por isso.

## 0. Texto de uma linha (use igual em todo lugar, com o ícone de ajuda de hoje)
"Propensão a pagamento: chance de pagar em 30 dias. Pagamento = quitação ou 1ª parcela paga; acordo é
promessa. Faixas A (muito alta) a E (muito baixa), com cortes refeitos aos domingos."
Cores da letra (fundo/texto): A #0F4C5C/#FFF · B #2E7487/#FFF · C #5B9AAB/#0B2A33 · D #93BFCB/#0B2A33 ·
E #C9DFE5/#0B2A33; no escuro A #A8DCE6 · B #7CC0CE · C #5299A9 (texto #06222A) · D #357483 · E #24535E
(texto #FFF). Sem faixa: "—" em var(--base-texto-3), com a dica "sem faixa: carteira em Coletando ou cliente fora do cálculo (acordo em dia, liquidado, bloqueado)". Coloque o texto no glossário da Ajuda.
Evidência da carteira: execucoes.resumo.propensao.evidencia da última execução da carteira (coletando,
previa, definida → Coletando, Prévia, Definida). Sem esse dado: "Coletando" quando propensao_carteira não
tem nenhuma linha com faixa_propensao preenchida.

## 1. Estágio: liberar "Propensão a pagamento (fato)"
- No editor de condições, no grupo "Fatos do MotorCX", troque a opção desabilitada "__propensao" por uma
  opção ativa de valor "propensao" ("Propensão a pagamento (fato)"). "Abordagem da persona (fato)" continua
  desabilitada com "Coletando · em breve".
- Com campo propensao, o operador é fixo "em" e o valor são 5 botões A–E (as cores do item 0), marcar
  vários. Grava {"campo":"propensao","op":"em","valor":["A","B"]}. Pelo menos uma faixa.
- Embaixo da condição: o texto do item 0 e "Quem está em Acordo em dia, em acordo (COL), liquidado ou
  bloqueado não tem faixa e não entra por esta condição."
- Carteira em Coletando: selo "Coletando" ao lado da condição e o aviso âmbar "Esta carteira ainda não tem
  faixas (poucos pagamentos para calcular). O estágio fica salvo, mas só recebe clientes quando houver
  faixa." Não bloqueia salvar.
- Prévia "≈ N clientes hoje": se as condições forem só de propensão, some propensao_carteira.clientes da
  carteira e do segmento (cluster = código do segmento) com faixa_propensao nas faixas marcadas; com
  qualquer outra condição, "prévia na próxima lista". Em Coletando, "≈ 0 clientes hoje (Coletando)".
- Tire "Propensão" do selo "Coletando · em breve" da linha fixa de fatos (fica só Abordagem).

## 2. Personas › vista "Matriz"
- No topo de /personas, um controle "Cartões | Matriz" (padrão Cartões; guardar em localStorage
  mc-personas-vista). A vista Cartões é a página de hoje.
- Matriz 2×2, eixo vertical "Propensão a pagamento" (alta = A–C em cima, baixa = D–E embaixo) e eixo
  horizontal "Abordagem" (aprendendo à esquerda, definida à direita), com a nota fixa "Hoje a Abordagem mede
  o canal (maturidade da persona); contato e mensagem entram depois."
- Quadrantes, cada um com o selo "sugestão": Acelerar (alta + definida) · Descobrir rápido (alta +
  aprendendo) · Manter barato (baixa + definida) · Economizar (baixa + aprendendo).
- Personas = as da inteligência (tabela personas da carteira). Faixa da persona: se a soma de
  propensao.faixas em A, B e C for maior ou igual à de D e E, é "alta"; senão "baixa". Abordagem:
  maturidade.fase = 'definida' é "definida"; coletando ou previa é "aprendendo". Persona sem propensao (ou
  sem faixas) fica fora, numa linha embaixo: "Sem faixa ainda: <nomes>".
- Em cada quadrante: clientes e saldo (soma de personas.propensao.clientes e .saldo), "valor esperado"
  (soma de valor_esperado, em R$) e as personas em chips (nome + bolinha da cor que a página já usa).
- Acima da Matriz, uma faixa com a carteira por faixa de propensão (propensao_carteira da carteira, somando
  segmentos e personas): A–E e "Sem faixa", com clientes e valor esperado; o selo da evidência do item 0.
- Botão por quadrante "Criar estágio com estes clientes" (só quem edita a Orquestração: a mesma condição de editar_orquestracao das outras telas dela): abre /orquestracao no
  passo Estágios da carteira e do segmento escolhidos (pergunte o segmento se a carteira tiver mais de um)
  com um estágio novo NÃO salvo, no topo da prioridade, nome = nome do quadrante e condições preenchidas:
  {"campo":"propensao","op":"em","valor":["A","B","C"] ou ["D","E"]} e {"campo":"fase","op":"em",
  "valor":["localizacao","cpc","giro","quebra"]}, com referencia {"tipo":"entrada"}, de 1 e ate 30 e id
  gerado como no 84b (o mesmo formato do "+ Estágio"). Leve o rascunho por sessionStorage até a
  Orquestração (não pela URL) e marque "Alterações não salvas". Aviso no editor: "A Abordagem ainda não é campo do motor:
  este estágio pega todos os clientes dessas faixas, não só as personas do quadrante." Régua vazia.
- Carteira em Coletando: a Matriz mostra só a faixa do topo e "Ainda sem faixas nesta carteira."

## 3. Clientes (/clientes): coluna e filtro
- Acrescente faixa_propensao (e propensao) ao select de estado_cliente. Coluna "Propensão" depois de
  "Persona (sua)": letra colorida (item 0) e, ao passar o mouse, "chance de pagar em 30 dias: NN%". Sem faixa:
  "—" com a dica "Coletando ou fora da população (acordo em dia, liquidado, bloqueado)".
- Filtro "Propensão" junto dos filtros de hoje: Todas · A · B · C · D · E · Sem faixa (.eq faixa_propensao
  ou .is null). Aceite os parâmetros de URL ?faixa=A..E|sem e ?comAcaoHoje=1 (liga o filtro "com ação hoje"
  que a tela já tem; hoje ela só lê ?motivo=).

## 4. Lista do dia (/fila)
A tela não lista clientes. Acrescente o bloco "Com ação hoje, por propensão": 6 contagens (A–E e Sem faixa)
em estado_cliente da carteira com na_carga e acao_hoje preenchida (consultas só de contagem, como o
Clientes já faz). Cada contagem é um link para /clientes?comAcaoHoje=1&faixa=<letra|sem>. Texto do item 0
no ícone de ajuda.

Aceite: o estágio grava {"campo":"propensao","op":"em","valor":[...]} e a prévia soma propensao_carteira;
em carteira Coletando aparecem o selo e o aviso, sem bloquear; a Matriz mostra quadrantes com números reais
e a nota sobre a Abordagem; "Criar estágio com estes clientes" abre o estágio preenchido sem salvar;
Clientes mostra a coluna e filtra por faixa (inclusive Sem faixa); a Lista do dia mostra as 6 contagens com
link. Confira em 1440 e 390 px, claro e escuro, como Admin e Operação (Operação vê, sem criar estágio).
```
