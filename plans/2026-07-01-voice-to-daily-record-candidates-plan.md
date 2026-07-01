# Voice To Daily Record Candidates Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a voice-input path that transcribes user audio into text and then reuses the existing daily-record candidate generation flow instead of replacing the current text-to-candidates NLP chain.

**Architecture:** Keep the current `text -> candidate records` chain as the single structured-extraction path. Add one new backend capability before it: trusted audio upload plus ASR transcription using the configured OpenAI-compatible `language` role, then pass the transcript into the existing candidate-record generator. Do not let the speech model output structured record items directly.

**Tech Stack:** NestJS 11, Prisma 7, Tencent COS presigned upload/download, LangChain `ChatOpenAI` / OpenAI-compatible runtime, existing `daily-records` module DTO/controller/service pattern.

---

## File Structure

**Create**

- `src/modules/daily-records/dto/daily-record-audio-upload.dto.ts`
  Defines request/response DTOs for presigned audio upload and transcription request.
- `src/modules/daily-records/services/daily-record-audio-upload.service.ts`
  Issues trusted presigned upload metadata for audio files.
- `src/modules/daily-records/services/daily-record-audio-transcription.service.ts`
  Owns signed GET generation for trusted audio objects plus ASR invocation and transcript normalization.
- `src/modules/daily-records/services/daily-record-audio-transcription.service.spec.ts`
  Covers trusted-object checks, transcript normalization, and failure behavior.
- `src/modules/daily-records/services/daily-record-candidates-voice.service.ts`
  Small orchestration service: transcribe first, then call the existing candidate generator.
- `src/modules/daily-records/services/daily-record-candidates-voice.service.spec.ts`
  Covers transcript passthrough to the existing candidate generator.

**Modify**

- `src/modules/daily-records/config/daily-record-image-upload.runtime.ts`
  Generalize or extend current COS runtime usage if audio and image can share signed GET/PUT helpers cleanly.
- `src/modules/daily-records/daily-records.controller.ts`
  Add audio presign and voice-to-candidate endpoints.
- `src/modules/daily-records/daily-records.module.ts`
  Register new DTO/service providers.
- `src/modules/daily-records/dto/generate-daily-record-candidates.dto.ts`
  Keep current text DTO unchanged unless a shared response envelope needs a transcript field.
- `src/modules/daily-records/services/daily-record-candidates.service.ts`
  Reuse as-is if possible; only extend response shape if transcript echo-back is needed.
- `src/modules/llm-runtime/services/llm-runtime.service.ts`
  Only if current runtime needs a helper for audio transcription with the configured `language` role.
- `docs/Current_State.md`
  Record that voice input reuses the existing candidate-record NLP chain.
- `docs/migration-log/2026-07-01.md`
  Append the backend change log entry.
- `docs/environment.md`
  Only if new audio-specific env keys are actually introduced.
- `README.md`
  Only if public backend setup/flow changes.

## Task 1: Lock The Boundary

**Files:**

- Modify: `src/modules/daily-records/daily-records.controller.ts`
- Modify: `src/modules/daily-records/daily-records.module.ts`
- Test: `src/modules/daily-records/daily-records.controller.spec.ts`

- [ ] **Step 1: Write the failing controller test for the new voice endpoint**

```ts
it('routes voice candidate generation through the voice orchestration service', async () => {
  const voiceService = {
    generateFromAudio: jest.fn().mockResolvedValue({
      locale: 'zh-CN',
      generatedAt: '2026-07-01T12:00:00.000Z',
      confirmationHint: '请确认后保存',
      transcript: '今天头疼，喝了两杯水',
      items: [],
    }),
  };

  const controller = new DailyRecordsController(
    /* existing deps */,
    voiceService as never,
  );

  const result = await controller.generateCandidateRecordsFromAudio(
    mockUser(),
    {
      objectKey: 'daily-records/u1/audio/a1.m4a',
      occurredAt: '2026-07-01',
      timezone: 'Asia/Shanghai',
    },
    'zh-CN',
  );

  expect(voiceService.generateFromAudio).toHaveBeenCalled();
  expect(result.data.transcript).toBe('今天头疼，喝了两杯水');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- src/modules/daily-records/daily-records.controller.spec.ts`
Expected: FAIL because the controller method/service dependency does not exist yet.

- [ ] **Step 3: Add the endpoint and provider wiring with minimal code**

