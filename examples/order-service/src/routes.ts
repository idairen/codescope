import { createOrder } from './orders';
import { payOrder } from './payments';
const router = { post(_path: string, _handler: unknown) {} };
router.post('/api/orders', createOrder);
router.post('/api/payments', payOrder);
