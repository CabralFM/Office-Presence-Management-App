# Presença — escritório vs. home office

Aplicação web (PWA) para controlar os dias em que você trabalha **no escritório** e **em casa**, e garantir a regra da empresa:

- **≥ 50% dos dias trabalhados no escritório**, medido por **semestre** (jan–jun e jul–dez);
- **máximo de 60 dias em home office por semestre**;
- considerando os **feriados do local de trabalho** (nacionais, regionais, municipais e pontos facultativos) — inclusive quando você trabalha num escritório da empresa **em outro país**.

## O que a aplicação faz

| Funcionalidade | Como funciona |
|---|---|
| **Registro diário** | Botões 🏢 Escritório / 🏠 Casa / 🌴 Ausência no painel, ou toque em qualquer dia no calendário. |
| **Lembrete até responder** | Notificação push às 09:00 (configurável), de seg a sex, **repetida a cada 30 min até você responder** (ou até às 18:00). A notificação tem botões: você responde sem abrir a app. Não dispara em feriados nem em dias já respondidos. |
| **Check-in por localização (opcional)** | Você define o endereço do escritório e uma janela (ex.: 09:00–10:30). Dentro da janela, ao tocar no lembrete/abrir a app, a localização é lida **uma única vez**, a distância é calculada **no seu aparelho** e a app pergunta: *"Você está a 120 m do escritório. Confirma que está no escritório?"*. As coordenadas não são enviadas ao servidor; fora da janela ou depois de responder, a localização não é usada. |
| **Regra dos 50% + teto de 60 dias** | Calcula as duas metas e aplica a **mais exigente** (ver exemplo abaixo). |
| **Avisos antecipados** | "Outubro fechou com 38% (abaixo de 50%)", "Para novembro cumprir a cota, vá mais 10 dos 17 dias úteis; para recuperar o atraso o ideal são 12", "Restam apenas 8 dias de home office", "Há 2 dias sem registro". |
| **Planejamento** | Distribui os dias de escritório que faltam pelas semanas/meses restantes (semanas com feriado pedem menos). Botão "Sugerir plano automático" preenche as próximas 4 semanas, preferindo ter–qui. |
| **Resumos** | Push no 1º dia útil da semana (recomendação da semana) e no 1º dia útil do mês (resultado do mês anterior + meta do mês). |
| **Escritórios** | Cadastre cada escritório (ex.: Lisboa, Madrid, São Paulo) com país, região, fuso, endereço e feriados municipais. Um deles é o **principal**. |
| **Feriados por local de trabalho** | Cada dia usa o calendário do escritório onde você trabalha nesse dia. Brasil e Portugal: cálculo próprio (inclui móveis e facultativos). Outros ~200 países e regiões: biblioteca `date-holidays`, offline. Municipais: editáveis, com modelos (Lisboa, Almada, Porto, Seixal, Sintra, Madrid, São Paulo…). Aba Calendário → "Feriados do semestre" mostra cada feriado e de que escritório vem. |
| **Viagens de trabalho** | Registre "Madrid, 08 a 12/06": nesses dias valem os feriados **e o fuso** de Madrid, os dias úteis contam como "planejado escritório" e o lembrete chega às 9h locais. |
| **Perguntar quando muda o local** | (1) Se o fuso do aparelho for diferente do escritório previsto, a app pergunta *"Você está trabalhando em outro local?"* e pré-preenche a viagem. (2) Ao registrar "Escritório" escolhe-se em qual. (3) O check-in por localização reconhece **qual** escritório está mais perto e avisa se não for o previsto. (4) O resumo semanal pergunta se vai trabalhar em outro escritório. |
| **Férias/ausências** | Marcar "Ausência" (passado) ou planejar "Ausência" (futuro) **retira o dia da base** — as metas são recalculadas. |
| **Exportar** | CSV com todos os registros (para conferência com o RH ou backup). |

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

## As regras, com números reais

**2º semestre de 2026, Brasil (sem feriados municipais):**

```
Dias de seg a sex (jul–dez)                    132
− feriados em dia útil: 07/09, 12/10, 02/11,
  20/11 (Consciência Negra), 25/12              −5
= dias úteis                                   127

Regra 1 — 50% no escritório:  ceil(127 × 0,5) = 64 dias
Regra 2 — máx. 60 em casa:    127 − 60        = 67 dias
Meta efetiva (a mais exigente):                 67 dias no escritório
```

Ou seja: os "60 dias = 50%" só batem exatamente num semestre de 120 dias úteis. Num semestre de 127, o teto de 60 dias em casa exige **3 dias a mais** no escritório do que os 50%. A app mostra no painel qual regra está valendo. Se tirar 10 dias de férias, a base cai para 117 e a meta passa a 59 (aí vale a regra dos 50%).

> Se a sua empresa interpretar a regra de outra forma (ex.: só os 50%), ajuste em **Ajustes → Regra da empresa** (por exemplo, coloque o máximo de dias em casa = 200 para ignorar o teto).

**Como o "ritmo necessário" é calculado:** `dias de escritório que faltam ÷ dias úteis ainda por decidir`. Ex.: faltam 28 dias e restam 41 dias úteis → 68% → ≈ 3,4 dias por semana. O estado fica:

- **Em dia** — ritmo necessário ≤ ritmo base do semestre (+2 p.p.);
- **Atenção** — até 20 p.p. acima;
- **Crítico** — mais do que isso;
- **Meta inalcançável** — nem indo todos os dias restantes se chega lá.

## Arquitetura (e por quê)

