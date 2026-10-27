import { scanRepository } from './scanner';
import type { Snapshot } from '../shared/types';
process.on('message', async (message: { root: string; previous?: Snapshot }) => {
  try {
    const snapshot = await scanRepository(message.root, message.previous, (text) =>
      process.send?.({ type: 'progress', text }),
    );
    process.send?.({ type: 'done', snapshot });
  } catch (error) {
    process.send?.({ type: 'error', text: error instanceof Error ? error.message : '扫描失败' });
  }
});