```ts
@Post('candidate-records/generate-from-audio')
generateCandidateRecordsFromAudio(
  @AuthUser() user: AuthenticatedUser,
  @Body() dto: GenerateDailyRecordCandidatesFromAudioDto,
  @I18nLang() language: string,
) {
  return this.dailyRecordCandidatesVoiceService.generateFromAudio(
    user.id,
    dto,
    language,
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- src/modules/daily-records/daily-records.controller.spec.ts`
Expected: PASS

## Task 2: Add Trusted Audio Upload

**Files:**

- Create: `src/modules/daily-records/dto/daily-record-audio-upload.dto.ts`
- Create: `src/modules/daily-records/services/daily-record-audio-upload.service.ts`
- Modify: `src/modules/daily-records/daily-records.controller.ts`
- Test: `src/modules/daily-records/services/daily-record-audio-upload.service.spec.ts`

- [ ] **Step 1: Write the failing audio upload service test**

```ts
it('creates a presigned upload for supported audio types', async () => {
  const runtime = {
    createSignedPutUrl: jest
      .fn()
      .mockReturnValue('https://cos.example.com/upload'),
  };
  const service = new DailyRecordAudioUploadService(runtime as never);

  const result = await service.createPresignedUpload('u1', {
    fileName: 'note.m4a',
    contentType: 'audio/mp4',
    sizeBytes: 1024,
  });

  expect(result.objectKey).toContain('daily-records/u1/audio/');
  expect(runtime.createSignedPutUrl).toHaveBeenCalled();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- src/modules/daily-records/services/daily-record-audio-upload.service.spec.ts`
Expected: FAIL because the service/file does not exist yet.

- [ ] **Step 3: Implement minimal trusted audio presign logic**

```ts
const SUPPORTED_AUDIO_TYPES = [
  'audio/mp4',
  'audio/mpeg',
  'audio/wav',
  'audio/webm',
];

if (!SUPPORTED_AUDIO_TYPES.includes(dto.contentType)) {
  throw new BadRequestException('Unsupported audio content type.');
}

const objectKey = `daily-records/${userId}/audio/${randomUUID()}.${ext}`;
return {
  objectKey,
  uploadUrl: this.runtime.createSignedPutUrl({
    objectKey,
    contentType: dto.contentType,
  }),
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- src/modules/daily-records/services/daily-record-audio-upload.service.spec.ts`
Expected: PASS

## Task 3: Add Audio Transcription Service

**Files:**

- Create: `src/modules/daily-records/services/daily-record-audio-transcription.service.ts`
- Test: `src/modules/daily-records/services/daily-record-audio-transcription.service.spec.ts`
- Modify: `src/modules/llm-runtime/services/llm-runtime.service.ts` only if needed

- [ ] **Step 1: Write the failing transcription service test**

```ts
it('reads trusted audio and returns a normalized transcript', async () => {
  const runtime = {
    createSignedGetUrl: jest
      .fn()
      .mockReturnValue('https://cos.example.com/audio.m4a'),
  };
  const llmRuntime = {
    hasRoleConfig: jest.fn().mockReturnValue(true),
  };
  const service = new DailyRecordAudioTranscriptionService(
    runtime as never,
    llmRuntime as never,
  );

  const transcript = await service.transcribeTrustedAudio({
    userId: 'u1',
    objectKey: 'daily-records/u1/audio/a1.m4a',
  });

  expect(runtime.createSignedGetUrl).toHaveBeenCalledWith(
    'daily-records/u1/audio/a1.m4a',
  );
  expect(transcript.text.length).toBeGreaterThan(0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- src/modules/daily-records/services/daily-record-audio-transcription.service.spec.ts`
Expected: FAIL because the service does not exist yet.

- [ ] **Step 3: Implement the minimal transcription boundary**

```ts
if (!objectKey.startsWith(`daily-records/${userId}/audio/`)) {
  throw new ForbiddenException(
    'Audio object key is outside the user audio namespace.',
  );
}

if (!this.llmRuntimeService.hasRoleConfig('language')) {
  throw new ServiceUnavailableException('Language model is not configured.');
}

const signedUrl = this.runtime.createSignedGetUrl(objectKey);

// First phase contract:
// - invoke configured OpenAI-compatible language/audio model
// - normalize transcript whitespace
// - return { text, durationSeconds?: null, model?: string | null }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- src/modules/daily-records/services/daily-record-audio-transcription.service.spec.ts`
Expected: PASS

