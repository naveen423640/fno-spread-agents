import { describeProviders } from '@/lib/llm/config';

// Reports which configured LLM providers have a key loaded (true or false only). It never returns a key.
export async function GET() {
  try {
    return Response.json({ providers: describeProviders(process.env) }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : 'Unable to read the provider list.' }, { status: 500, headers: { 'Cache-Control': 'no-store' } });
  }
}
