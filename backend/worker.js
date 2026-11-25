import { handleAsNodeRequest } from 'cloudflare:node';
import { app, checkSupabaseActivity } from './src/server.js';
import { createScheduledHandler, createWorkerFetchHandler } from './src/worker-runtime.js';

// Express is adapted to the Workers request lifecycle by Cloudflare's Node
// compatibility runtime. No standalone TCP listener is exposed to the network.
app.listen(3000);

export default {
  fetch: createWorkerFetchHandler((request) => handleAsNodeRequest(3000, request)),
  scheduled: createScheduledHandler(checkSupabaseActivity),
};