## Task 4: Reuse Existing Candidate Generation

**Files:**

- Create: `src/modules/daily-records/services/daily-record-candidates-voice.service.ts`
- Create: `src/modules/daily-records/services/daily-record-candidates-voice.service.spec.ts`
- Modify: `src/modules/daily-records/dto/daily-record-candidate-response.dto.ts` only if transcript should be returned explicitly

- [ ] **Step 1: Write the failing orchestration test**

```ts
it('passes the transcript into the existing candidate generator', async () => {
  const transcriptionService = {
    transcribeTrustedAudio: jest.fn().mockResolvedValue({
      text: '今天头疼，早上喝了两杯水',
    }),
  };
  const candidatesService = {
    generate: jest.fn().mockResolvedValue({
      locale: 'zh-CN',
      generatedAt: '2026-07-01T12:00:00.000Z',
      confirmationHint: '请确认后保存',
      items: [],
    }),
  };
  const service = new DailyRecordCandidatesVoiceService(
    transcriptionService as never,
    candidatesService as never,
  );

  await service.generateFromAudio(
    'u1',
    {
      objectKey: 'daily-records/u1/audio/a1.m4a',
      occurredAt: '2026-07-01',
      timezone: 'Asia/Shanghai',
    },
    'zh-CN',
  );

  expect(candidatesService.generate).toHaveBeenCalledWith(
    {
      text: '今天头疼，早上喝了两杯水',
      occurredAt: '2026-07-01',
      timezone: 'Asia/Shanghai',
    },
    'zh-CN',
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- src/modules/daily-records/services/daily-record-candidates-voice.service.spec.ts`
Expected: FAIL because the orchestration service does not exist yet.

- [ ] **Step 3: Implement minimal orchestration**

```ts
const transcript = await this.transcriptionService.transcribeTrustedAudio({
  userId,
  objectKey: dto.objectKey,
});

const generated = await this.dailyRecordCandidatesService.generate(
  {
    text: transcript.text,
    occurredAt: dto.occurredAt,
    timezone: dto.timezone,
  },
  language,
);

return {
  ...generated,
  transcript: transcript.text,
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- src/modules/daily-records/services/daily-record-candidates-voice.service.spec.ts`
Expected: PASS

## Task 5: Verify Guardrails And Docs

**Files:**

- Modify: `docs/Current_State.md`
- Modify: `docs/migration-log/2026-07-01.md`
- Modify: `docs/environment.md` only if env contract changes
- Modify: `README.md` only if setup or public endpoint docs change

- [ ] **Step 1: Write or extend focused tests for safety boundaries**

```ts
it('rejects object keys outside the user audio namespace', async () => {
  await expect(
    service.transcribeTrustedAudio({
      userId: 'u1',
      objectKey: 'daily-records/u2/audio/other.m4a',
    }),
  ).rejects.toBeInstanceOf(ForbiddenException);
});
```

- [ ] **Step 2: Run tests to verify they fail first**

Run: `pnpm test -- src/modules/daily-records/services/daily-record-audio-transcription.service.spec.ts`
Expected: FAIL until the guard exists.

- [ ] **Step 3: Implement the guard and update docs**

```md
- Voice input now uses trusted audio upload + ASR transcription, then reuses the existing text-to-candidate-record generation chain.
```

- [ ] **Step 4: Run final verification**

Run:

```bash
pnpm lint:check
pnpm typecheck
pnpm test -- src/modules/daily-records/services/daily-record-audio-upload.service.spec.ts src/modules/daily-records/services/daily-record-audio-transcription.service.spec.ts src/modules/daily-records/services/daily-record-candidates-voice.service.spec.ts src/modules/daily-records/daily-records.controller.spec.ts
```

Expected: all PASS

## Notes

- Do not replace `DailyRecordCandidatesGeneratorService`; it remains the only structured record-generation path.
- Do not make the speech model emit final record items directly in phase 1.
- Reuse current `language` role unless runtime verification proves Qwen's audio interface requires a separate role or API shape.
- If the chosen OpenAI-compatible provider does not actually support audio transcription on the current endpoint, stop and switch the plan to a dedicated ASR-capable provider instead of faking support.
