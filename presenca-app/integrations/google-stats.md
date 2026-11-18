# Estatísticas de uso numa planilha Google sua (grátis)

Com isto você passa a saber, numa planilha do **seu** Google Drive:

- quantas pessoas instalaram/registraram a app (e quantas concluíram o assistente inicial);
- quantas a usam **hoje**, nos **últimos 7 dias** e nos **últimos 30 dias**;
- com que **frequência**: quase todos os dias úteis, regularmente, de vez em quando, ou **só uma vez** (e não voltaram);
- a **retenção** (dos que começaram há 7+ ou 30+ dias, quantos continuam a usar);
- de que **países**, em que **idiomas**, com que **regras** e em que **aparelhos** (Android/iPhone/computador);
- um **gráfico** dos aparelhos ativos e novos por dia nos últimos 60 dias.

**Custo: zero.** Usa o *Google Apps Script* da sua conta (o mesmo tipo de script da cópia de segurança). Não precisa de servidor, cartão nem "Google Cloud".

## Como funciona e o que é enviado

- Cada pessoa vê **uma pergunta** (no assistente inicial, ou num cartão no Painel): *"Quer ajudar a melhorar a app partilhando estatísticas anónimas de uso?"*. **Nada vem pré-marcado.** Quem responder "Não" nunca envia nada.
- Quem responder "Sim" recebe um **código aleatório** (ex.: `304c9c5a-…`), que não tem relação com o nome ou o e-mail da pessoa. No máximo **uma vez por dia**, ao abrir a app, ela envia:

  | Campo | Exemplo | Para quê |
  |---|---|---|
  | código do aparelho | `304c9c5a-f9c9-…` | contar pessoas sem saber quem são |
  | dia | `2026-11-18` | frequência de uso |
  | primeiro dia | `2026-11-02` | novos utilizadores, retenção |
  | versão da app | `2.1` | saber se atualizaram |
  | idioma | `pt-PT` | que traduções importam |
  | país do escritório | `PT` | onde a app é usada |
  | regra | `week3`, `pct50-semester` | que modelos de regra usam |
  | período | `semester` | idem |
  | aparelho | `android` / `ios` / `desktop` | onde testar |
  | instalada / concluiu o assistente | `sim` / `não` | quem "se registrou" de facto |

- **Nunca** são enviados: nome, e-mail, presenças, ausências, localização, empresa, endereço. O IP também não chega ao script (o Google não o entrega ao Apps Script).
- A pessoa pode **desligar** quando quiser (*Ajustes → Sobre e privacidade*). Ao desligar, a app pede à planilha que **apague tudo** desse código.
- Dados com mais de **~13 meses** são apagados automaticamente.

> **RGPD (lembrete honesto):** ao recolher estas estatísticas, você é o *responsável pelo tratamento*. Os dados são pseudónimos e recolhidos com consentimento explícito, que é a base mais segura. Não cruze a planilha com outras informações para identificar pessoas, e não a partilhe publicamente. Se alguém lhe pedir para apagar os dados, peça-lhe o código que aparece em *Ajustes* e apague as linhas com esse código (ou peça-lhe para desligar as estatísticas, que apaga tudo sozinho).

## 1. Criar a planilha e o script (≈5 min, num computador)

1. Abra <https://sheets.new> (cria uma planilha Google nova) e dê-lhe o nome **Presença — estatísticas**.
2. Menu **Extensões → Apps Script**.
3. Apague o conteúdo do editor e **cole todo o código** do arquivo [`google-stats.gs`](google-stats.gs). No GitHub, use o botão "Copy raw file".
4. Clique em 💾 **Salvar**.
5. No topo do editor, escolha a função **`configurar`** e clique em **▶ Executar**.
6. O Google pede autorização:
   - escolha a sua conta;
   - aparece **"O Google não verificou este app"**: é normal, porque o script é seu e não foi publicado;
   - **Avançado → Acessar (não seguro) → Permitir**.

   O ecrã de permissões diz que o script quer acesso **só a esta planilha** (e a criar o acionador diário): não pede Gmail nem Drive. Cria as abas *Resumo*, *Aparelhos* e *Atividade* e um acionador que atualiza o *Resumo* todos os dias às 6h.

## 2. Publicar como "App da Web"

1. **Implantar → Nova implantação** → ⚙️ **App da Web**.
2. Preencha:
   - **Executar como:** *Eu*
   - **Quem pode acessar:** **Qualquer pessoa**
3. **Implantar** e copie o **URL do app da Web** (termina em **`/exec`**).

> "Qualquer pessoa" é necessário para os celulares conseguirem enviar sem login. O endereço fica visível no código da app, por isso o script **só aceita** pacotes no formato exato (código válido, dia de hoje, campos da lista acima), conta cada aparelho **uma vez por dia** e aceita no máximo **500 aparelhos novos por dia**. Isso limita o estrago se alguém tentar enviar dados falsos.

