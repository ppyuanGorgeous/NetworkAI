// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { capabilities, handleAgent, handleImage } from './ai';

const env = { ENABLE_PAID_AI: 'true', OPENAI_API_KEY: 'test-only-value', OPENAI_IMAGE_MODEL: 'gpt-image-2', OPENAI_AGENT_MODEL: 'gpt-4.1-mini', INTERNAL_API_URL: 'http://backend:8080' };
const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=';
const headers = { Authorization: 'Bearer local-test-token' };
function imageRequest(reference?: File) {
  const form = new FormData();
  form.set('prompt', 'A small green garden');
  if (reference) form.set('reference', reference);
  return new Request('http://localhost:3000/api/image', { method: 'POST', headers, body: form });
}
function agentRequest(body: unknown = { goal: 'Find React collaborators', interests: 'frontend' }) {
  return new Request('http://localhost:3000/api/agent', { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
}
function message(text: string) { return { status: 'completed', output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text }] }] }; }
function call(id: string, keywords: string) { return { status: 'completed', output: [{ type: 'function_call', call_id: id, name: 'search_posts', arguments: JSON.stringify({ keywords }) }] }; }

describe('paid AI controls', () => {
  it('turns both capabilities off and makes zero upstream calls when the paid switch is off, even with configured credentials', async () => {
    const disabled = { ...env, ENABLE_PAID_AI: 'false' };
    const upstream = vi.fn<typeof fetch>();
    expect(capabilities(disabled)).toEqual({ enabled: false, image: false, agent: false });
    expect((await handleImage(imageRequest(), { env: disabled, fetch: upstream })).status).toBe(503);
    expect((await handleAgent(agentRequest(), { env: disabled, fetch: upstream })).status).toBe(503);
    expect(upstream).not.toHaveBeenCalled();
  });
  it('does not reveal configuration values in capabilities', () => {
    expect(capabilities(env)).toEqual({ enabled: true, image: true, agent: true });
    expect(JSON.stringify(capabilities(env))).not.toContain(env.OPENAI_API_KEY);
    expect(capabilities({ ENABLE_PAID_AI: 'true' })).toEqual({ enabled: true, image: false, agent: false });
  });
  it('rejects unverified and expired sessions before any provider call', async () => {
    const upstream = vi.fn<typeof fetch>().mockResolvedValue(new Response('not signed in', { status: 401 }));
    const result = await handleImage(imageRequest(), { env, fetch: upstream });
    expect(result.status).toBe(401);
    expect(upstream).toHaveBeenCalledTimes(1);
    expect(String(upstream.mock.calls[0][0])).toBe('http://backend:8080/posts/search');
    const anonymous = new Request('http://localhost:3000/api/agent', { method: 'POST', body: '{}' });
    expect((await handleAgent(anonymous, { env, fetch: upstream })).status).toBe(401);
    expect(upstream).toHaveBeenCalledTimes(1);
  });
});

describe('image generation and editing', () => {
  it('verifies the session, generates one PNG, and returns only an unpublished data URL preview', async () => {
    const upstream = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json([]))
      .mockResolvedValueOnce(Response.json({ data: [{ b64_json: png }] }));
    const response = await handleImage(imageRequest(), { env, fetch: upstream });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ image: `data:image/png;base64,${png}`, mimeType: 'image/png' });
    expect(String(upstream.mock.calls[1][0])).toBe('https://api.openai.com/v1/images/generations');
    expect(JSON.parse(upstream.mock.calls[1][1]?.body as string)).toMatchObject({ model: 'gpt-image-2', n: 1, output_format: 'png' });
    expect(new Headers(upstream.mock.calls[0][1]?.headers).get('Authorization')).toBe('Bearer local-test-token');
    expect(new Headers(upstream.mock.calls[1][1]?.headers).get('Authorization')).toBe('Bearer test-only-value');
    expect(upstream).toHaveBeenCalledTimes(2);
  });
  it('uses the edit endpoint with the actual reference file', async () => {
    const upstream = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json([]))
      .mockResolvedValueOnce(Response.json({ data: [{ b64_json: png }] }));
    const reference = new File([Buffer.from(png, 'base64')], 'reference.png', { type: 'image/png' });
    expect((await handleImage(imageRequest(reference), { env, fetch: upstream })).status).toBe(200);
    expect(String(upstream.mock.calls[1][0])).toBe('https://api.openai.com/v1/images/edits');
    const body = upstream.mock.calls[1][1]?.body as FormData;
    expect(body.get('image[]')).toBeInstanceOf(File);
    expect((body.get('image[]') as File).size).toBe(reference.size);
    expect(body.get('prompt')).toBe('A small green garden');
  });
  it('rejects a spoofed reference before contacting the backend or provider', async () => {
    const upstream = vi.fn<typeof fetch>();
    const reference = new File(['not an image'], 'fake.png', { type: 'image/png' });
    expect((await handleImage(imageRequest(reference), { env, fetch: upstream })).status).toBe(415);
    expect(upstream).not.toHaveBeenCalled();
  });
  it('does not relay provider secrets or return a missing image as success', async () => {
    const upstream = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json([]))
      .mockResolvedValueOnce(Response.json({ error: { message: 'sensitive provider diagnostic' } }, { status: 403 }));
    const response = await handleImage(imageRequest(), { env, fetch: upstream });
    expect(response.status).toBe(502);
    expect(await response.text()).not.toContain('sensitive provider diagnostic');
  });
});

