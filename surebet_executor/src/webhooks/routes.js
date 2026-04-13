// T013 - Webhook routes: POST /webhooks/surebet/ou
import { webhookPostSchema } from './schemas.js';
import { handleSurebetWebhook } from './handlers.js';

/**
 * Fastify plugin registering webhook routes.
 * Prefix is applied by the caller (e.g. '/webhooks').
 */
export async function webhookRoutes(fastify) {
  fastify.post('/surebet/ou', {
    schema: webhookPostSchema,
    handler: handleSurebetWebhook,
  });
}
