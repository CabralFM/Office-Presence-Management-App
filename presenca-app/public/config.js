// Modo da app:
//   'local'  → sem servidor: tudo funciona no celular e os dados ficam no aparelho
//              (é o modo do site estático gratuito);
//   'server' → o servidor Node (src/server.js) substitui este arquivo ao servir a app.
export const MODE = 'local';

// Endereço (Google Apps Script) que recebe as estatísticas anónimas de uso — ver
// integrations/google-stats.md. Vazio = sem estatísticas (a app nem pergunta).
// No site publicado, vem do secret PRESENCA_STATS_URL do GitHub (scripts/build-static.mjs).
export const STATS_URL = '';
