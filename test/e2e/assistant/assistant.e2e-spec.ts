import request from 'supertest';

import {
  createTestApp,
  cleanupDatabase,
  createTestUser,
  createAccessToken,
  bearer,
  expectData,
} from '../../helpers/e2e-helpers.js';
import type {
  E2eTestContext,
  E2eApp,
  TestUser,
} from '../../helpers/e2e-helpers.js';
import {
  AssistantConversationStatus,
  AssistantMessageRole,
} from '#generated/prisma/client.js';

const BASE_PATH = '/api/v1/user/assistant';

describe('Assistant API (e2e)', () => {
  let ctx: E2eTestContext;
  let app: E2eApp;
  let user: TestUser;
  let accessToken: string;

  beforeAll(async () => {
    ctx = await createTestApp();
    app = ctx.app;
    await cleanupDatabase(ctx.prisma);

    user = await createTestUser(ctx.prisma, undefined, 'AstUser');
    accessToken = await createAccessToken(
      ctx.jwtService,
      ctx.configService,
      user.id,
      user.email,
    );
  });

  afterAll(async () => {
    await cleanupDatabase(ctx.prisma);
    await app.close();
  });

  describe('GET /capabilities', () => {
    it('should return 401 for unauthenticated request', async () => {
      await request(app.getHttpServer())
        .get(`${BASE_PATH}/capabilities`)
        .expect(401);
    });

    it('should return assistant capabilities for authenticated user', async () => {
      await request(app.getHttpServer())
        .get(`${BASE_PATH}/capabilities`)
        .set('Authorization', bearer(accessToken))
        .expect(200);
    });
  });

  describe('GET /conversations', () => {
    it('should return 401 for unauthenticated request', async () => {
      await request(app.getHttpServer())
        .get(`${BASE_PATH}/conversations`)
        .expect(401);
    });

    it('should list conversations (empty for new user)', async () => {
      await request(app.getHttpServer())
        .get(`${BASE_PATH}/conversations`)
        .set('Authorization', bearer(accessToken))
        .expect(200);
    });
  });

  describe('GET /latest', () => {
    it('should return latest conversation or null for new user', async () => {
      await request(app.getHttpServer())
        .get(`${BASE_PATH}/latest`)
        .set('Authorization', bearer(accessToken))
        .expect(200);
    });
  });

  // ── Open Conversation ───────────────────────────────────────

  describe('POST /conversations/:conversationId/open', () => {
    it('should return 401 for unauthenticated request', async () => {
      await request(app.getHttpServer())
        .post(`${BASE_PATH}/conversations/fake-id/open`)
        .expect(401);
    });

    it('should return 404 RESOURCE_NOT_FOUND for a non-existent conversation', async () => {
      const res = await request(app.getHttpServer())
        .post(`${BASE_PATH}/conversations/non-existent-conv-id/open`)
        .set('Authorization', bearer(accessToken))
        .expect(404);

      const body = res.body as Record<string, unknown>;
      expect(body['code']).toBe('RESOURCE_NOT_FOUND');
    });

    it('should activate an archived conversation and return its history', async () => {
      // Seed an archived conversation with messages
      const conversation = await ctx.prisma.assistantConversation.create({
        data: {
          userId: user.id,
          title: 'Test Conversation',
          status: AssistantConversationStatus.archived,
        },
      });

      await ctx.prisma.assistantMessage.create({
        data: {
          conversationId: conversation.id,
          userId: user.id,
          role: AssistantMessageRole.user,
          content: 'Hello assistant',
        },
      });

      await ctx.prisma.assistantMessage.create({
        data: {
          conversationId: conversation.id,
          userId: user.id,
          role: AssistantMessageRole.assistant,
          content: 'Hi! How can I help you?',
        },
      });

      const res = await request(app.getHttpServer())
        .post(`${BASE_PATH}/conversations/${conversation.id}/open`)
        .set('Authorization', bearer(accessToken))
        .expect(201);

      const body = res.body as {
        id: string;
        status: string;
        messages: Array<{ role: string; content: string }>;
      };

      const data = expectData(body);
      expect(data.id).toBe(conversation.id);
      expect(data.status).toBe('active');
      expect(data.messages).toHaveLength(2);
      expect(data.messages[0]?.role).toBe('user');
      expect(data.messages[0]?.content).toBe('Hello assistant');
      expect(data.messages[1]?.role).toBe('assistant');
      expect(data.messages[1]?.content).toBe('Hi! How can I help you?');
    });
  });

  // ── Clear Latest Conversation ──────────────────────────────

  describe('POST /latest/clear', () => {
    it('should return 401 for unauthenticated request', async () => {
      await request(app.getHttpServer())
        .post(`${BASE_PATH}/latest/clear`)
        .expect(401);
    });

    it('should return cleared=false when no active conversation exists', async () => {
      // Use a fresh user to ensure no active conversation exists
      const freshUser = await createTestUser(
        ctx.prisma,
        undefined,
        'AstClearUser',
      );
      const freshToken = await createAccessToken(
        ctx.jwtService,
        ctx.configService,
        freshUser.id,
        freshUser.email,
      );

      const res = await request(app.getHttpServer())
        .post(`${BASE_PATH}/latest/clear`)
        .set('Authorization', bearer(freshToken))
        .expect(201);

      const body = res.body as {
        cleared: boolean;
        archivedConversationId: string | null;
      };

      expect(body!.cleared).toBe(false);
      expect(body!.archivedConversationId).toBeNull();
    });

    it('should archive the active conversation and return cleared=true', async () => {
      // Seed an active conversation
      const conversation = await ctx.prisma.assistantConversation.create({
        data: {
          userId: user.id,
          title: 'To Be Cleared',
          status: AssistantConversationStatus.active,
        },
      });

      const res = await request(app.getHttpServer())
        .post(`${BASE_PATH}/latest/clear`)
        .set('Authorization', bearer(accessToken))
        .expect(201);

      const body = res.body as {
        cleared: boolean;
        archivedConversationId: string | null;
      };

      expect(body!.cleared).toBe(true);
      expect(body!.archivedConversationId).toBe(conversation.id);

      // Verify the conversation is now archived in the database
      const stored = await ctx.prisma.assistantConversation.findUniqueOrThrow({
        where: { id: conversation.id },
      });
      expect(stored.status).toBe(AssistantConversationStatus.archived);
    });
  });

  // ── Rename Conversation ─────────────────────────────────────

  describe('PATCH /conversations/:conversationId', () => {
    it('should return 401 for unauthenticated request', async () => {
      await request(app.getHttpServer())
        .patch(`${BASE_PATH}/conversations/fake-id`)
        .send({ title: 'New title' })
        .expect(401);
    });

    it('should return 400 VALIDATION_FAILED for an empty title', async () => {
      const res = await request(app.getHttpServer())
        .patch(`${BASE_PATH}/conversations/fake-id`)
        .set('Authorization', bearer(accessToken))
        .send({ title: '' })
        .expect(400);

      const body = res.body as Record<string, unknown>;
      expect(body['code']).toBe('VALIDATION_FAILED');
    });

    it('should return 400 VALIDATION_FAILED for a whitespace-only title', async () => {
      const res = await request(app.getHttpServer())
        .patch(`${BASE_PATH}/conversations/fake-id`)
        .set('Authorization', bearer(accessToken))
        .send({ title: '   ' })
        .expect(400);

      const body = res.body as Record<string, unknown>;
      expect(body['code']).toBe('VALIDATION_FAILED');
    });

    it('should return 400 VALIDATION_FAILED for unknown body keys (strict schema, forbid parity)', async () => {
      const res = await request(app.getHttpServer())
        .patch(`${BASE_PATH}/conversations/fake-id`)
        .set('Authorization', bearer(accessToken))
        .send({ title: 'New title', extra: 'x' })
        .expect(400);

      const body = res.body as Record<string, unknown>;
      expect(body['code']).toBe('VALIDATION_FAILED');
    });

    it('should rename an existing conversation and return the updated resource', async () => {
      const conversation = await ctx.prisma.assistantConversation.create({
        data: {
          userId: user.id,
          title: 'Old Title',
          status: AssistantConversationStatus.archived,
        },
      });

      const res = await request(app.getHttpServer())
        .patch(`${BASE_PATH}/conversations/${conversation.id}`)
        .set('Authorization', bearer(accessToken))
        .send({ title: 'New Title' })
        .expect(200);

      const data = expectData(res.body as { id: string; title: string });
      expect(data.id).toBe(conversation.id);
      expect(data.title).toBe('New Title');

      const stored = await ctx.prisma.assistantConversation.findUniqueOrThrow({
        where: { id: conversation.id },
      });
      expect(stored.title).toBe('New Title');
    });
  });

  // ── Confirm Proposal ────────────────────────────────────────

  describe('POST /conversations/:conversationId/confirm', () => {
    it('should return 401 for unauthenticated request', async () => {
      await request(app.getHttpServer())
        .post(`${BASE_PATH}/conversations/fake-id/confirm`)
        .send({ proposalIds: ['p1'], decision: 'approved' })
        .expect(401);
    });

    it('should return 400 VALIDATION_FAILED when required fields are missing', async () => {
      const res = await request(app.getHttpServer())
        .post(`${BASE_PATH}/conversations/fake-id/confirm`)
        .set('Authorization', bearer(accessToken))
        .send({ decision: 'approved' })
        .expect(400);

      const body = res.body as Record<string, unknown>;
      expect(body['code']).toBe('VALIDATION_FAILED');
    });

    it('should return 400 VALIDATION_FAILED for an empty proposalIds array', async () => {
      const res = await request(app.getHttpServer())
        .post(`${BASE_PATH}/conversations/fake-id/confirm`)
        .set('Authorization', bearer(accessToken))
        .send({ proposalIds: [], decision: 'approved' })
        .expect(400);

      const body = res.body as Record<string, unknown>;
      expect(body['code']).toBe('VALIDATION_FAILED');
    });

    it('should return 400 VALIDATION_FAILED for an invalid decision value', async () => {
      const res = await request(app.getHttpServer())
        .post(`${BASE_PATH}/conversations/fake-id/confirm`)
        .set('Authorization', bearer(accessToken))
        .send({ proposalIds: ['p1'], decision: 'maybe' })
        .expect(400);

      const body = res.body as Record<string, unknown>;
      expect(body['code']).toBe('VALIDATION_FAILED');
    });

    it('should return 400 VALIDATION_FAILED for unknown body keys (strict schema, forbid parity)', async () => {
      const res = await request(app.getHttpServer())
        .post(`${BASE_PATH}/conversations/fake-id/confirm`)
        .set('Authorization', bearer(accessToken))
        .send({ proposalIds: ['p1'], decision: 'approved', extra: 'x' })
        .expect(400);

      const body = res.body as Record<string, unknown>;
      expect(body['code']).toBe('VALIDATION_FAILED');
    });
  });

  // ── Stream Messages (SSE) ──────────────────────────────────

  describe('POST /messages/stream', () => {
    it('should return 401 for unauthenticated request', async () => {
      await request(app.getHttpServer())
        .post(`${BASE_PATH}/messages/stream`)
        .send({ messages: [{ role: 'user', content: 'hi' }] })
        .expect(401);
    });

    it('should return 400 VALIDATION_FAILED for invalid request body (empty messages)', async () => {
      const res = await request(app.getHttpServer())
        .post(`${BASE_PATH}/messages/stream`)
        .set('Authorization', bearer(accessToken))
        .send({ messages: [] })
        .expect(400);

      const body = res.body as Record<string, unknown>;
      expect(body['code']).toBe('VALIDATION_FAILED');
    });

    it('should return 400 VALIDATION_FAILED for an invalid nested message role', async () => {
      const res = await request(app.getHttpServer())
        .post(`${BASE_PATH}/messages/stream`)
        .set('Authorization', bearer(accessToken))
        .send({ messages: [{ role: 'system', content: 'Hello' }] })
        .expect(400);

      const body = res.body as Record<string, unknown>;
      expect(body['code']).toBe('VALIDATION_FAILED');
    });

    it('should return 400 VALIDATION_FAILED for unknown keys in a nested message (strict schema, forbid parity)', async () => {
      const res = await request(app.getHttpServer())
        .post(`${BASE_PATH}/messages/stream`)
        .set('Authorization', bearer(accessToken))
        .send({ messages: [{ role: 'user', content: 'Hello', extra: 'x' }] })
        .expect(400);

      const body = res.body as Record<string, unknown>;
      expect(body['code']).toBe('VALIDATION_FAILED');
    });

    it('should return 400 VALIDATION_FAILED for unknown top-level body keys (strict schema, forbid parity)', async () => {
      const res = await request(app.getHttpServer())
        .post(`${BASE_PATH}/messages/stream`)
        .set('Authorization', bearer(accessToken))
        .send({
          messages: [{ role: 'user', content: 'Hello' }],
          extra: 'x',
        })
        .expect(400);

      const body = res.body as Record<string, unknown>;
      expect(body['code']).toBe('VALIDATION_FAILED');
    });

    it('should return 400 VALIDATION_FAILED when the conversation window exceeds 20 messages', async () => {
      const res = await request(app.getHttpServer())
        .post(`${BASE_PATH}/messages/stream`)
        .set('Authorization', bearer(accessToken))
        .send({
          messages: Array.from({ length: 21 }, (_, index) => ({
            role: 'user' as const,
            content: `message-${index}`,
          })),
        })
        .expect(400);

      const body = res.body as Record<string, unknown>;
      expect(body['code']).toBe('VALIDATION_FAILED');
    });

    it('should emit an SSE error event when LLM is not configured', async () => {
      const res = await request(app.getHttpServer())
        .post(`${BASE_PATH}/messages/stream`)
        .set('Authorization', bearer(accessToken))
        .send({ messages: [{ role: 'user', content: 'Hello' }] })
        .expect(200);

      // prepareSse sends the 200 headers before the handler runs, so after
      // migration business failures never surface as HTTP 403/503 — they are
      // emitted as `event: error` frames carrying the stable DomainFailure
      // code (assistant disabled → FORBIDDEN, LLM not configured →
      // DEPENDENCY_UNAVAILABLE).
      expect(res.headers['content-type']).toContain('text/event-stream');

      const text = res.text as string;
      expect(text).toContain('event: error');
      const codeMatched =
        text.includes('"code":"FORBIDDEN"') ||
        text.includes('"code":"DEPENDENCY_UNAVAILABLE"');
      expect(codeMatched).toBe(true);
    });
  });
});
