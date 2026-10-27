import { reserveInventory } from './inventory';
import { saveOrder } from './repository';
import { validateOrder, calculateTotal } from './validation';
export function createOrder(input: { sku: string; quantity: number; price: number }) {
  validateOrder(input);
  const total = calculateTotal(input.quantity, input.price);
  reserveInventory(input.sku, input.quantity);
  return saveOrder({ ...input, total, status: 'created' });
}
