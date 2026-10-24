import type { SessionSubject } from './session-tokens.js';

/**
 * 用户实体 → 会话归属人。
 *
 * ## 为什么单独成文件而不是各处内联
 *
 * token 的 payload 形状（`sub` / `email` / `status`）有两个消费者：签发
 * （这里的映射）与验签后的守卫判定。两边一旦漂移，症状是「登录成功但所有
 * 请求 401」。因此把「从哪里取这三个字段」收敛成一个映射，并且**只在这里**
 * 决定用户对象的最低要求。
 *
 * ## 为什么 status 必须进 token
 *
 * 「停用即时失效」靠的就是 token 里的 `status`：守卫无需查库即可拒绝
 * `status !== 'active'` 的 token。代价是停用之后签出的 token 才带新状态，
 * 正在用的旧 token 靠吊销会话或到期自然消失——这条权衡写在这里，别处不要推翻。
 */
export function toSessionSubject(user: {
  id: string;
  email: string | null;
  status: string;
}): SessionSubject {
  return {
    userId: user.id,
    email: user.email,
    status: user.status,
  };
}
