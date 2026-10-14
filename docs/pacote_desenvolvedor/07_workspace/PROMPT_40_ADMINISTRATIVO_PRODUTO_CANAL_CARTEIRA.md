# Prompt Horizons — 40: perfil Administrativo, produto na campanha, canal por carteira e comitê por produto

Rode depois do SQL 30 e dos prompts 38 e 39.

```text
MotorCX (motorcob.online). NÃO crie, altere ou apague tabelas, views ou políticas.

## 1. Console › Administração › Equipe MotorCob: perfil Administrativo
No controle de papel (prompt 30) entra a 4ª opção: Master · Comercial · Atendimento · Administrativo →
rpc definir_funcao_equipe(id, 'administrativo'). Texto do perfil (aparece ao escolher):
"Faz: ativação, suspender/encerrar/reativar, faturamento e nota fiscal, produtos e preços (inclusive abaixo do
mínimo, com motivo), fornecedores, custos e rotas. Não faz: Orquestração dos clientes nem a Equipe."
A tabela de permissões (view permissoes_equipe_catalogo) ganha a coluna Administrativo; permissões novas:
"Editar produtos", "Preço abaixo do mínimo", "Gerenciar fornecedores".
Menu do Console para o Administrativo: Empresas, Saúde, Faturamento, Margem (MC), Produtos e preços,
Fornecedores e rotas. Sem Equipe MotorCob e sem as telas de Orquestração do cliente.

## 2. Mensageria › Campanhas: escolher o produto
No passo do modelo, select "Produto" com rpc produtos_liberados(empresa, canal) → (codigo, nome, padrao); o
padrão vem marcado. Grava mensageria_campanhas.produto. Produto não contratado não aparece. Se a lista vier
vazia: "Nenhum produto deste canal contratado. Fale com o seu gerente de conta."
No resumo da campanha e no lote: "Produto: SMS OTP".

## 3. Orquestração › Canais e mensagens: regra do canal por carteira
A regra fica no canal da empresa; a carteira herda e pode sobrescrever.
- Topo da tela: seletor "Empresa (todas as carteiras)" + uma opção por carteira.
- Em "Empresa": como hoje (canais_empresa).
- Em uma carteira: os mesmos campos lidos da view canais_credor (empresa_id, credor_id, canal, ativo,
  janela_inicio, janela_fim, sabado, capacidade_dia, tentativas_dia, respeitar_nao_perturbe, produto_padrao,
  sobrescritos). Campo herdado: cinza com "da empresa"; campo em `sobrescritos`: cor normal com o selo
  "desta carteira" e o link "voltar ao da empresa" (remove a chave do jsonb).
- Novo campo "Produto padrão" (select de produtos_liberados do canal).
- Salvar: upsert em credor_canais (empresa_id, credor_id, canal, ajustes jsonb) só com as chaves alteradas
  (ativo, janela_inicio, janela_fim, sabado, capacidade_dia, tentativas_dia, respeitar_nao_perturbe,
  produto_padrao).

## 4. Resultados › Comitê: gasto × CPC por produto
Novo bloco "Mensageria por produto" com a view comite_produtos (competencia, produto, canal, disparadas, gasto,
cpcs): tabela com Produto, Disparadas, Gasto (R$), CPC, Custo por CPC (gasto ÷ cpcs; "—" se 0), % do gasto e
% dos CPCs no mês. Barras lado a lado (% gasto × % CPC) por produto. Filtro de mês.

Confira em 1440 e 390 px.
```
