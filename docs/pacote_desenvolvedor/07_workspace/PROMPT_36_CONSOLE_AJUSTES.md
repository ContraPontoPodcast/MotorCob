# Prompt Horizons — Workspace 36: ajustes do Console (homologação)

Rode depois do SQL 29. Corrige o que apareceu na homologação: chaves liga/desliga desalinhadas, situação da
empresa (suspender, encerrar, reativar, excluir teste), aviso de atendimento e plano de rota sem fornecedores.

```text
Console MotorCX (motorcob.online/console). NÃO crie, altere ou apague tabelas, views ou políticas; use só as
funções citadas. Erros: mostre a mensagem do banco (já em português) na faixa vermelha da tela.

## 1. Chave liga/desliga única (todas as telas do Console)
Crie UM componente Chave e troque por ele TODAS as chaves/flags do Console (Empresas, Contratação, Fornecedores,
Planos de rota, Equipe, Faturamento, Margem). Botão <button role="switch" aria-checked>: 44×26 px, raio total,
fundo #D2D2D7 (desligada) ou #34C759 (ligada); bolinha branca 22×22 a 2 px da borda, sombra leve, desliza com
transição de 150 ms (sem transição se prefers-reduced-motion). Rótulo à esquerda do botão, na mesma linha,
alinhado ao centro; texto de ajuda opcional embaixo em 12 px cinza. Desabilitada: opacidade 0,4 e cursor
not-allowed. Foco visível (anel azul 2 px). Nunca use checkbox nativo estilizado nem dois botões "Sim/Não".

## 2. Console › Empresas: situação da empresa
Na lista, selo da situação: Implantação (azul), Ativa (verde), Suspensa (âmbar), Encerrada (cinza).
Na página da empresa, menu "⋯" no canto do cabeçalho com:
- "Suspender" (empresa ativa ou em implantação): janela com campo obrigatório "Motivo" (3 a 200 caracteres) e o
  aviso "A rotina e os envios param até reativar. Os usuários continuam entrando." → rpc mudar_situacao_empresa
  ({empresa, nova: 'suspensa', motivo}).
- "Encerrar": mesma janela, aviso "A empresa sai da rotina, da Saúde e da emissão de faturas." → nova: 'encerrada'.
- "Reativar" (suspensa ou encerrada) → nova: 'ativa' (sem motivo).
- "Excluir empresa de teste" (só aparece para o Master): janela vermelha "Só para empresa criada por engano ou de
  teste, sem nenhum histórico. Não tem volta." e o campo "Digite {slug} para confirmar" → rpc excluir_empresa_teste
  ({empresa, confirmacao: texto digitado}). Se o banco recusar por histórico, mostre a mensagem (sugere Encerrar).
  Depois de excluir, volte para a lista.
Abaixo do nome, quando suspensa ou encerrada: "Suspensa em 13/10/2026 · motivo: {situacao_motivo}".
Quem não pode (sem a permissão de pausar), não vê o menu.

## 3. Atendimento: avisos
- No menu lateral do Console, item Atendimento com contador: rpc atendimento_pendentes() → aguardando_equipe
  (bolinha vermelha com o número; some quando 0). Atualize ao abrir o Console e a cada 60 s.
- Na lista de chamados: chamado com ultima_de = 'cliente' e (visto_equipe_em nulo ou < ultima_em) em negrito com
  o selo "Cliente respondeu"; com situacao = 'aberto' e sem responsável, selo "Novo". Ordene: não vistos primeiro.
- Ao abrir um chamado: rpc marcar_chamado_visto({cid}) e atualize o contador.

## 4. Planos de rota: fornecedores
Na janela do plano, a lista de fornecedores do canal mostra também os inativos (cinza, com "inativo — ative em
Fornecedores"), sem deixar escolher. Se não houver nenhum fornecedor com o canal, mostre no lugar da lista:
"Nenhum fornecedor tem o canal {canal}. Em Fornecedores, edite o fornecedor e marque o canal." com um botão que
abre Fornecedores. Na janela de editar fornecedor, os canais são caixas de marcar: SMS, E-mail, RCS, WhatsApp.

Confira em 1440 e 390 px: as chaves ficam iguais em todas as telas e não quebram a linha do rótulo.
```
