// Output grammar complements semantic validation; it never replaces evidence checks.
export function knowledgeSchema(evidenceIds: string[]) {
  const text = (maxLength: number) => ({ type: 'string', minLength: 1, maxLength });
  const array = (items: unknown, maxItems: number, minItems = 0) => ({
    type: 'array',
    items,
    minItems,
    maxItems,
  });
  const object = (properties: Record<string, unknown>) => ({
    type: 'object',
    properties,
    required: Object.keys(properties),
    additionalProperties: false,
  });
  const evidence = array({ type: 'string', enum: evidenceIds }, 12, 1);
  return object({
    title: text(100),
    summary: text(3000),
    domains: array(object({ id: text(80), title: text(100), description: text(1500) }), 8, 1),
    nodes: array(
      object({
        id: text(80),
        domain: text(80),
        kind: { type: 'string', enum: ['actor', 'process', 'data', 'store', 'outcome'] },
        title: text(100),
        description: text(2000),
        fields: array(text(1500), 12),
        evidence,
      }),
      32,
      2,
    ),
    edges: array(
      object({
        id: text(80),
        source: text(80),
        target: text(80),
        kind: {
          type: 'string',
          enum: ['triggers', 'reads', 'writes', 'transforms', 'produces', 'transfers'],
        },
        label: text(80),
        data: text(500),
        description: text(1500),
        evidence,
      }),
      64,
      1,
    ),
    limitations: array(text(1500), 12),
  });
}
