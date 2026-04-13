// Execution status routes: GET /auto-order/executions/:executionId
import { getExecution } from '../services/executionLogService.js';

export async function executionRoutes(fastify) {
  fastify.get('/executions/:executionId', {
    schema: {
      params: {
        type: 'object',
        required: ['executionId'],
        properties: { executionId: { type: 'string' } },
      },
    },
    handler: async (request, reply) => {
      const { executionId } = request.params;
      const record = getExecution(executionId);
      if (!record) {
        return reply.code(404).send({ error_code: 'NOT_FOUND', message: `Execution ${executionId} not found` });
      }
      return reply.send(record);
    },
  });
}
