import { resolve } from 'node:path';

// Both compiled server and CLI scripts resolve configuration/assets from backend/.
export const backendRoot = resolve(__dirname, '../..');