### É seguro "Qualquer pessoa"? (sim — o que isso permite e o que não permite)

O endereço `/exec` **não é uma senha nem uma porta para a sua conta**. É como o botão "enviar" de um formulário: quem o tiver só consegue fazer **o que o código do script faz**, e nada mais.

| Alguém com o endereço `/exec`… | Consegue? | Porquê |
|---|---|---|
| ver ou mexer no seu Gmail, Drive, Docs ou outras planilhas | **Não** | O script só tem autorização para **esta** planilha (`@OnlyCurrentDoc` — o ecrã de permissões do Google mostra isso). E o código não tem nenhuma função que o faça. |
| ler a planilha de estatísticas | **Não** | O script só responde "ok" ou "erro"; nunca devolve dados. A planilha continua **privada** (não a partilhe). |
| ver ou alterar o código do script | **Não** | O código só se edita entrando na **sua** conta Google. O endereço só "executa". |
| entrar na sua conta Google ou no seu GitHub | **Não** | A autorização fica guardada no Google; quem chama o endereço nunca a recebe. O repositório não tem nenhuma senha sua. |
| apagar linhas | **Só as de um aparelho cujo código completo conheça** | Os códigos são aleatórios (36 caracteres, impossíveis de adivinhar). A app só mostra os primeiros 8. |
| enviar estatísticas **falsas** | **Sim, com limites** | É o único risco real, e é o mesmo de qualquer site que recebe dados. O script aceita só o formato exato e o dia de hoje, conta cada aparelho 1×/dia, no máximo 500 aparelhos novos e 20 000 pedidos por dia. No pior caso, os números ficam "sujos" até apagar essas linhas — nada mais é afetado. Não há custos: o Apps Script grátis não cobra; se o teto for atingido, o script só recusa pedidos até ao dia seguinte. |

**Porquê "Executar como: Eu"?** A alternativa ("usuário que acessa") obrigaria cada pessoa a entrar com uma conta Google e a autorizar o script — ninguém usaria. "Eu" significa que o script grava na **sua** planilha em seu nome, mas **só** o que o código manda.

**Quer ainda mais isolamento?** Crie a planilha numa **conta Gmail nova, só para isto** (grátis). Assim, mesmo num cenário improvável, a sua conta principal nunca está envolvida.

## 3. Ligar na app publicada (GitHub, sem mexer em código)

1. No GitHub, abra o repositório **Office-Presence-Management-App** → **Settings** → **Secrets and variables** → **Actions** → separador **Variables** → **New repository variable**.
2. Preencha:
   - **Name:** `PRESENCA_STATS_URL`
   - **Value:** o URL copiado no passo 2 (`https://script.google.com/macros/s/…/exec`)
3. **Add variable**.
4. Separador **Actions** → **Publicar Presença (GitHub Pages)** → **Run workflow** → **Run workflow**. Em ~2 min a app publicada passa a fazer a pergunta.

Para **parar** de recolher: apague a variável e corra de novo o *Run workflow*. A app deixa de perguntar e de enviar.

## 4. Ver os números

Abra a planilha → aba **Resumo**. É atualizada sozinha todos os dias às 6h; para atualizar já, use o menu **📊 Presença → Atualizar resumo agora**.

| No Resumo | Significado |
|---|---|
| Aparelhos registados | aparelhos que aceitaram as estatísticas e abriram a app pelo menos uma vez |
| Concluíram o assistente | configuraram a app (país, regra…) |
| Instalaram na tela inicial | usam como app (ícone), não só no navegador |
| Ativos hoje / 7 / 30 dias | abriram a app nesse intervalo |
| Quase todos os dias úteis | 16 ou mais dias com a app aberta nos últimos 30 |
| Usaram só uma vez e não voltaram | só têm 1 dia de uso, e não foi hoje |
| Retenção | dos que começaram há 7+ (ou 30+) dias, % que ainda usam |

## Limitações (para ler os números com cuidado)

- **Só conta quem aceitou.** Quem respondeu "Não" (ou ainda não respondeu) não aparece. Os números são um **mínimo**.
- Uma pessoa com **dois aparelhos** conta duas vezes. Quem **limpa os dados** do navegador, ou reinstala sem restaurar a cópia, aparece como aparelho novo. Quem restaura a cópia de segurança mantém o mesmo código.
- "Usar" = **abrir a app** nesse dia. Um aparelho conta no máximo uma vez por dia.
- Se alterar o código do script, faça **Implantar → Gerenciar implantações → ✏️ → Versão: Nova versão → Implantar**. O URL mantém-se.
