# Passo 2 — SQL

`01_site_comercial.sql` (58 linhas) — Supabase › SQL Editor › New query › cole o arquivo inteiro › Run.
Pode ser rodado mais de uma vez. Resultado esperado: "Success. No rows returned".

Cria:
- bucket público **`site`** (só leitura pública; ninguém grava pelo site; até 20 MB; mp4/jpg/png/gif/webp);
- tabela **`contatos_site`** do formulário "Fale com a gente":
  - o visitante só **insere**, e só nas colunas `nome, empresa, email, telefone, mensagem, consentimento, origem`;
  - `consentimento` precisa ser `true`; e-mail e telefone validados; limite de 3 envios por e-mail por hora e
    200 por hora no total;
  - só a equipe MotorCob (admin de equipe) lê.

Uso no site: `supabase.from('contatos_site').insert({...})` **sem `.select()`** (o visitante não pode ler a tabela;
com `.select()` a chamada falha).

Atenção ao copiar: copie do arquivo aberto num editor de texto. Copiar da prévia de chat/visualizador pode cortar
o texto em 100 linhas.
SQL: supabase/migrations/20261029000001_site_comercial.sql
