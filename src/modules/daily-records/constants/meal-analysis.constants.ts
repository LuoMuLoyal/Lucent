export const MEAL_ANALYSIS_QUEUE_NAME = 'lucent-meal-analysis';
export const MEAL_ANALYSIS_JOB_NAME = 'analyze-meal-record';

/** 多模态分析的作业名（与一次性分析作业共用队列，靠 worker 幂等跳过旧 revision）。 */
export const MEAL_ANALYSIS_REAP_JOB_NAME = 'reap-stale-meal-analyses';

/** `analyzing` 过期回收的调度表达式（每 5 分钟一次，与低频率 cron 队列同源）。 */
export const MEAL_ANALYSIS_REAP_CRON = '*/5 * * * *';

/**
 * 超过这个时长仍是 `analyzing` 的记录视为作业已丢失（进程崩溃/队列丢单），
 * 落 `analysis_failed(model_timeout)` 让用户能重试。
 *
 * 远大于单次模型调用的 timeout：正常作业只可能因崩溃而超过它。
 */
export const MEAL_ANALYSIS_STALE_AFTER_MS = 10 * 60 * 1000;

/** 单轮回收的记录上限，避免一次扫描把长尾拉满。 */
export const MEAL_ANALYSIS_REAP_BATCH_SIZE = 200;

/** 多模态调用超时（含结构化输出）。比通用 AI timeout 宽松：视觉 + 结构化输出更慢。 */
export const MEAL_ANALYSIS_VISION_TIMEOUT_MS = 20_000;

/** 用户未设置语言时的兜底（产品以中文为主）。 */
export const MEAL_ANALYSIS_DEFAULT_LOCALE = 'zh-CN';