```
presenca-app/
├── src/
│   ├── core/              ← regras puras, sem I/O (testáveis)
│   │   ├── dates.js         datas ISO, semestres, fuso horário, Páscoa
│   │   ├── holidays.js      feriados BR/PT + outros países (date-holidays) + modelos de cidades
│   │   ├── offices.js       escritórios, viagens, "que calendário vale em cada dia"
│   │   ├── compliance.js    metas, ritmo, meses, semanas, avisos
│   │   └── geo.js           distância (Haversine) — também usado no navegador
│   ├── reminders/
│   │   ├── scheduler.js     decide() puro: "o que enviar agora?"
│   │   ├── runner.js        roda a cada 30 s e executa as decisões
│   │   └── push.js          Web Push (VAPID)
│   ├── db.js                SQLite nativo do Node (node:sqlite)
│   ├── service.js           relatórios + textos das notificações
│   └── server.js            API REST (Express) + arquivos estáticos
├── public/                ← PWA sem framework nem build
│   ├── index.html, app.js, styles.css
│   ├── sw.js                service worker: push + botões da notificação + offline
│   └── manifest.webmanifest
└── test/                  ← node:test (31 testes)
```

- **Por que um servidor e não só uma página?** Para um lembrete chegar às 9h *com a app fechada*, alguém tem de enviar o push nessa hora. Navegadores não permitem que uma página "acorde sozinha" de forma confiável. O servidor envia; o service worker no seu celular/PC mostra.
- **Por que Web Push e não e-mail/WhatsApp?** Gratuito, sem contas de terceiros e com **botões de resposta** na própria notificação.
- **Por que SQLite?** Uma app pessoal tem ~250 registros/ano. Um arquivo único é zero configuração e o backup é copiar `data/presenca.db`.
- **Por que feriados calculados e não uma API?** Funciona offline, sem depender de serviço externo, e permite planejar semestres futuros. Para os outros países usamos `date-holidays`, que também traz os dados no pacote (sem chamadas de rede).
- **Por que o fuso do aparelho como sinal de viagem?** Não precisa de GPS nem de permissão, e é exatamente o que muda quando você atravessa uma fronteira com fuso diferente. Como não pega viagens no mesmo fuso (ex.: Lisboa → Londres), há também a escolha do escritório no registro e a detecção pela localização.
- **Por que a viagem não grava "escritório" nos dias?** Ela só os conta como *planejados*. Se apagar ou alterar a viagem, nada fica para trás, e o registro real continua sendo a sua resposta diária.
- **Por que a localização só no navegador?** Privacidade: o servidor nunca vê onde você está — só o resultado ("escritório"/"casa") e a distância arredondada. E é leitura única (`getCurrentPosition`), nunca rastreio contínuo.
- **Por que o fuso horário é configurado?** Servidores na nuvem rodam em UTC. Sem isto, o "lembrete das 9h" chegaria às 6h em São Paulo.

## Executar localmente

Requer **Node.js 22.13+** (por causa do `node:sqlite`).

```bash
cd presenca-app
npm install
npm test          # 31 testes: regras, feriados, escritórios/viagens e lembretes
npm start         # http://localhost:3000
```

Em `localhost` as notificações e a localização funcionam no Chrome/Edge/Firefox sem HTTPS.

## Publicar (para receber lembretes no celular)

Push e geolocalização **exigem HTTPS**. Opções simples:

1. **Docker** em qualquer VPS (com Caddy/Nginx fornecendo HTTPS):
   ```bash
   docker build -t presenca .
   docker run -d -p 3000:3000 -v presenca-data:/app/data \
     -e APP_PASSWORD='uma-senha-forte' -e VAPID_SUBJECT='mailto:voce@exemplo.com' presenca
   ```
2. **Render / Railway / Fly.io**: aponte para esta pasta, comando `npm start`, e **adicione um disco persistente montado em `/app/data`** (senão perde os dados a cada deploy).

Variáveis de ambiente (ver `.env.example`):

| Variável | Para quê |
|---|---|
| `APP_PASSWORD` | **Defina sempre que publicar na internet.** Protege a API com login. |
| `PORT` | Porta HTTP (padrão 3000). |
| `DB_FILE` | Caminho do banco (padrão `data/presenca.db`). |
| `VAPID_SUBJECT` | Contato exigido pelo protocolo Web Push (`mailto:...`). |

### No celular

- **Android (Chrome):** abra o site → menu ⋮ → *Instalar app* → **Ajustes → Ativar notificações**.
- **iPhone (iOS 16.4+):** abra no Safari → *Compartilhar → Adicionar à Tela de Início* → abra pelo ícone → **Ajustes → Ativar notificações**. (No iPhone, push só funciona com a app instalada na tela de início.)

Depois toque em **Enviar teste** para confirmar.

## Limitações conhecidas

- A localização **não é verificada em segundo plano**: o navegador não permite que uma página leia o GPS com a app fechada. Por isso o fluxo é "lembrete → toca → lê uma vez → confirma". (Isto também é o comportamento mais respeitador da privacidade.)
- Feriados municipais dependem da cidade: use os modelos como ponto de partida e confira com o RH. Para países que não sejam Brasil/Portugal, confira também os regionais (a biblioteca cobre regiões, mas não todos os municípios).
- O aviso de fuso diferente não detecta viagens a países no mesmo fuso (ex.: Lisboa ↔ Londres). Para esses casos, registre a viagem ou escolha o escritório ao responder.
- Aplicação de **um único usuário** (os seus dados). Para vários colegas, cada um publica sua própria instância — ou seria preciso adicionar contas de usuário.
