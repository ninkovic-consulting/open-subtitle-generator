import { EventEmitter } from 'node:events';
import type { ServerEvent } from '../../shared/types.js';

const emitter = new EventEmitter();
emitter.setMaxListeners(100);

export const bus = {
  emit(event: ServerEvent): void {
    emitter.emit('event', event);
  },
  on(listener: (event: ServerEvent) => void): () => void {
    emitter.on('event', listener);
    return () => emitter.off('event', listener);
  },
};
