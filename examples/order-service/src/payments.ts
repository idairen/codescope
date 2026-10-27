import { findOrder, savePayment, markOrderPaid } from './repository';
export function payOrder(input: { orderId: string; amount: number }) {
  const order = findOrder(input.orderId);
  if (order.total !== input.amount) throw new Error('支付金额不匹配');
  savePayment(input.orderId, input.amount);
  return markOrderPaid(input.orderId);
}
