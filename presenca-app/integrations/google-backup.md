# Cópia automática para o Google Drive + e-mail (grátis)

A app Presença guarda os dados **só no seu celular**. Esta configuração faz com que, uma vez por semana (ou por mês), a app envie uma cópia para a **sua** conta Google:

- 📁 arquivos `.json` (para restaurar) e `.csv` (para abrir no Excel/Sheets) numa pasta **"Presença — cópias de segurança"** do seu Google Drive;
- ✉️ (opcional) um e-mail para si, com os dois arquivos em anexo.

**Custo: zero.** Usa o *Google Apps Script*, que corre nos servidores do Google, na sua conta. Não precisa de cartão nem de "Google Cloud". Configura-se **uma vez, em ~5 minutos, num computador**.

> **Quando é enviada?** No primeiro acesso à app depois de vencer o prazo (7 dias, ou o 1º acesso de cada mês). Sem servidor, nada corre com a app fechada. Como a app é aberta quase todos os dias úteis, na prática a cópia sai sozinha.

## 1. Criar o script

1. Abra <https://script.google.com> com a sua conta Google → **Novo projeto**.
2. Dê-lhe o nome **Presença — cópias** (clique em "Projeto sem título", no topo).
3. Apague o conteúdo do editor e **cole todo o código** do arquivo [`google-backup.gs`](google-backup.gs). No GitHub, use o botão "Copy raw file".
4. Clique em 💾 **Salvar**.

## 2. Criar a chave secreta (e autorizar)

1. No topo do editor, escolha a função **`configurar`** e clique em **▶ Executar**.
2. O Google pede autorização:
   - escolha a sua conta;
   - aparece **"O Google não verificou este app"** (é normal: o script é seu e não foi publicado) → **Avançado → Acessar "Presença — cópias" (não seguro)** → **Permitir**.
3. Em baixo, no **Registro de execução**, aparece: `Chave secreta (copie para a app…): 1a2b3c…`. **Copie essa chave.**

O script pede acesso ao Drive (para criar a pasta e os arquivos) e ao Gmail (para enviar o e-mail a si próprio). O código só mexe na pasta "Presença — cópias de segurança".

## 3. Publicar como "App da Web"

1. **Implantar → Nova implantação** → ⚙️ (Selecionar tipo) → **App da Web**.
2. Preencha:
   - **Executar como:** *Eu (o seu e-mail)*
   - **Quem pode acessar:** **Qualquer pessoa**
3. **Implantar** → copie o **URL do app da Web** (termina em **`/exec`**).

> "Qualquer pessoa" é necessário para a app conseguir enviar a cópia sem pedir login a cada vez. Quem não tiver a chave secreta não consegue gravar nada: o script recusa.

## 4. Ligar na app

No celular, na app Presença: **Ajustes → Cópia de segurança → Cópia automática para o Google**:

1. Cole o **endereço** (`https://script.google.com/macros/s/…/exec`) e a **chave secreta**.
2. Deixe marcado **"Enviar também por e-mail"**, se quiser o e-mail.
3. Toque em **☁️ Enviar cópia para o Google agora**: deve aparecer "✅ Cópia guardada no Google Drive", e o e-mail chega em ~1 min.
4. **Salvar configurações.**

## Restaurar

Num celular novo, ou depois de limpar os dados: abra a app → **Ajustes → Cópia de segurança → 📂 Restaurar cópia** → escolha o `.json` mais recente (do Drive ou do e-mail).

## Problemas comuns

| Mensagem na app | O que fazer |
|---|---|
| "Chave secreta inválida" | Copie de novo a chave do passo 2 (sem espaços). |
| "Não foi possível contactar o script" | Confira o endereço (tem de terminar em `/exec`) e se a implantação tem **Qualquer pessoa**. Se alterar o código, faça **Implantar → Gerenciar implantações → editar → Nova versão**. |
| Não chega e-mail | Veja a pasta Spam; confirme que autorizou o Gmail no passo 2. |
