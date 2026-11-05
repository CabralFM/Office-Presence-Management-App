# Presença — escritório vs. home office

Aplicação web (PWA) para controlar os dias em que você trabalha **no escritório** e **em casa**, e garantir a regra da empresa:

- **regra mãe: ≥ 50% dos dias úteis trabalháveis do semestre no escritório** (jan–jun e jul–dez);
- férias, doença e outras ausências **saem da base** (com tipo e justificação), e os 50% aplicam-se ao que sobra;
- o "máximo de 60 dias em casa" é tratado como o equivalente aos 50% — opcionalmente pode ser aplicado como teto rígido;
- considerando os **feriados do local de trabalho** (nacionais, regionais, municipais e pontos facultativos) — inclusive quando você trabalha num escritório da empresa **em outro país**.

**Custo: zero.** Por padrão a app funciona **sem servidor**: tudo roda no celular, os dados ficam no aparelho e o site é publicado de graça (GitHub Pages ou Cloudflare Pages). Ver [Usar no celular, de graça](#usar-no-celular-de-graça-sem-servidor). Existe também um modo servidor opcional (pago), só para quem quiser notificações push "até responder".

| | **Modo local (grátis, padrão)** | Modo servidor (opcional, ~5 US$/mês) |
|---|---|---|
| Regras, feriados, ausências, viagens, planejamento, avisos | ✅ | ✅ |
| Funciona sem internet | ✅ | ❌ |
| Onde ficam os dados | só no seu celular | no servidor |
| Lembrete das 9h | pelo **calendário do celular** (sem feriados/férias) | notificação push |
| Repetir "até responder" | ❌ (o calendário toca até 3 vezes, mesmo que já tenha respondido) | ✅ |
| Responder pelo botão da notificação | ❌ (toca e abre a app) | ✅ |
| Vários aparelhos com os mesmos dados | ❌ (use a cópia de segurança para mudar de celular) | ✅ |

## O que a aplicação faz

| Funcionalidade | Como funciona |
|---|---|
| **Registro diário** | Botões 🏢 Escritório / 🏠 Casa / 🌴 Ausência no painel, ou toque em qualquer dia no calendário. |
| **Lembrete diário** | *Modo local:* a app gera os lembretes no **calendário do celular** (arquivo `.ics` com um evento por dia útil até ao fim do semestre, já sem feriados, férias e dias respondidos, com alertas às 9h, 9h30 e 10h), ou um evento recorrente no Google Agenda. *Modo servidor:* notificação push às 09:00 repetida a cada 30 min **até você responder**, com botões 🏢/🏠 na própria notificação. |
| **Check-in por localização (opcional)** | Você define o endereço do escritório e uma janela (ex.: 09:00–10:30). Dentro da janela, ao tocar no lembrete/abrir a app, a localização é lida **uma única vez**, a distância é calculada **no seu aparelho** e a app pergunta: *"Você está a 120 m do escritório. Confirma que está no escritório?"*. As coordenadas não são enviadas ao servidor; fora da janela ou depois de responder, a localização não é usada. |
| **Regra dos 50%** | Mínimo no escritório = 50% dos dias trabalháveis (arredondado para cima). Teto absoluto de dias em casa: opcional, desligado por padrão (ver abaixo). |
| **Avisos antecipados** | "Outubro fechou com 38% (abaixo de 50%)", "Para novembro cumprir a cota, vá mais 10 dos 17 dias úteis; para recuperar o atraso o ideal são 12", "Restam apenas 8 dias de home office", "Há 2 dias sem registro". |
| **Planejamento** | Distribui os dias de escritório que faltam pelas semanas/meses restantes (semanas com feriado pedem menos). Botão "Sugerir plano automático" preenche as próximas 4 semanas, preferindo ter–qui. |
| **Resumos** | Os avisos do painel mostram sempre a situação do mês e do semestre. No modo servidor, também chegam por push no 1º dia útil da semana e do mês. |
| **Escritórios** | Cadastre cada escritório (ex.: Lisboa, Madrid, São Paulo) com país, região, fuso, endereço e feriados municipais. Um deles é o **principal**. |
| **Feriados por local de trabalho** | Cada dia usa o calendário do escritório onde você trabalha nesse dia. Brasil e Portugal: cálculo próprio (inclui móveis e facultativos). Outros ~200 países e regiões: biblioteca `date-holidays`, offline. Municipais: editáveis, com modelos (Lisboa, Almada, Porto, Seixal, Sintra, Madrid, São Paulo…). Aba Calendário → "Feriados do semestre" mostra cada feriado e de que escritório vem. |
| **Viagens de trabalho** | Registre "Madrid, 08 a 12/06": nesses dias valem os feriados **e o fuso** de Madrid, os dias úteis contam como "planejado escritório" e o lembrete chega às 9h locais. |
| **Perguntar quando muda o local** | (1) Se o fuso do aparelho for diferente do escritório previsto, a app pergunta *"Você está trabalhando em outro local?"* e pré-preenche a viagem. (2) Ao registrar "Escritório" escolhe-se em qual. (3) O check-in por localização reconhece **qual** escritório está mais perto e avisa se não for o previsto. (4) O resumo semanal pergunta se vai trabalhar em outro escritório. |
| **Férias e ausências** | Tipos: 🌴 Férias, 🤒 Doença, 📄 Licença (parental, casamento, luto…), 🛌 Folga/compensação, 📝 Outra. Registra-se um **período** (ex.: 03 a 14/08) e só os dias úteis contam. **Justificação obrigatória** em todos menos férias (ex.: "Atestado médico nº 4521"). A app avisa ausências sem justificação, não apaga dias já registrados como escritório/casa sem confirmação, e permite editar/remover o período. A justificação vai no CSV exportado. |
| **Exportar** | CSV com todos os registros (para conferência com o RH). |
| **Cópia de segurança** | *Modo local:* exporta/importa todos os dados num arquivo `.json` (para guardar no Drive/iCloud ou passar para um celular novo). |

## Feriados: de onde vêm, em cada dia

Os feriados seguem o **local de trabalho**, não a morada. Para decidir o escritório de um dia, a app usa, por ordem:

1. o escritório que você **registrou** nesse dia ("estive no escritório de Madrid");
2. uma **viagem de trabalho** que cubra a data;
3. o escritório **principal**.

Exemplo (mora em Almada, trabalha em Lisboa, viaja a Madrid):

| Data (2026) | Sem viagem | Em viagem a Madrid |
|---|---|---|
| 13/06 — Santo António (municipal de **Lisboa**) | feriado *(cai num sábado em 2026)* | — |
| 24/06 — São João (municipal de **Almada**) | **dia útil** (você não trabalha em Almada) | — |
| 10/06 — Dia de Portugal | feriado | **dia útil** (está trabalhando em Madrid) |
| 15/05 — San Isidro (municipal de **Madrid**) | dia útil | **feriado** |
| 02/11 — Finados (só no Brasil) | dia útil em Lisboa | — |

Num dia de home office em Almada vale o calendário de Lisboa, porque é lá o seu local de trabalho.

## A regra mãe, com números reais

**Mínimo no escritório = 50% dos dias úteis trabalháveis do semestre**, arredondado para cima.

```
dias úteis         = seg–sex do semestre − feriados do local de trabalho
dias trabalháveis  = dias úteis − ausências (férias, doença, licenças, folgas…)
mínimo escritório  = ⌈ dias trabalháveis × 50% ⌉
```

**2º semestre de 2026, escritório em Lisboa:**

```
Dias de seg a sex (jul–dez)                               132
− feriados em dia útil: 05/10, 01/12, 08/12, 25/12          −4
= dias úteis                                               128

Sem ausências:        128 trabalháveis → mínimo 64 no escritório (até 64 em casa)
Com 10 dias de férias
 + 3 dias de doença:  115 trabalháveis → mínimo 58 no escritório (até 57 em casa)
```

As ausências reduzem a base, mas a **percentagem mantém-se**: continua a ser preciso estar no escritório em metade dos dias em que efetivamente trabalhou. Repare que, com 13 dias de ausência, os dias em casa possíveis descem de 64 para 57. As ausências não "poupam" dias de casa.

**E os 60 dias de home office?** Em semestres de cerca de 120 dias trabalháveis, 60 dias equivalem aos 50%. Por isso, por padrão, a app aplica só a regra mãe. Se a empresa contar os 60 dias de forma rígida *além* dos 50%, ligue **Ajustes → Aplicar também um teto absoluto**. Só faz diferença em semestres longos: com 128 dias trabalháveis passa a exigir 128 − 60 = 68 dias no escritório em vez de 64, e a app indica quando isso acontece.

**Como o "ritmo necessário" é calculado:** `dias de escritório que faltam ÷ dias úteis ainda por decidir`. Ex.: faltam 28 dias e restam 41 dias úteis → 68% → ≈ 3,4 dias por semana. O estado fica:

- **Em dia** — ritmo necessário ≤ ritmo base do semestre (+2 p.p.);
- **Atenção** — até 20 p.p. acima;
- **Crítico** — mais do que isso;
- **Meta inalcançável** — nem indo todos os dias restantes se chega lá.

## Arquitetura (e por quê)

```
presenca-app/
├── src/
│   ├── core/              ← regras puras, sem I/O — correm no SERVIDOR e no CELULAR
│   │   ├── api.js           a "API" como função: handle(método, caminho, corpo)
│   │   ├── compliance.js    metas, ritmo, meses, semanas, avisos
│   │   ├── dates.js         datas ISO, semestres, fusos horários, Páscoa
│   │   ├── holidays.js      feriados BR/PT + outros países (date-holidays) + modelos de cidades
│   │   ├── offices.js       escritórios, viagens, "que calendário vale em cada dia"
│   │   ├── absences.js      tipos de ausência e regras de justificação
│   │   ├── days.js          gravação de um dia, agrupamento de ausências
│   │   ├── report.js        relatório do semestre, "agora" no fuso do escritório
│   │   ├── local-repo.js    armazenamento no celular (localStorage) + cópia de segurança
│   │   ├── calendar.js      lembretes .ics / Google Agenda (modo local)
│   │   ├── export.js        CSV
│   │   └── geo.js           distância (Haversine)
│   ├── db.js                SQLite (modo servidor)
│   ├── server.js            modo servidor: login, push, encaminha para core/api.js
│   └── reminders/           modo servidor: agendador e envio de push
├── public/                ← a PWA
│   ├── app.js               interface (igual nos dois modos)
│   ├── config.js            MODE = 'local' (o servidor substitui por 'server')
│   ├── local-backend.js     liga a interface a core/api.js dentro do celular
│   └── sw.js                service worker: offline (+ push no modo servidor)
├── scripts/build-static.mjs ← gera o site estático em dist/ (esbuild)
└── test/                  ← node:test (48 testes, incluindo o modo local)
```

- **Por que funciona sem servidor?** Todas as regras são funções puras em `src/core/`. No modo local, a interface chama `core/api.js` diretamente dentro do celular, com os dados no armazenamento do navegador. No modo servidor, o Express chama exatamente a mesma função. Por isso os dois modos se comportam igual e os mesmos testes cobrem ambos.
- **Por que lembretes pelo calendário (modo local)?** Sem servidor, nada consegue "acordar" uma app web às 9h com o celular bloqueado. O calendário do celular faz isso de graça e de forma confiável. A app gera um evento por dia útil já sem feriados (do escritório de cada dia), férias e ausências, à hora certa no fuso de cada dia (inclusive em viagens).
- **Por que cópia de segurança?** Os dados existem só no aparelho. Limpar os dados do navegador, desinstalar a app ou trocar de celular apagaria tudo. O arquivo `.json` resolve isso.
- **Por que um único `app.js` de 1,5 MB?** Ele inclui os feriados de ~200 países (para as viagens). Comprimido são ~260 KB, baixados uma vez. Depois a app abre sem internet.
- **Por que feriados calculados e não uma API?** Funciona offline e permite planejar semestres futuros. Para os outros países usamos `date-holidays`, que traz os dados no pacote.
- **Por que o fuso do aparelho como sinal de viagem?** Não precisa de GPS nem de permissão. Não pega viagens no mesmo fuso (ex.: Lisboa → Londres), por isso também há a escolha do escritório no registro e a detecção pela localização.
- **Por que a localização só no aparelho?** Privacidade: as coordenadas nunca saem do celular, e é leitura única (`getCurrentPosition`), nunca rastreio contínuo.

## Usar no celular, de graça (sem servidor)

O site é só um conjunto de arquivos (HTML/JS/CSS). A hospedagem só os entrega na primeira vez; depois a app funciona sem internet e **os seus dados nunca saem do celular**. Duas opções gratuitas:

### Opção A — GitHub Pages (exige repositório público)

O GitHub Pages grátis só funciona em repositórios **públicos**. Só o **código** fica público. Os seus registros de presença ficam no celular e nunca vão para o GitHub.

1. Junte a branch da app à `master` (GitHub → *Pull requests* → *New* → *Merge*).
2. **Settings → General → Danger Zone → Change visibility → Public.**
3. **Settings → Pages → Source: GitHub Actions.**
4. Em **Actions**, o workflow *Publicar Presença* roda sozinho (ou clique em *Run workflow*). Em ~2 min a app fica em `https://cabralfm.github.io/Office-Presence-Management-App/` (o endereço exato aparece em **Settings → Pages**; use-o tal como está, com as maiúsculas).

### Opção B — Cloudflare Pages (o repositório continua privado)

1. Crie conta grátis em <https://dash.cloudflare.com> (não pede cartão).
2. **Workers & Pages → Create → Pages → Connect to Git →** autorize o GitHub e escolha `Office-Presence-Management-App`.
3. Configuração:
   - **Production branch:** `master` (ou a branch da app)
   - **Root directory:** `presenca-app`
   - **Build command:** `npm run build:static`
   - **Build output directory:** `dist`
4. **Save and Deploy.** A app fica em `https://<nome>.pages.dev`. Cada `git push` publica de novo.

(O Netlify também serve: o `netlify.toml` já está pronto; Base directory = `presenca-app`.)

### Instalar no celular

- **Android (Chrome):** abra o endereço → menu ⋮ → **Instalar app**.
- **iPhone (Safari, iOS 16.4+):** abra o endereço → **Compartilhar → Adicionar à Tela de Início**. Use sempre o ícone: no iPhone, os dados da app instalada são separados dos do Safari, e a app instalada não é apagada por inatividade.

### Configurar (uma vez)

1. **Ajustes → Escritórios:** edite o principal (país, modelo da cidade, endereço).
2. **Ajustes → Lembretes → 📅 Adicionar lembretes ao calendário:**
   - **iPhone:** abre a folha de partilha → escolha **Calendário** (ou abra o arquivo em *Arquivos*) → *Adicionar todos*.
   - **Android (Samsung/outros calendários):** abra o arquivo baixado com o app de calendário.
   - **Android com Google Agenda:** o app do Google Agenda não importa `.ics`. Use o botão **Google Agenda (recorrente)** (um toque), ou importe o `.ics` em <https://calendar.google.com> no computador (*Configurações → Importar*).
3. Gere de novo o arquivo de lembretes quando registrar férias ou viagens: os eventos têm identificadores fixos, por isso são atualizados em vez de duplicados.
4. **Ajustes → Cópia de segurança:** faça uma cópia de vez em quando e guarde-a no Drive/iCloud/e-mail.

### Testar no computador antes

```bash
cd presenca-app
npm install
npm run build:static
npm run preview:static     # http://localhost:4173/Office-Presence-Management-App/
```

## Modo servidor (opcional, pago)

Só é necessário se quiser notificações push que repetem **até responder** e com botões na notificação. Requer **Node.js 22.13+** (por causa do `node:sqlite`).

```bash
cd presenca-app
npm install
npm test          # 48 testes: regras, ausências, feriados, viagens, lembretes, API e modo local
npm start         # http://localhost:3000
```

Em `localhost` as notificações e a localização funcionam no Chrome/Edge/Firefox sem HTTPS.

### Publicar o modo servidor

Push e geolocalização **exigem HTTPS**, e o servidor tem de ficar **ligado 24 h** (é ele que envia o lembrete das 9h). Por isso, planos gratuitos que "adormecem" o servidor (ex.: Render free) **não servem**.

#### Railway (~5 US$/mês)

1. Crie conta em <https://railway.com> entrando com o GitHub.
2. **New Project → Deploy from GitHub repo →** `Office-Presence-Management-App`.
3. No serviço criado, em **Settings**:
   - **Source → Root Directory:** `presenca-app`
   - **Source → Branch:** `master` (depois de fazer merge do PR), ou a branch da app
   - **Networking → Generate Domain** → dá um endereço `https://….up.railway.app`
4. **Variables:** `APP_PASSWORD` = uma senha forte; `VAPID_SUBJECT` = `mailto:seu-email`.
5. **Volume:** clique com o botão direito no serviço → *Attach volume* → **Mount path** `/app/data`. *Sem isto, perde todos os dados a cada atualização.*
6. Espere o deploy ficar verde e abra o domínio: deve aparecer a tela de login.

#### Outras opções

1. **Docker** em qualquer VPS (com Caddy/Nginx fornecendo HTTPS):
   ```bash
   docker build -t presenca .
   docker run -d -p 3000:3000 -v presenca-data:/app/data \
     -e APP_PASSWORD='uma-senha-forte' -e VAPID_SUBJECT='mailto:voce@exemplo.com' presenca
   ```
2. **Fly.io** (ou outro PaaS sem "adormecer"): aponte para esta pasta, comando `npm start`, e **adicione um disco persistente montado em `/app/data`** (senão perde os dados a cada deploy).

Variáveis de ambiente (ver `.env.example`):

| Variável | Para quê |
|---|---|
| `APP_PASSWORD` | **Defina sempre que publicar na internet.** Protege a API com login. |
| `PORT` | Porta HTTP (padrão 3000). |
| `DB_FILE` | Caminho do banco (padrão `data/presenca.db`). |
| `VAPID_SUBJECT` | Contato exigido pelo protocolo Web Push (`mailto:...`). |

#### No celular (modo servidor)

- **Android (Chrome):** abra o site → menu ⋮ → *Instalar app* → **Ajustes → Ativar notificações**.
- **iPhone (iOS 16.4+):** abra no Safari → *Compartilhar → Adicionar à Tela de Início* → abra pelo ícone → **Ajustes → Ativar notificações**. (No iPhone, push só funciona com a app instalada na tela de início.)

Depois toque em **Enviar teste** para confirmar.

## Limitações conhecidas

- **Modo local:** os dados existem só num aparelho (sem sincronização). Use a cópia de segurança para guardar ou mudar de celular. Os lembretes do calendário não sabem se você já respondeu e não repetem "até responder".
- A localização **não é verificada em segundo plano**: o navegador não permite que uma página leia o GPS com a app fechada. Por isso o fluxo é "lembrete → toca → lê uma vez → confirma". (Isto também é o comportamento mais respeitador da privacidade.)
- Feriados municipais dependem da cidade: use os modelos como ponto de partida e confira com o RH. Para países que não sejam Brasil/Portugal, confira também os regionais (a biblioteca cobre regiões, mas não todos os municípios).
- O aviso de fuso diferente não detecta viagens a países no mesmo fuso (ex.: Lisboa ↔ Londres). Para esses casos, registre a viagem ou escolha o escritório ao responder.
- Ausências são por **dia inteiro**. Meio dia de férias ou consulta médica de manhã não são modelados: registre o dia como escritório/casa conforme onde trabalhou a maior parte do tempo, ou confirme com o RH como contam.
- A justificação é texto. Não há envio do documento (atestado em PDF/foto); guarde-o onde o RH pedir.
- Aplicação de **um único usuário**. No modo local, colegas podem usar o mesmo endereço: cada celular tem os seus próprios dados.
