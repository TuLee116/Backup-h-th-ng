import { EventEmitter } from 'node:events';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../_lib/server.js', () => ({
  begin: vi.fn(() => 'request-id'),
  adminOk: vi.fn(() => true),
}));
vi.mock('../../_lib/participation.js', () => ({
  loadParticipationSnapshot: vi.fn(async () => ({ refreshedAt: '2026-11-17T09:00:00.000Z', participants: [] })),
}));

import { adminOk } from '../../_lib/server.js';
import { loadParticipationSnapshot } from '../../_lib/participation.js';
import handler from './participation.js';

class FakeResponse extends EventEmitter {
  statusCode = 200;
  headersSent = false;
  writableEnded = false;
  headers = new Map<string, string>();
  chunks: string[] = [];
  body: unknown;

  setHeader(name: string, value: string) { this.headers.set(name, value); return this; }
  status(code: number) { this.statusCode = code; return this; }
  json(body: unknown) { this.body = body; this.end(); return this; }
  flushHeaders() { this.headersSent = true; }
  write(chunk: string) {
    this.chunks.push(chunk);
    if (chunk.startsWith('data:')) setImmediate(() => this.emit('close'));
    return true;
  }
  end() { this.writableEnded = true; this.emit('close'); return this; }
}

const request = { method: 'GET' } as VercelRequest;

describe('admin participation SSE', () => {
  beforeEach(() => {
    vi.mocked(adminOk).mockReturnValue(true);
    vi.mocked(loadParticipationSnapshot).mockClear();
  });

  it('requires an admin cookie before opening the stream', async () => {
    vi.mocked(adminOk).mockReturnValue(false);
    const response = new FakeResponse();

    await handler(request, response as unknown as VercelResponse);

    expect(response.statusCode).toBe(401);
    expect(response.headersSent).toBe(false);
    expect(loadParticipationSnapshot).not.toHaveBeenCalled();
  });

  it('sends a snapshot as an event stream and stops after disconnect', async () => {
    const response = new FakeResponse();

    await handler(request, response as unknown as VercelResponse);

    expect(response.headers.get('Content-Type')).toBe('text/event-stream; charset=utf-8');
    expect(response.chunks[0]).toBe('retry: 2000\n\n');
    expect(response.chunks[1]).toContain('"participants":[]');
    expect(loadParticipationSnapshot).toHaveBeenCalledTimes(1);
  });
});
