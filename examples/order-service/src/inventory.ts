const inventory = new Map<string, number>([['book', 100]]);
export function checkStock(sku: string, quantity: number) {
  return (inventory.get(sku) ?? 0) >= quantity;
}
export function reserveInventory(sku: string, quantity: number) {
  if (!checkStock(sku, quantity)) throw new Error('库存不足');
  inventory.set(sku, (inventory.get(sku) ?? 0) - quantity);
}
