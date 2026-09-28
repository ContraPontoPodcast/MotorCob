# Prompt de ajuste do site: várias empresas clientes

O site já existe (Hostinger Horizons). Este prompt pede **só as mudanças** para o site
atender várias empresas clientes, cada uma vendo apenas os próprios dados.

Antes de colar: aplique no Supabase a migração
`supabase/migrations/20260928000001_multiempresa.sql` (SQL Editor › New query › colar ›
Run). Sem ela, o site novo não funciona. A chave usada no site continua a mesma
(anon/pública). **Nunca** entregue a chave `service_role` para a ferramenta do site.

---

```text
Ajuste o site MotorCob para várias empresas clientes (multiempresa). O banco já foi
alterado — NÃO crie, altere ou apague tabelas, views, buckets ou políticas. Mantenha
todo o resto do site como está (visual, login, páginas), mudando só o que vem abaixo.

## O que mudou no banco
- Nova tabela empresas (id, slug, nome, ativa, criada_em). slug é o nome curto da
  empresa (minúsculas, números e hífen), usado nas pastas de arquivos.
- perfis ganhou empresa_id (empresa do usuário) e equipe (true = equipe MotorCob,
  vê todas as empresas).
- Todas as tabelas de dados ganharam empresa_id: envios, execucoes, estado_cliente,
  trilha, fila_dia, kpis, acessos. As views resumo_estados, resumo_fila e
  ultima_execucao também têm empresa_id (ultima_execucao traz uma linha por empresa).
- Os arquivos no Storage agora ficam dentro da pasta da empresa:
  entradas/{slug}/{tipo}/{AAAA-MM-DD}/{arquivo}
  saidas/{slug}/{AAAA-MM-DD}/ids/{canal}.csv
  saidas/{slug}/{AAAA-MM-DD}/fila_do_dia.csv, enriquecimento.csv, alertas.txt
  saidas/{slug}/comite/{AAAA-MM}/...
- O banco já garante que cada usuário só lê a própria empresa. O site só precisa
  escolher a empresa certa e filtrar por ela.

## Empresa selecionada
- Após o login leia: select id, nome, email, papel, ativo, empresa_id, equipe from perfis
  where id = auth.uid().
- Se ativo = false, ou se equipe = false e empresa_id for nulo, mostre "Acesso não
  liberado. Fale com o administrador." e o botão Sair.
- Usuário de empresa (equipe = false): a empresa dele é fixa. Mostre o nome da empresa
  no topo, ao lado do nome do usuário.
- Equipe MotorCob (equipe = true): no topo, um seletor "Empresa" com as empresas ativas
  (select id, slug, nome from empresas where ativa order by nome). Guarde a escolha só na
  memória da sessão (pode usar sessionStorage para o id da empresa; nada de dados de
  cliente). Enquanto não houver empresa escolhida, as páginas mostram "Escolha a empresa
  no topo".
- Em TODAS as consultas das páginas, filtre por empresa_id = empresa selecionada
  (.eq('empresa_id', id)), inclusive nas views. Em todos os caminhos do Storage, use o
  slug da empresa selecionada como primeira pasta.
- Em todo insert em acessos, envie também empresa_id da empresa selecionada.

## Início (/)
- Card "Última rotina": ultima_execucao filtrada pela empresa selecionada. Se não
  houver linha, mostre "A rotina ainda não rodou para esta empresa".
- resumo_estados e resumo_fila: filtrados pela empresa.

## Fila do dia (/fila)
- Os arquivos agora trazem o ID do cliente E o contato a acionar (id_cliente;contato).
  Troque o texto dos botões "Baixar IDs" por "Baixar lista" e o texto de ajuda por:
  "Lista com o ID do cliente e o contato escolhido pelo MotorCob. No discador e no agente
  virtual o mesmo cliente pode vir em mais de uma linha (um número por linha, na ordem
  de discagem)."
- Caminhos: saidas/{slug}/{data}/ids/{canal}.csv, saidas/{slug}/{data}/ids/discador_reserva.csv
  e, para admin e planejamento, saidas/{slug}/{data}/fila_do_dia.csv, enriquecimento.csv e
  alertas.txt. O .zip do dia continua juntando os arquivos de ids/.
- Aviso fixo em cinza abaixo dos botões: "Estes arquivos têm telefone e e-mail de
  clientes. Use só na ferramenta do canal e não repasse." Continue registrando cada
  download em acessos (com empresa_id).

## Enviar arquivos (/envios) — admin e planejamento
- Tipos (select), nesta ordem e com estes rótulos:
  base → "Base de clientes (arquivo bruto da empresa)"
  ocorrencia → "Ocorrências (CPC ou não por tentativa)"
  retorno → "Retorno de fornecedor"
  parcelas → "Parcelas de acordos"
  clientes → "Clientes (formato MotorCob)"
  contatos → "Contatos (formato MotorCob)"
  portal → "Log do portal"
- Permita vários arquivos de uma vez para base, ocorrencia e retorno.
- Upload no bucket 'entradas' em {slug}/{tipo}/{AAAA-MM-DD de hoje}/{timestamp}_{nome}
  (troque espaços e acentos do nome por '_'). Depois insira em envios:
  (empresa_id, tipo, caminho, nome_original). O banco recusa se o caminho não começar
  pelo slug da empresa e pelo tipo, então monte exatamente assim.
- Ajuda por tipo:
  base: "O arquivo que a empresa manda para as ações, do jeito que vem (com os telefones
   e e-mails em colunas). O MotorCob lê conforme o cadastro da empresa."
  ocorrencia: "O arquivo da empresa dizendo, por tentativa, se houve CPC. Não precisa
   trazer o telefone: o MotorCob sabe qual contato mandou acionar."
  retorno: "Arquivo do fornecedor, como ele vem (o motor reconhece pelo nome)."
  parcelas: id_cliente;id_acordo;parcela;vencimento;valor;pago_em
  clientes: id_cliente;data_entrada;saldo;dias_atraso;bloqueio
  contatos: id_cliente;contato;tipo;origem;cpf;whatsapp_valido;atualizado_em
  portal: token;evento;ocorrido_em;valor_acordo
- A tabela dos últimos 50 envios é da empresa selecionada. No relatório (JSON) de base
  mostre em destaque clientes_na_base e contatos; no de ocorrencia mostre aceitas,
  contato_identificado, avisos e quarentena.

## Cliente (/cliente)
- Busca por ID dentro da empresa selecionada (estado_cliente e trilha com
  .eq('empresa_id', id)).

## Painel (/painel) e Comitê (/comite)
- kpis filtrado pela empresa. Comitê lista saidas/{slug}/comite/.

## Empresas (/empresas) — só equipe MotorCob com papel admin
- Tabela: nome, slug, ativa (switch → update empresas set ativa).
- Botão "Nova empresa": nome e slug (sugira o slug a partir do nome: minúsculas, sem
  acento, espaços viram hífen; 2 a 40 caracteres, só a-z, 0-9 e hífen) → insert em
  empresas. Texto de ajuda: "Depois de criar, mande para o MotorCob o cabeçalho (primeira
  linha) da base e do arquivo de ocorrências desta empresa, e a lista de ocorrências que
  ela usa, para configurar a leitura."
- Esconda o item do menu para quem não é equipe admin.

## Usuários (/usuarios) — admin
- Equipe MotorCob admin: vê todos os perfis, com coluna Empresa (select com as empresas
  + "Equipe MotorCob"). Escolher uma empresa grava empresa_id = id e equipe = false;
  escolher "Equipe MotorCob" grava empresa_id = null e equipe = true.
- Admin de empresa (equipe = false): vê só os usuários da própria empresa e altera
  papel e ativo deles; não vê a coluna Empresa.
- Texto de ajuda: "Para criar um acesso: Supabase › Authentication › Users › Add user
  (marque Auto Confirm). O usuário entra sem empresa e sem acesso; escolha a empresa e o
  papel aqui."
```

---

## Depois de publicar

1. Entre com o seu usuário (equipe MotorCob): o seletor "Empresa" aparece no topo.
2. Em **Empresas**, crie a primeira empresa cliente.
3. Crie um usuário de teste dessa empresa (Supabase › Add user) e, em **Usuários**,
   coloque-o na empresa. Entre com ele e confira que não aparece seletor de empresa e
   que ele não vê nada de outra empresa.
