"use client";
import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { AgentResult } from '@/lib/server/ai';

type Props = { token: string; onExpired: () => void; onUseImage: (file: File) => void };
type Capabilities = { enabled: boolean; image: boolean; agent: boolean };
export function AIWorkbench(props: Props) { return <Workbench key={props.token} {...props} />; }

function Workbench({ token, onExpired, onUseImage }: Props) {
  const [capabilities, setCapabilities] = useState<Capabilities | null>(null);
  const [image, setImage] = useState<string | null>(null);
  const [answer, setAnswer] = useState<AgentResult | null>(null);
  const [imageBusy, setImageBusy] = useState(false);
  const [agentBusy, setAgentBusy] = useState(false);
  const [imageError, setImageError] = useState('');
  const [agentError, setAgentError] = useState('');
  const imageRequest = useRef<AbortController | null>(null);
  const agentRequest = useRef<AbortController | null>(null);
  const active = useRef(true);
  useEffect(() => {
    active.current = true;
    const controller = new AbortController();
    fetch('/api/capabilities', { signal: controller.signal, cache: 'no-store' })
      .then((response) => response.ok ? response.json() : null)
      .then((value) => {
        if (active.current && !controller.signal.aborted) setCapabilities({ enabled: value?.enabled === true, image: value?.image === true, agent: value?.agent === true });
      }).catch(() => {
        if (active.current && !controller.signal.aborted) setCapabilities({ enabled: false, image: false, agent: false });
      });
    return () => { active.current = false; controller.abort(); imageRequest.current?.abort(); agentRequest.current?.abort(); };
  }, []);

  async function generate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!capabilities?.image || imageRequest.current) return;
    const form = new FormData(event.currentTarget);
    const controller = new AbortController();
    imageRequest.current = controller;
    setImageBusy(true); setImageError(''); setImage(null);
    try {
      const reference = form.get('reference');
      if (reference instanceof File && reference.size > 8 * 1024 * 1024) throw new Error('Choose a reference image up to 8 MB.');
      if (reference instanceof File && !reference.size) form.delete('reference');
      const response = await fetch('/api/image', { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form, signal: AbortSignal.any([controller.signal, AbortSignal.timeout(130_000)]) });
      if (!active.current || controller.signal.aborted) return;
      if (response.status === 401) { onExpired(); return; }
      const result = await response.json().catch(() => null);
      if (!response.ok) throw new Error(result?.error || 'Image generation failed. Please try again.');
      if (typeof result?.image !== 'string' || !/^data:image\/png;base64,[A-Za-z0-9+/]+=*$/.test(result.image)) throw new Error('The server returned an invalid image.');
      if (active.current && !controller.signal.aborted) setImage(result.image);
    } catch (error) {
      if (active.current && !controller.signal.aborted) setImageError(error instanceof Error ? error.message : 'Image generation failed.');
    } finally {
      if (imageRequest.current === controller) imageRequest.current = null;
      if (active.current) setImageBusy(false);
    }
  }
  async function ask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!capabilities?.agent || agentRequest.current) return;
    const form = new FormData(event.currentTarget);
    const controller = new AbortController();
    agentRequest.current = controller;
    setAgentBusy(true); setAgentError(''); setAnswer(null);
    try {
      const response = await fetch('/api/agent', {
        method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ interests: form.get('interests') || '', goal: form.get('goal') || '' }),
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(75_000)]),
      });
      if (!active.current || controller.signal.aborted) return;
      if (response.status === 401) { onExpired(); return; }
      const result = await response.json().catch(() => null);
      if (!response.ok) throw new Error(result?.error || 'The assistant could not finish. Please try again.');
      if (typeof result?.reply !== 'string' || !Array.isArray(result.posts) || !Array.isArray(result.searches)) throw new Error('The server returned an invalid assistant response.');
      if (active.current && !controller.signal.aborted) setAnswer(result);
    } catch (error) {
      if (active.current && !controller.signal.aborted) setAgentError(error instanceof Error ? error.message : 'The assistant could not finish.');
    } finally {
      if (agentRequest.current === controller) agentRequest.current = null;
      if (active.current) setAgentBusy(false);
    }
  }
  function usePreview() {
    if (!image) return;
    const bytes = Uint8Array.from(atob(image.split(',')[1]), (character) => character.charCodeAt(0));
    onUseImage(new File([bytes], 'networkai-generated.png', { type: 'image/png' }));
  }

  return (
    <details className="panel ai-workbench">
      <summary className="flex cursor-pointer items-center justify-between gap-3 font-semibold">
        <span>AI Studio & networking assistant</span>
        <span className="text-sm font-normal">{!capabilities ? 'Checking availability…' : capabilities.enabled ? 'Optional AI tools' : 'Paid tools off'}</span>
      </summary>
      {capabilities && !capabilities.enabled && <p className="text-sm text-slate-600">Paid AI tools are switched off. Your feed, search, uploads, and post management remain available.</p>}
      {capabilities?.enabled && (!capabilities.image || !capabilities.agent) && <p className="text-sm text-slate-600">Some AI tools are not configured on this server.</p>}
      <div className="grid gap-6 lg:grid-cols-2">
        <section className="space-y-3" aria-label="AI Image Studio">
          <h2 className="text-lg font-semibold">AI Image Studio</h2>
          <p className="text-sm text-slate-600">Create an image or edit a reference, then review it before using it in a post.</p>
          <form onSubmit={generate}>
            <label>Image prompt<textarea name="prompt" required maxLength={2000} rows={3} disabled={!capabilities?.image || imageBusy} placeholder="Describe the image you would like to create or change." /></label>
            <label>Reference image (optional)<input type="file" name="reference" accept="image/png,image/jpeg,image/webp" disabled={!capabilities?.image || imageBusy} /></label>
            <p className="text-xs text-slate-600">PNG, JPEG, or WebP, up to 8 MB.</p>
            <button disabled={!capabilities?.image || imageBusy}>{imageBusy ? 'Creating preview…' : 'Generate preview'}</button>
          </form>
          {imageBusy && <p role="status">Creating your image preview…</p>}
          {imageError && <p role="alert">{imageError}</p>}
          {image && <div className="space-y-3" aria-live="polite">
            {/* Data URL previews are intentionally rendered without the remote image optimizer. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={image} alt="Generated image preview" className="w-full rounded-xl" />
            <p className="text-sm">This is a preview. It has not been published.</p>
            <button type="button" onClick={usePreview}>Use image in a post</button>
          </div>}
        </section>
        <section className="space-y-3" aria-label="Networking assistant">
          <h2 className="text-lg font-semibold">Networking assistant</h2>
          <p className="text-sm text-slate-600">Explore community captions and draft an introduction or learning plan. Nothing is sent or published for you.</p>
          <form onSubmit={ask}>
            <label>Your interests<input name="interests" maxLength={200} disabled={!capabilities?.agent || agentBusy} placeholder="React, backend development, learning partners…" /></label>
            <label>Your goal<textarea name="goal" required maxLength={2000} rows={3} disabled={!capabilities?.agent || agentBusy} placeholder="Find relevant project posts and help me draft an introduction." /></label>
            <p className="text-xs text-slate-600">Interests are used for this request and are not saved.</p>
            <button disabled={!capabilities?.agent || agentBusy}>{agentBusy ? 'Working…' : 'Ask assistant'}</button>
          </form>
          {agentBusy && <p role="status">Searching community posts and preparing an answer…</p>}
          {agentError && <p role="alert">{agentError}</p>}
          {answer && <div className="space-y-3" aria-live="polite">
            <h3 className="font-semibold">Assistant answer</h3><p className="whitespace-pre-wrap">{answer.reply}</p>
            <h3 className="font-semibold">Search activity</h3>
            {answer.searches.length === 0 ? <p>No search tool was used.</p> : <ul>{answer.searches.map((item, index) => <li key={index}>{item.failed ? `Search failed: ${item.keywords}` : `${item.keywords}: ${item.count} records`}</li>)}</ul>}
            <h3 className="font-semibold">Retrieved posts</h3>
            {!answer.posts.length && <p>No community records were retrieved.</p>}
            {answer.posts.map((post) => <article key={post.id} className="rounded-lg border border-slate-200 p-3"><p>{post.message}</p><p className="text-sm text-slate-600">By {post.user}</p></article>)}
          </div>}
        </section>
      </div>
    </details>
  );
}