describe('bounded read-only networking assistant', () => {
  it('executes at most two actual searches and three model calls, preserves call IDs, and exposes evidence without reasoning', async () => {
    const upstream = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json([]))
      .mockResolvedValueOnce(Response.json(call('first', 'React')))
      .mockResolvedValueOnce(Response.json([{ id: '1', user: 'alice', message: 'React project' }]))
      .mockResolvedValueOnce(Response.json(call('second', 'backend')))
      .mockResolvedValueOnce(Response.json([{ id: '2', user: 'bob', message: 'Backend learning group' }]))
      .mockResolvedValueOnce(Response.json({ ...message('Here are two relevant posts and a draft introduction.'), secret_reasoning: 'private' }));
    const response = await handleAgent(agentRequest(), { env, fetch: upstream });
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result.posts).toHaveLength(2);
    expect(result.searches).toEqual([{ keywords: 'React', count: 1 }, { keywords: 'backend', count: 1 }]);
    expect(JSON.stringify(result)).not.toContain('private');
    const calls = upstream.mock.calls.filter(([url]) => String(url).includes('/v1/responses'));
    expect(calls).toHaveLength(3);
    expect(JSON.parse(calls[2][1]?.body as string)).toMatchObject({ tool_choice: 'none', store: false, parallel_tool_calls: false });
    expect(JSON.parse(calls[1][1]?.body as string).input).toContainEqual(expect.objectContaining({ type: 'function_call_output', call_id: 'first' }));
  });
  it('rejects extra model tool calls instead of running unbounded searches', async () => {
    const extra = call('first', 'React');
    extra.output.push(call('second', 'Go').output[0]);
    const upstream = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json([])).mockResolvedValueOnce(Response.json(extra));
    expect((await handleAgent(agentRequest(), { env, fetch: upstream })).status).toBe(502);
    expect(upstream).toHaveBeenCalledTimes(2);
  });
  it('reports failed searches as failed observations without inventing retrieved posts', async () => {
    const upstream = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json([])).mockResolvedValueOnce(Response.json(call('first', 'React')))
      .mockResolvedValueOnce(new Response('unavailable', { status: 500 }))
      .mockResolvedValueOnce(Response.json(message('Search was unavailable, so I cannot recommend community posts.')));
    const response = await handleAgent(agentRequest(), { env, fetch: upstream });
    const result = await response.json();
    expect(result.posts).toEqual([]);
    expect(result.searches).toEqual([{ keywords: 'React', count: 0, failed: true }]);
  });
  it('validates input lengths before any upstream request', async () => {
    const upstream = vi.fn<typeof fetch>();
    expect((await handleAgent(agentRequest({ goal: 'x'.repeat(2001) }), { env, fetch: upstream })).status).toBe(400);
    expect(upstream).not.toHaveBeenCalled();
  });
  it('rejects a null JSON body as invalid input without upstream calls', async () => {
    const upstream = vi.fn<typeof fetch>();
    expect((await handleAgent(agentRequest(null), { env, fetch: upstream })).status).toBe(400);
    expect(upstream).not.toHaveBeenCalled();
  });
});
