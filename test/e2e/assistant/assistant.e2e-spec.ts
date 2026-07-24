import request from 'supertest';

import type { ApiEnvelope } from '../../../src/common';
import { ResultCode } from '../../../src/common';
import {
  createTestApp,
  cleanupDatabase,
  createTestUser,
  createAccessToken,
  bearer,
  expectData,
} from '../../helpers/e2e-helpers';
import type {
  E2eTestContext,
  E2eApp,
  TestUser,
} from '../../helpers/e2e-helpers';
import {
  AssistantConversationStatus,
  AssistantMessageRole,
} from '#generated/prisma/client';

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
      const res = await request(app.getHttpServer())
        .get(`${BASE_PATH}/capabilities`)
        .set('Authorization', bearer(accessToken))
        .expect(200);

      expect((res.body as ApiEnvelope).code).toBe(ResultCode.SUCCESS);
    });
  });

  describe('GET /conversations', () => {
    it('should return 401 for unauthenticated request', async () => {
      await request(app.getHttpServer())
        .get(`${BASE_PATH}/conversations`)
        .expect(401);
    });

    it('should list conversations (empty for new user)', async () => {
      const res = await request(app.getHttpServer())
        .get(`${BASE_PATH}/conversations`)
        .set('Authorization', bearer(accessToken))
        .expect(200);

      expect((res.body as ApiEnvelope).code).toBe(ResultCode.SUCCESS);
    });
  });

  describe('GET /latest', () => {
    it('should return latest conversation or null for new user', async () => {
      const res = await request(app.getHttpServer())
        .get(`${BASE_PATH}/latest`)
        .set('Authorization', bearer(accessToken))
        .expect(200);

      const body = res.body as ApiEnvelope<{ id?: string }>;
      expect(body.code).toBe(ResultCode.SUCCESS);
    });
  });

  // ── Open Conversation ───────────────────────────────────────

  describe('POST /conversations/:conversationId/open', () => {
    it('should return 401 for unauthenticated request', async () => {
      await request(app.getHttpServer())
        .post(`${BASE_PATH}/conversations/fake-id/open`)
        .expect(401);
    });

    it('should return 404 for a non-existent conversation', async () => {
      await request(app.getHttpServer())
        .post(`${BASE_PATH}/conversations/non-existent-conv-id/open`)
        .set('Authorization', bearer(accessToken))
        .expect(404);
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

      const body = res.body as ApiEnvelope<{
        id: string;
        status: string;
        messages: Array<{ role: string; content: string }>;
      }>;

      expect(body.code).toBe(ResultCode.SUCCESS);
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

      const body = res.body as ApiEnvelope<{
        cleared: boolean;
        archivedConversationId: string | null;
      }>;

      expect(body.code).toBe(ResultCode.SUCCESS);
      expect(body.data!.cleared).toBe(false);
      expect(body.data!.archivedConversationId).toBeNull();
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

      const body = res.body as ApiEnvelope<{
        cleared: boolean;
        archivedConversationId: string | null;
      }>;

      expect(body.code).toBe(ResultCode.SUCCESS);
      expect(body.data!.cleared).toBe(true);
      expect(body.data!.archivedConversationId).toBe(conversation.id);

      // Verify the conversation is now archived in the database
      const stored = await ctx.prisma.assistantConversation.findUniqueOrThrow({
        where: { id: conversation.id },
      });
      expect(stored.status).toBe(AssistantConversationStatus.archived);
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

    it('should return 400 for invalid request body (empty messages)', async () => {
      await request(app.getHttpServer())
        .post(`${BASE_PATH}/messages/stream`)
        .set('Authorization', bearer(accessToken))
        .send({ messages: [] })
        .expect(400);
    });

    it('should return SSE stream or error when LLM is not configured', async () => {
      const res = await request(app.getHttpServer())
        .post(`${BASE_PATH}/messages/stream`)
        .set('Authorization', bearer(accessToken))
        .send({ messages: [{ role: 'user', content: 'Hello' }] });

      // The endpoint may return 200 (SSE stream) or 403/503 if LLM not configured
      if (res.status === 200) {
        expect(res.headers['content-type']).toContain('text/event-stream');
        // SSE response body should contain event markers
        const text = res.text as string;
        expect(text).toContain('event:');
      } else {
        // LLM not configured or assistant disabled
        expect([403, 503]).toContain(res.status);
      }
    });
  });
});
