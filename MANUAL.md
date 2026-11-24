# Manual de Uso — Radar de Vagas

Guia prático para qualquer pessoa usar o **Radar de Vagas** (`https://egoncalvess.github.io/painel-vagas/`) no computador ou no celular, com base de dados individual e sem precisar de Token do GitHub.

---

## 1. Como acessar e criar sua conta

Ao abrir o link, você verá a tela de entrada do Radar:

1. **Criar acesso (e-mail e senha)**:
   - Clique na aba **Criar acesso**, informe seu nome, um **e-mail real** e uma senha forte. A conta é criada no Supabase e você recebe um e-mail de confirmação: clique no link e depois entre.
2. **Entrar**:
   - Informe seu e-mail e senha. Se aparecer "Confirme seu e-mail pelo link que enviamos.", use **Reenviar e-mail de confirmação**.
3. **Esqueci minha senha**:
   - Abaixo do botão Entrar. Informe o e-mail, abra o link recebido e defina a nova senha no próprio painel.

Não há mais acesso de convidado nem conta salva só no navegador: todo acesso passa pelo Supabase.

### Dados de uma conta antiga deste navegador

Se você usava uma conta antiga criada só com nome de usuário (sem e-mail), depois de entrar com o e-mail o painel pergunta uma vez se quer trazer esses dados, pedindo o **usuário e a senha antigos**. A senha é conferida só no seu navegador, não é enviada nem guardada, e são no máximo 5 tentativas. Nada é apagado. A opção também fica em **Configurações → Backup local**.

> **Privacidade**: Cada conta possui sua própria base isolada (`RadarDynamicDB` no navegador e sincronização opcional no Supabase). Suas vagas salvas, candidaturas e currículo nunca se misturam com os dados de outras pessoas.

---

## 2. Configurando seu Perfil e Currículo (`Meu perfil`)

Antes de avaliar as vagas, acesse **Meu perfil** no menu lateral:

- Preencha seu **Nome**, **Cidade / Região**, **Cargos de interesse** e **Competências / Habilidades** (separadas por vírgula).
- Marque as modalidades aceitas (**Remoto**, **Híbrido**, **Presencial**).
- Clique em **Salvar perfil**.

A partir desse momento, o Radar recalcula automaticamente o **Score (0–100)** e os **requisitos compatíveis** de todas as vagas para o seu perfil.

### Triagem e candidatura

No mesmo formulário, em **Triagem e candidatura**:

- **Pretensão mínima / máxima (R$/mês)**: deixe `0` para não filtrar.
- **Mostrar vagas sem salário informado**: vem marcado; a maioria das vagas não informa salário.
- **Nota de corte para candidatura**: padrão **75**. Vagas acima do corte ganham uma faixa verde; as abaixo ficam mais apagadas.
- **Cidades de interesse**: as cidades separadas por vírgula usadas no filtro de cidade.

---

## 3. Buscando e filtrando vagas (`Vagas`)

Na aba **Vagas**, você conta com:

- **Busca textual (`#busca`)**: filtre por cargo, empresa, cidade ou palavra-chave, com botão **`×`** para limpar rapidamente.
- **Atalhos rápidos**: clique nos botões de acesso rápido (`Score 80+`, `Remoto`, `Salvas ★`, `Novas hoje`) para filtrar em um toque.
- **Filtros combinados**: refine por **Site**, **Área**, **Modalidade**, **Score mínimo** e **Ordenação**.
- **Favoritar vagas (`☆ Salvar` / `★ Salva`)**: salve as vagas mais interessantes para revisar depois usando o filtro **Salvas**.
- **Ações na vaga**:
  - **Me candidatei**: registra a data da candidatura e move para a aba de candidaturas.
  - **Descartar**: oculta vagas que não interessam para o seu perfil.
  - **+ Adicionar vaga**: cadastre manualmente uma vaga encontrada fora dos portais.
- **Prova de Cobertura**: cole links ou títulos de vagas para conferir se o coletor já leu aquela vaga ou por que ela ficou de fora.
- **Fila Vagas.com.br**: exibe anúncios do Vagas.com.br que falharam ou ficaram sem modalidade definida na coleta para revisão manual.
- **Filtros de triagem**: em Score, **Acima do meu corte**; em Cidade, **Minhas cidades + remoto**; em Salário, **Compatível com minha pretensão**.

### Fila de candidatura

1. Clique em **Elegíveis (corte N+)** para ver as vagas acima da sua nota de corte, na sua cidade e na sua faixa salarial.
2. Abra a vaga e clique em **Pôr na fila de candidatura**. Depois, o status pode ser trocado ali mesmo.
3. Em **Fila de candidatura**, use **Exportar fila-candidatura.json** e entregue o arquivo ao OpenBot (skill `candidatura-assistida-vagas`).
4. O OpenBot prepara no máximo 5 vagas por vez, **pede sua aprovação antes de cada envio** e pede que você preencha senha, CPF e respostas pessoais. Ele não inventa habilidades.
5. Volte ao painel e use **Importar resultado-candidatura.json** para atualizar os status: Na fila, Preparando, Aguardando você, Candidatado, Pulada ou Falhou. "Candidatado" também marca **Me candidatei**.

> O painel nunca envia candidatura sozinho.

### Atalhos de teclado (computador)
- **`/`**: foca a caixa de busca.
- **`↑` / `↓`** ou **`J` / `K`**: navega entre as vagas da lista.
- **`S`**: salva ou remove dos favoritos a vaga selecionada.
- **`Esc`**: fecha modais ou a gaveta de detalhes no celular.

---

## 4. Publicações (`Publicações`)

Aba dedicada para registrar fatos reais da sua trajetória profissional e organizar rascunhos de posts para o LinkedIn alinhados ao seu perfil.

---

## 5. Sincronizar entre Celular e Computador

A sincronização entre celular e computador é automática:

1. Entre com o mesmo **e-mail e senha** no computador e no celular para acessar suas vagas salvas, candidaturas e perfil em qualquer aparelho.
2. Se desejar uma cópia offline, use **Baixar backup (.json)** ou **Importar backup (.json)** em **Configurações**.

---

## 6. Para o Administrador: Ativar Sincronização em Nuvem (Supabase)

Para sincronizar contas e perfis na nuvem para todos os usuários no GitHub Pages:

1. Crie um projeto no Supabase, execute `supabase/schema.sql` no **SQL Editor** (em projeto já existente, `supabase/migracao_20261124_008_auth.sql`) e mantenha o provedor **Email** ativo, com **Confirm email** ligado.
2. Em *Authentication → URL Configuration*: **Site URL** `https://egoncalvess.github.io/painel-vagas/` e, em **Redirect URLs**, `https://egoncalvess.github.io/painel-vagas/**` (necessário para a confirmação e o "Esqueci minha senha").
3. Preencha `url` e `anon` (chave pública `anon`, nunca a `service_role`) em `docs/supabase-config.js`.
4. **Primeiro admin:** crie sua conta pelo painel, confirme o e-mail e rode uma vez `supabase/primeiro_admin.sql` no SQL Editor trocando `<SEU_EMAIL>`. Saia e entre de novo. O papel `admin` vem só da tabela `perfis` no banco; nenhum usuário consegue se promover sozinho.
5. **Dados antigos no Supabase** sob um usuário sem e-mail: `supabase/reatribuir_conta_antiga.sql` (troque `<CHAVE_ANTIGA>` e `<SEU_EMAIL>`) passa esses dados para a conta nova sem apagar nada.

> O workflow "Configurar Supabase" altera a configuração de autenticação do projeto só com `APLICAR_CONFIG_AUTH=1`.