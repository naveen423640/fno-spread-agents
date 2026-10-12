import { isCloudMode } from '@/lib/cloud/access';

// GET: whether this is the cloud copy of the app (read-only for the agent and for recording), so the tabs can hide what only works on the Mac.
export async function GET() {
  return Response.json({ cloud: isCloudMode({ CLOUD_MODE: process.env.CLOUD_MODE }) }, { headers: { 'Cache-Control': 'no-store' } });
}
