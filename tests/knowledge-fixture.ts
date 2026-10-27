export function knowledgeFixture(evidence: string) {
  const refs = [evidence];
  return {
    title: '订单与收款',
    summary: '订单在创建与支付之间流转。',
    domains: [
      { id: 'orders', title: '订单管理', description: '维护订单' },
      { id: 'payments', title: '收款管理', description: '处理支付' },
    ],
    nodes: [
      {
        id: 'create',
        domain: 'orders',
        kind: 'process',
        title: '创建订单',
        description: '校验并保存订单',
        fields: [],
        evidence: refs,
      },
      {
        id: 'order',
        domain: 'orders',
        kind: 'data',
        title: '订单',
        description: '共享订单记录',
        fields: ['id', 'status'],
        evidence: refs,
      },
      {
        id: 'pay',
        domain: 'payments',
        kind: 'process',
        title: '处理支付',
        description: '读取订单并更新付款状态',
        fields: [],
        evidence: refs,
      },
    ],
    edges: [
      {
        id: 'save',
        source: 'create',
        target: 'order',
        kind: 'writes',
        label: '保存',
        data: '订单记录',
        description: '保存新订单',
        evidence: refs,
      },
      {
        id: 'read',
        source: 'order',
        target: 'pay',
        kind: 'reads',
        label: '读取',
        data: '待支付订单',
        description: '读取待支付订单',
        evidence: refs,
      },
      {
        id: 'update',
        source: 'pay',
        target: 'order',
        kind: 'writes',
        label: '更新',
        data: '支付状态',
        description: '更新订单状态',
        evidence: refs,
      },
    ],
    limitations: ['模拟模型结果，仅测试协议。'],
  };
}
