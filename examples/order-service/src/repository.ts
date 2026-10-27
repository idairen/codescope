const orders = new Map<string, Record<string, unknown>>();
const payments: { orderId: string; amount: number }[] = [];
export function saveOrder(order: Record<string, unknown>) {
  const id = String(orders.size + 1);
  orders.set(id, { ...order, id });
  return { ...order, id };
}
export function findOrder(id: string) {
  const order = orders.get(id);
  if (!order) throw new Error('订单不存在');
  return order;
}
export function savePayment(orderId: string, amount: number) {
  payments.push({ orderId, amount });
  return payments.length;
}
export function markOrderPaid(id: string) {
  const order = findOrder(id);
  order.status = 'paid';
  return order;
}
