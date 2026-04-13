// T012 - Webhook payload schema validator (JSON Schema for Fastify)

export const surebetOpportunitySchema = {
  type: 'object',
  required: ['sport', 'market', 'scope', 'home', 'away', 'from_books', 'line', 'updated_at', 'bet'],
  properties: {
    opportunity_id: { type: 'string' },
    sport: { type: 'string', enum: ['football'] },
    market: { type: 'string', enum: ['OU'] },
    scope: { type: 'string', enum: ['FT'] },
    home: { type: 'string', minLength: 1 },
    away: { type: 'string', minLength: 1 },
    from_books: { type: 'string', minLength: 1 },
    line: { type: 'number' },
    profit_pct: { type: 'number' },
    updated_at: { type: 'string', format: 'date-time' },
    bet: {
      type: 'object',
      required: ['total_stake', 'profit_pct_calc', 'payout_equal', 'legs'],
      properties: {
        total_stake: { type: 'number', minimum: 0 },
        profit_pct_calc: { type: 'number' },
        payout_equal: { type: 'number' },
        legs: {
          type: 'array',
          minItems: 2,
          maxItems: 2,
          items: {
            type: 'object',
            required: ['type', 'odds', 'book', 'stake', 'label'],
            properties: {
              type: { type: 'string', enum: ['Over', 'Under'] },
              odds: { type: 'number', minimum: 1 },
              book: { type: 'string', minLength: 1 },
              stake: { type: 'number', minimum: 0 },
              label: { type: 'string' },
              team: { type: 'string', nullable: true },
            },
          },
        },
      },
    },
  },
};

export const webhookPostSchema = {
  body: surebetOpportunitySchema,
  response: {
    202: {
      type: 'object',
      properties: {
        execution_id: { type: 'string' },
        status: { type: 'string' },
        dedup: {
          type: 'object',
          properties: {
            is_duplicate: { type: 'boolean' },
            key: { type: 'string' },
          },
        },
        deadline_seconds: { type: 'integer' },
      },
    },
    400: { type: 'object', properties: { error_code: { type: 'string' }, message: { type: 'string' } } },
    409: { type: 'object', properties: { error_code: { type: 'string' }, message: { type: 'string' } } },
    422: { type: 'object', properties: { error_code: { type: 'string' }, message: { type: 'string' } } },
  },
};
