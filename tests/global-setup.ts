import { ensureFfmpeg } from '../src/server/services/binaries.js';

export default async function setup(): Promise<void> {
  await ensureFfmpeg((msg) => console.log(msg));
}
