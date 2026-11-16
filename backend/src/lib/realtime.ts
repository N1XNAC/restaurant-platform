import crypto from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { WebSocket } from 'ws';
import { prisma } from './prisma.js';
import { UnauthorizedError } from './errors.js';

export interface RealtimeEnvelope {
  eventId: string;
  sequence: number;
  type: string;
  restaurantId: string;
  timestamp: string;
  payload: unknown;
}

const subscribers = new Map<string, Set<WebSocket>>();

function addSubscriber(restaurantId: string, ws: WebSocket) {
  let set = subscribers.get(restaurantId);
  if (!set) {
    set = new Set();
    subscribers.set(restaurantId, set);
  }
  set.add(ws);
}

function removeSubscriber(restaurantId: string, ws: WebSocket) {
  const set = subscribers.get(restaurantId);
  if (!set) return;
  set.delete(ws);
  if (set.size === 0) {
    subscribers.delete(restaurantId);
  }
}

export async function emitRealtimeEvent(
  restaurantId: string,
  type: string,
  payload: unknown
): Promise<RealtimeEnvelope> {
  const eventId = crypto.randomUUID();
  const row = await prisma.realtimeEvent.create({
    data: {
      eventId,
      restaurantId,
      type,
      payloadJson: JSON.stringify(payload),
    },
  });

  const envelope: RealtimeEnvelope = {
    eventId: row.eventId,
    sequence: row.sequence,
    type: row.type,
    restaurantId: row.restaurantId,
    timestamp: row.createdAt.toISOString(),
    payload,
  };

  const set = subscribers.get(restaurantId);
  if (set) {
    const serialized = JSON.stringify(envelope);
    for (const ws of set) {
      if (ws.readyState === 1) {
        ws.send(serialized);
      }
    }
  }

  return envelope;
}

export async function realtimeRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/v1/realtime', { websocket: true }, async (socket, request) => {
    try {
      const query = request.query as { token?: string; lastSequence?: string };
      const cookieToken = request.cookies?.access_token;
      const token = query.token || cookieToken;
      if (!token) {
        socket.close(4001, 'Unauthorized');
        return;
      }

      const decoded = await app.jwt.verify<{ sub: string; restaurantId: string }>(token);
      const staff = await prisma.staffUser.findUnique({
        where: { id: decoded.sub },
        select: { id: true, restaurantId: true, isActive: true },
      });
      if (!staff || !staff.isActive) {
        throw new UnauthorizedError();
      }

      const restaurantId = staff.restaurantId;
      addSubscriber(restaurantId, socket);

      // Replay missed events if lastSequence is provided
      const lastSeq = query.lastSequence ? Number.parseInt(query.lastSequence, 10) : 0;
      if (Number.isFinite(lastSeq) && lastSeq > 0) {
        const missed = await prisma.realtimeEvent.findMany({
          where: {
            restaurantId,
            sequence: { gt: lastSeq },
          },
          orderBy: { sequence: 'asc' },
          take: 200,
        });
        for (const ev of missed) {
          socket.send(
            JSON.stringify({
              eventId: ev.eventId,
              sequence: ev.sequence,
              type: ev.type,
              restaurantId: ev.restaurantId,
              timestamp: ev.createdAt.toISOString(),
              payload: JSON.parse(ev.payloadJson),
            } satisfies RealtimeEnvelope)
          );
        }
      }

      socket.on('close', () => {
        removeSubscriber(restaurantId, socket);
      });
      socket.on('error', () => {
        removeSubscriber(restaurantId, socket);
      });
    } catch {
      socket.close(4001, 'Unauthorized');
    }
  });
}
