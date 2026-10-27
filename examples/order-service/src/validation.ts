export function validateOrder(input: { sku: string; quantity: number; price: number }) {
  if (!input.sku || input.quantity <= 0 || input.price < 0) throw new Error('订单参数无效');
}
export function calculateTotal(quantity: number, price: number) {
  return quantity * price;
}
