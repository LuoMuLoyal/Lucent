import { config as loadEnv } from 'dotenv';
import { ConfigService } from '@nestjs/config';
import winston from 'winston';
import { EnvKey } from '../../src/config/env/env-keys.enum.ts';
import { llmConfig } from '../../src/config/services/llm.config.ts';
import { LlmRuntimeService } from '../../src/llm-runtime/llm-runtime.service.ts';
import { PrismaService } from '../../src/prisma/prisma.service.ts';
import { MealAnalysisVisionService } from '../../src/modules/daily-records/services/meal-analysis/vision.service.ts';
import { MealDishDecompositionService } from '../../src/modules/daily-records/services/meal-dish/decomposition.service.ts';
import { MealIngredientGroundingService } from '../../src/modules/daily-records/services/meal-ingredient/grounding.service.ts';
import { MealAnalysisMatcherService } from '../../src/modules/daily-records/services/meal-analysis/matcher.service.ts';
import { LlmSafetyPolicyService } from '../../src/common/llm/safety/llm-safety-policy.service.ts';

loadEnv({ path: '.env.development.local', override: false });
loadEnv({ path: '.env.development', override: false });

if (process.env[EnvKey.NODE_ENV] == null) {
  process.env[EnvKey.NODE_ENV] = 'development';
}

const imageUrls = [
  'https://materials.cdn.bcebos.com/images/62384418/60c4c688661c0b2a4e129b816ebf5d27.jpeg',
  'https://ts1.tc.mm.bing.net/th/id/R-C.f8c1b57ed42d179444e27a2e3982e7d7?rik=Cn01Wc6w%2bT5Ceg&riu=http%3a%2f%2fn.sinaimg.cn%2fsinakd20230301ac%2f384%2fw2048h1536%2f20230301%2f28e6-cf296c514fd47f55e803926a431f34e2.jpg&ehk=8NqxdcoaB00X9mYIgmAT7Dw8QHaWMvycF7wXzwCrOPg%3d&risl=&pid=ImgRaw&r=0',
  'https://p.qpic.cn/dnfbbspic/0/dnfbbs_dnfbbs_dnf_gamebbs_qq_com_forum_202102_27_125347rpdppbxbfxe2gnzd.jpg/0',
];

async function main() {
  const configService = new ConfigService(process.env);
  const logger = winston.createLogger({
    transports: [new winston.transports.Console()],
  });
  const prisma = new PrismaService(configService, logger);
  const llmRuntimeService = new LlmRuntimeService(llmConfig());
  const safetyPolicyService = new LlmSafetyPolicyService(llmConfig());
  const mealAnalysisVisionService = new MealAnalysisVisionService(
    llmRuntimeService,
    safetyPolicyService,
  );
  const mealDishDecompositionService = new MealDishDecompositionService(
    prisma,
    llmRuntimeService,
  );
  const mealIngredientGroundingService = new MealIngredientGroundingService(
    prisma,
    configService,
  );
  const mealAnalysisMatcherService = new MealAnalysisMatcherService(
    mealDishDecompositionService,
    mealIngredientGroundingService,
    configService,
  );

  await prisma.$connect();

  try {
    const foodItemCount = await prisma.foodCompositionItem.count();
    const templateCount = await prisma.mealDishTemplate.count();

    console.log(
      JSON.stringify(
        {
          provider: process.env[EnvKey.AI_PROVIDER] ?? null,
          hasVisionModel: mealAnalysisVisionService.isConfigured(),
          hasLanguageModel: llmRuntimeService.hasRoleConfig('language'),
          foodCompositionItemCount: foodItemCount,
          mealDishTemplateCount: templateCount,
        },
        null,
        2,
      ),
    );

    for (const [index, imageUrl] of imageUrls.entries()) {
      console.log(`\n=== IMAGE ${String(index + 1)} ===`);
      const recognition =
        await mealAnalysisVisionService.recognizeFromImageUrl(imageUrl);
      const matched = await mealAnalysisMatcherService.matchAndEstimate(
        recognition.foodItems,
      );

      console.log(
        JSON.stringify(
          {
            imageUrl,
            mealDescription: recognition.mealDescription,
            rawFoodItems: recognition.foodItems,
            coverage: matched.coverage,
            recognizedDishes: matched.recognizedDishes,
            resolvedIngredients: matched.resolvedIngredients,
            compositionMatches: matched.compositionMatches,
            nutritionEstimate: matched.nutritionEstimate,
            mealCommentary: matched.mealCommentary,
            matchDiagnostics: matched.matchDiagnostics,
          },
          null,
          2,
        ),
      );
    }
  } finally {
    await prisma.$disconnect();
  }
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
