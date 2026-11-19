import type { VercelRequest, VercelResponse } from '@vercel/node';
import { adminOk, begin } from '../../_lib/server.js';
import { loadParticipationSnapshot } from '../../_lib/participation.js';

export const config = { maxDuration: 60 };

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const rid = begin(req, res);
  if (!rid) return;
  if (req.method !== 'GET') return res.status(405).json({ error: 'Phương thức không được hỗ trợ.' });
  if (!adminOk(req)) return res.status(401).json({ error: 'Chưa xác thực.' });

  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store, no-transform');
  res.setHeader('X-Accel-Buffering', 'no');

  let closed = false;
  const onClose = () => { closed = true; };
  res.on('close', onClose);
  const stopAt = Date.now() + 45_000;
  let previous = '';
  try {
    res.flushHeaders();
    res.write('retry: 2000\n\n');
    while (!closed && Date.now() < stopAt && adminOk(req)) {
      const snapshot = await loadParticipationSnapshot();
      if (closed) break;
      const current = JSON.stringify(snapshot.participants);
      if (current !== previous) {
        res.write(`data: ${JSON.stringify(snapshot)}\n\n`);
        previous = current;
      } else {
        res.write(': heartbeat\n\n');
      }
      await new Promise<void>((resolve) => {
        const finish = () => { clearTimeout(timer); res.off('close', finish); resolve(); };
        const timer = setTimeout(finish, 3000);
        res.once('close', finish);
      });
    }
  } catch (error) {
    console.error(rid, (error as Error)?.message);
    if (!closed && !res.headersSent) res.status(500).json({ error: 'Lỗi hệ thống. Vui lòng thử lại.', requestId: rid });
    else if (!closed) res.write('event: stream-error\ndata: {}\n\n');
  } finally {
    res.off('close', onClose);
    if (!closed && !res.writableEnded) res.end();
  }
}
