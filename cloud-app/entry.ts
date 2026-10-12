// The Worker entry of the cloud copy of the app: the normal built app, behind the Cloudflare Access check (lib/cloud/access.ts).
import app from '../dist/server/index.js';
import { cloudGuard, type CloudEnv } from '../lib/cloud/access';

type Handler = { fetch(request: Request, env: unknown, ctx: unknown): Promise<Response> };

const worker = {
  async fetch(request: Request, env: CloudEnv, ctx: unknown): Promise<Response> {
    const refused = await cloudGuard(request, env);
    return refused ?? (app as unknown as Handler).fetch(request, env, ctx);
  },
};

export default worker;
