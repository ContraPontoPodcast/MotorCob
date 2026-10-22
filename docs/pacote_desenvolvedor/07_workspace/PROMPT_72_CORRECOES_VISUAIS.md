# Prompt Horizons — 72: correções visuais e de texto (teste de 22/10/2026)

Rode depois do prompt 71.

```text
Correção pontual: NÃO crie, altere ou apague tabelas, views ou políticas. Não mude rotas nem a navegação.

1. Campos de formulário no tema escuro: em Minha conta › Dados e nos campos numéricos do Console (Rotas, Mistura de
   operadoras) o fundo está branco com texto quase branco. Todos os input, select e textarea usam as cores do tema
   (fundo = superfície do cartão, texto = cor de texto principal, borda = borda do tema), no claro e no escuro.
2. Números dos cartões (Console › Assistente, Console › E-mails do sistema e similares): o número grande está quase
   invisível. Use a cor de texto principal, peso 700; só o rótulo e a linha de apoio ficam em cinza.
3. Console › Fornecedores e rotas › Fornecedores: a tabela passa da caixa e corta o botão "Editar". Coloque a tabela
   num container com overflow-x: auto dentro do cartão e deixe a coluna de ações com largura própria.
4. Console › E-mails do sistema: tire o texto "Passo a passo: 02_supabase_painel/EMAILS_SISTEMA.md" (é um arquivo
   interno). Deixe só "A conta de envio do sistema é separada da conta da Mensageria."
5. Título da aba do navegador: hoje sai "… · MotorCX · MotorCX". Use "{tela} · MotorCX", uma vez só. Na tela de
   login, "Entrar · MotorCX".
6. Suporte: o selo vermelho "Nova resposta" só aparece em chamado NÃO resolvido (situacao <> 'resolvido') com
   ultima_de = 'equipe' e ultima_em > visto_cliente_em. Ordem: "Aguardando você" primeiro, depois os abertos, os
   resolvidos por último; dentro de cada grupo, do mais recente (ultima_em) para o mais antigo.
7. Plural: "1 pessoa" / "2 pessoas" (e o mesmo para pergunta, chamado, empresa) em todo o Console.
8. Busca do Início: o texto de exemplo do campo aparece cortado ("O que você quer fazer? I"). Use só
   "O que você quer fazer?" e deixe o campo ocupar a largura do conteúdo.

Confira em 1440 e 390 px, claro e escuro.
```
