// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { AIWorkbench } from '@/components/ai-workbench';

const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=';
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it('requires an explicit review action before a generated preview can be used in a post', async () => {
  const request = vi.fn<typeof fetch>()
    .mockResolvedValueOnce(Response.json({ enabled: true, image: true, agent: true }))
    .mockResolvedValueOnce(Response.json({ image: `data:image/png;base64,${png}`, mimeType: 'image/png' }));
  vi.stubGlobal('fetch', request);
  const onUseImage = vi.fn();
  render(<AIWorkbench token="test-token" onExpired={vi.fn()} onUseImage={onUseImage} />);
  fireEvent.click(screen.getByText('AI Studio & networking assistant'));
  const generate = screen.getByRole('button', { name: 'Generate preview' }) as HTMLButtonElement;
  await waitFor(() => expect(generate.disabled).toBe(false));
  fireEvent.change(screen.getByLabelText('Image prompt'), { target: { value: 'A green garden' } });
  fireEvent.submit(generate.closest('form')!);
  await screen.findByAltText('Generated image preview');
  expect(onUseImage).not.toHaveBeenCalled();
  expect(screen.getByText('This is a preview. It has not been published.')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Use image in a post' }));
  expect(onUseImage).toHaveBeenCalledTimes(1);
  const file = onUseImage.mock.calls[0][0] as File;
  expect(file.name).toBe('networkai-generated.png');
  expect(file.type).toBe('image/png');
  expect(request).toHaveBeenCalledTimes(2);
});

it('keeps the paid controls disabled and does not submit when paid AI is off', async () => {
  const request = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ enabled: false, image: false, agent: false }));
  vi.stubGlobal('fetch', request);
  render(<AIWorkbench token="test-token" onExpired={vi.fn()} onUseImage={vi.fn()} />);
  fireEvent.click(screen.getByText('AI Studio & networking assistant'));
  await screen.findByText('Paid tools off');
  const generate = screen.getByRole('button', { name: 'Generate preview' }) as HTMLButtonElement;
  const assistant = screen.getByRole('button', { name: 'Ask assistant' }) as HTMLButtonElement;
  expect(generate.disabled).toBe(true);
  expect(assistant.disabled).toBe(true);
  fireEvent.submit(generate.closest('form')!);
  fireEvent.submit(assistant.closest('form')!);
  expect(request).toHaveBeenCalledTimes(1);
});
