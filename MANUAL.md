# Manual de Uso — Radar de Vagas

Guia prático para qualquer pessoa usar o **Radar de Vagas** (`https://egoncalvess.github.io/painel-vagas/`) no computador ou no celular, com base de dados individual e sem precisar de Token do GitHub.

---

## 1. Como acessar e criar sua conta

Ao abrir o link, você verá a tela de entrada do Radar:

1. **Criar acesso (usuário e senha)**:
   - Clique na aba **Criar acesso**, informe seu nome/usuário ou e-mail e defina uma senha forte (o medidor valida tamanho mínimo e combinação de caracteres; a senha é protegida com hash `SHA-256`).
2. **Continuar com Google (OAuth real)**:
   - Quando o administrador configurar o **Supabase Auth (Google)** ou o **Google Client ID** em `docs/supabase-config.js` (ou em **Configurações**), o botão **Continuar com Google** abre a autenticação oficial do Google com validação real de conta.
   - Enquanto as credenciais OAuth não estiverem configuradas, o sistema bloqueia logins simulados e orienta usar **Criar acesso** ou **Continuar como convidado**.
3. **Continuar como convidado**:
   - Permite testar o painel imediatamente no navegador atual sem cadastro prévio.

> **Privacidade**: Cada conta possui sua própria base isolada (`RadarDynamicDB` no navegador e sincronização opcional no Supabase). Suas vagas salvas, candidaturas e currículo nunca se misturam com os dados de outras pessoas.

---

## 2. Configurando seu Perfil e Currículo (`Meu perfil`)

Antes de avaliar as vagas, acesse **Meu perfil** no menu lateral:

- Preencha seu **Nome**, **Cidade / Região**, **Cargos de interesse** e **Competências / Habilidades** (separadas por vírgula).
- Marque as modalidades aceitas (**Remoto**, **Híbrido**, **Presencial**).
- Clique em **Salvar perfil**.

A partir desse momento, o Radar recalcula automaticamente o **Score (0–100)** e os **requisitos compatíveis** de todas as vagas para o seu perfil.

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

Se você usa o painel no celular e no computador sem login Supabase configurado:

1. No menu ou na Visão Geral, abra **Código de Sincronização (Celular ↔ PC)**.
2. Gere e copie o código no aparelho de origem e cole no aparelho de destino (ou use **Exportar / Importar Backup JSON** em **Configurações**).

---

## 6. Para o Administrador: Ativar Login Real com Google

Para habilitar o botão **Continuar com Google** para todos os usuários no GitHub Pages:

1. **Opção A — Supabase Auth (recomendada, com banco na nuvem)**:
   - Crie um projeto no Supabase, execute `supabase/schema.sql` e ative o provedor **Google** em *Authentication → Providers* com a URL de redirecionamento `https://egoncalvess.github.io/painel-vagas/`.
   - Preencha `url` e `anon` (chave pública `anon`, nunca a `service_role`) em `docs/supabase-config.js`.
2. **Opção B — Google Identity Services (somente login Google)**:
   - Crie um **OAuth 2.0 Client ID (Web)** no Google Cloud Console autorizando a origem `https://egoncalvess.github.io`.
   - Preencha `googleClientId` em `docs/supabase-config.js`.