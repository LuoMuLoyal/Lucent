# Auth API

> Lucent 认证接口契约。前后端按此文档对齐即可并行开发。
>
> 基础约定见 [api-contract](public/api-contract.md)。响应统一 `{ code, message, data }`，分页接口附加 `meta`。

---

## 目录

- [Auth API](#auth-api)
- [目录](#目录)
- [实现对齐说明](#实现对齐说明)
- [1. 注册](#1-注册)
- [2. 登录](#2-登录)
- [3. 登出](#3-登出)
- [4. 刷新 Token](#4-刷新-token)
- [5. 发送邮箱验证码](#5-发送邮箱验证码)
- [6. 验证邮箱](#6-验证邮箱)
- [7. 忘记密码](#7-忘记密码)
- [8. 重置密码](#8-重置密码)
- [9. 获取当前用户](#9-获取当前用户)
- [10. 更新当前用户](#10-更新当前用户)
- [11. 修改密码](#11-修改密码)
- [12. 修改邮箱](#12-修改邮箱)
- [13. 注销账号](#13-注销账号)
- [认证说明](#认证说明)
- [错误码汇总](#错误码汇总)

---

## 实现对齐说明

- API 仍返回 `emailVerified: boolean`，但后端持久化字段已经是 `emailVerifiedAt`。
- 邮箱在后端会先 `trim + lowercase` 后再查重、登录和持久化。
- `refreshToken` 是不透明随机字符串，不是 JWT；数据库只保存其哈希，具体会话保存在 `user_sessions`。
- `expiresIn` 反映当前 access token 配置。示例沿用默认值 `2h`，但实际环境可通过配置改成别的 TTL。
- 修改密码、重置密码会清空该账号的所有 refresh sessions；客户端应主动清理本地会话。

---

## 1. 注册

```
POST /api/v1/auth/register
```

**Request**

```json
{
  "email": "user@example.com",
  "password": "Abc12345",
  "code": "123456",
  "nickname": "小明"
}
```

| 字段     | 类型   | 必填 | 说明                                           |
| -------- | ------ | ---- | ---------------------------------------------- |
| email    | string | 是   | 邮箱                                           |
| password | string | 是   | 8-32 字符，至少含大写、小写、数字              |
| code     | string | 是   | 通过 `send-verification-code` 获取的注册验证码 |
| nickname | string | 否   | 昵称，1-20 字符                                |

> 密码规则仅要求大写+小写+数字，特殊字符不做强制要求，但前后端需约定一致。
> 注册前需先调用 [发送邮箱验证码](#5-发送邮箱验证码)（`scene=register`）。验证码通过后，注册成功的用户邮箱视为已验证。

**Response** `201`

```json
{
  "code": 0,
  "message": "",
  "data": {
    "user": {
      "id": "u_abc123",
      "email": "user@example.com",
      "nickname": "小明",
      "emailVerified": true,
      "createdAt": "2026-05-30T12:00:00Z"
    },
    "tokens": {
      "accessToken": "eyJhbG...",
      "refreshToken": "4f8c9b1ef27c6a0a44dd6f3e1a1b2c3d4e5f60718293a4b5c6d7e8f901234567",
      "expiresIn": 7200
    }
  }
}
```

| 字段                | 类型         | 说明                                                   |
| ------------------- | ------------ | ------------------------------------------------------ |
| user.id             | string       | 用户 ID                                                |
| user.email          | string       | 邮箱                                                   |
| user.nickname       | string\|null | 昵称                                                   |
| user.emailVerified  | boolean      | 邮箱是否已验证                                         |
| user.createdAt      | string       | ISO 8601                                               |
| tokens.accessToken  | string       | JWT，TTL 由环境配置决定（默认 2h）                     |
| tokens.refreshToken | string       | opaque refresh token，服务端仅保存其哈希，TTL 默认 30d |
| tokens.expiresIn    | number       | accessToken 剩余有效秒数                               |

**Errors**

| HTTP | code   | message          |
| ---- | ------ | ---------------- |
| 400  | 400002 | DTO 字段校验详情 |
| 409  | 409001 | "该邮箱已注册"   |

---

## 2. 登录

```
POST /api/v1/auth/login
```

**Request**

密码登录：

```json
{
  "email": "user@example.com",
  "password": "Abc12345"
}
```

验证码登录：

```json
{
  "email": "user@example.com",
  "code": "123456"
}
```

| 字段     | 类型   | 必填 | 说明             |
| -------- | ------ | ---- | ---------------- |
| email    | string | 是   | 邮箱             |
| password | string | 否\* | 密码登录时必填   |
| code     | string | 否\* | 验证码登录时必填 |

> `password` 和 `code` 二选一。

**Response** `200`

```json
{
  "code": 0,
  "message": "",
  "data": {
    "user": {
      "id": "u_abc123",
      "email": "user@example.com",
      "nickname": "小明",
      "avatar": "https://cdn.example.com/avatars/u_abc123.jpg",
      "emailVerified": true,
      "createdAt": "2026-05-30T12:00:00Z",
      "updatedAt": "2026-05-30T12:30:00Z"
    },
    "tokens": {
      "accessToken": "eyJhbG...",
      "refreshToken": "4f8c9b1ef27c6a0a44dd6f3e1a1b2c3d4e5f60718293a4b5c6d7e8f901234567",
      "expiresIn": 7200
    }
  }
}
```

**Errors**

| HTTP    | code   | message                             |
| ------- | ------ | ----------------------------------- |
| 400     | 400002 | DTO 字段校验详情                    |
| 401     | 401001 | "邮箱或密码错误"                    |
| 400/401 | 400100 | "验证码错误或已过期"                |
| 401     | 401004 | "登录失败次数过多，请 N 分钟后重试" |

---

## 3. 登出

```
POST /api/v1/auth/logout
Authorization: Bearer <accessToken>
```

**Request**

```json
{
  "refreshToken": "4f8c9b1ef27c6a0a44dd6f3e1a1b2c3d4e5f60718293a4b5c6d7e8f901234567"
}
```

| 字段         | 类型   | 必填 | 说明                              |
| ------------ | ------ | ---- | --------------------------------- |
| refreshToken | string | 是   | 当前 refreshToken，服务端将其失效 |

**Response** `200`

```json
{
  "code": 0,
  "message": "",
  "data": null
}
```

**Errors**

| HTTP | code   | message        |
| ---- | ------ | -------------- |
| 401  | 401001 | "未认证"       |
| 401  | 401002 | "Token 已过期" |

> accessToken 为短期 JWT（默认 2h，可配置），服务端不跟踪其即时失效。
> 登出主要目的是使本次 refresh session 失效。
> 当前实现会把 `refreshToken` 约束在当前 JWT 用户名下，只失效“当前用户持有的该 refresh session”，不会跨账号删除别人的 session。

---

## 4. 刷新 Token

> 此接口不需要 `Authorization` 头——accessToken 可能已过期，刷新正是为了获取新 token。

```
POST /api/v1/auth/refresh
```

**Request**

```json
{
  "refreshToken": "4f8c9b1ef27c6a0a44dd6f3e1a1b2c3d4e5f60718293a4b5c6d7e8f901234567"
}
```

| 字段         | 类型   | 必填 | 说明                           |
| ------------ | ------ | ---- | ------------------------------ |
| refreshToken | string | 是   | 登录/注册时返回的 refreshToken |

**Response** `200`

```json
{
  "code": 0,
  "message": "",
  "data": {
    "accessToken": "eyJhbG...",
    "refreshToken": "9ab81234cd56ef7890aa11bb22cc33dd44ee55ff6677889900aabbccddeeff11",
    "expiresIn": 7200
  }
}
```

> 每次刷新后旧 refreshToken 失效，返回全新的 token 对。
> 只轮换本次使用的 refreshToken，不影响同账号其他设备会话。

**Errors**

| HTTP | code   | message                     |
| ---- | ------ | --------------------------- |
| 400  | 400002 | "refreshToken 不能为空"     |
| 401  | 401003 | "refreshToken 无效或已过期" |

---

## 5. 发送邮箱验证码

```
POST /api/v1/auth/send-verification-code
```

**Request**

```json
{
  "email": "user@example.com",
  "scene": "register"
}
```

| 字段  | 类型   | 必填 | 说明                                                     |
| ----- | ------ | ---- | -------------------------------------------------------- |
| email | string | 是   | 邮箱                                                     |
| scene | string | 是   | `register` / `login` / `reset-password` / `change-email` |

**Response** `200`

```json
{
  "code": 0,
  "message": "",
  "data": {
    "cooldown": 60,
    "message": "验证码已发送"
  }
}
```

| 字段     | 类型   | 说明               |
| -------- | ------ | ------------------ |
| cooldown | number | 下次可重发冷却秒数 |
| message  | string | 本次发送结果提示   |

**Errors**

| HTTP | code   | message                       |
| ---- | ------ | ----------------------------- |
| 400  | 400002 | "scene 取值不合法"            |
| 400  | 400101 | "发送过于频繁，请 N 秒后再试" |

---

## 6. 验证邮箱

```
POST /api/v1/auth/verify-email
```

**Request**

```json
{
  "email": "user@example.com",
  "code": "123456"
}
```

| 字段  | 类型   | 必填 | 说明   |
| ----- | ------ | ---- | ------ |
| email | string | 是   | 邮箱   |
| code  | string | 是   | 验证码 |

**Response** `200`

```json
{
  "code": 0,
  "message": "",
  "data": {
    "emailVerified": true
  }
}
```

**Errors**

| HTTP    | code   | message              |
| ------- | ------ | -------------------- |
| 400     | 400002 | DTO 字段校验详情     |
| 400/401 | 400100 | "验证码错误或已过期" |

---

## 7. 忘记密码

```
POST /api/v1/auth/forgot-password
```

**Request**

```json
{
  "email": "user@example.com"
}
```

| 字段  | 类型   | 必填 | 说明     |
| ----- | ------ | ---- | -------- |
| email | string | 是   | 注册邮箱 |

**Response** `200`

```json
{
  "code": 0,
  "message": "",
  "data": {
    "cooldown": 60,
    "message": "若邮箱已注册，我们已发送重置说明"
  }
}
```

> 无论邮箱是否已注册，均返回成功（防止邮箱枚举）。验证码实际只发送给已注册邮箱。
> 当前实现会继续返回 `cooldown + message`，其中 `message` 是给前端直接展示的通用提示。

| 字段     | 类型   | 说明                             |
| -------- | ------ | -------------------------------- |
| cooldown | number | 下次可重发冷却秒数               |
| message  | string | 通用提示文案，不暴露邮箱是否存在 |

**Errors**

| HTTP | code   | message                       |
| ---- | ------ | ----------------------------- |
| 400  | 400002 | "邮箱格式不正确"              |
| 400  | 400101 | "发送过于频繁，请 N 秒后再试" |

---

## 8. 重置密码

```
POST /api/v1/auth/reset-password
```

**Request**

```json
{
  "email": "user@example.com",
  "code": "123456",
  "password": "NewAbc123"
}
```

| 字段     | 类型   | 必填 | 说明                                      |
| -------- | ------ | ---- | ----------------------------------------- |
| email    | string | 是   | 邮箱                                      |
| code     | string | 是   | 验证码                                    |
| password | string | 是   | 新密码，8-32 字符，至少含大写、小写、数字 |

**Response** `200`

```json
{
  "code": 0,
  "message": "",
  "data": null
}
```

> 重置成功后，该账号的所有 refresh sessions 都会失效。

**Errors**

| HTTP    | code   | message              |
| ------- | ------ | -------------------- |
| 400     | 400002 | DTO 字段校验详情     |
| 400/401 | 400100 | "验证码错误或已过期" |
| 404     | 404001 | "用户不存在"         |

> 当前实现的精确语义是：
>
> - 验证码不通过：返回 `400100`
> - 验证码通过但邮箱不存在：返回 `404001`
>
> 也就是说，接口只在“验证码校验阶段”做防枚举兜底，不会把“验证码已通过但用户不存在”继续折叠成 `400100`。

---

## 9. 获取当前用户

```
GET /api/v1/auth/me
Authorization: Bearer <accessToken>
```

**Response** `200`

```json
{
  "code": 0,
  "message": "",
  "data": {
    "id": "u_abc123",
    "email": "user@example.com",
    "nickname": "小明",
    "avatar": "https://cdn.example.com/avatars/u_abc123.jpg",
    "emailVerified": true,
    "createdAt": "2026-05-30T12:00:00Z",
    "updatedAt": "2026-05-30T12:30:00Z"
  }
}
```

**Errors**

| HTTP | code   | message        |
| ---- | ------ | -------------- |
| 401  | 401001 | "未认证"       |
| 401  | 401002 | "Token 已过期" |

---

## 10. 更新当前用户

```
PATCH /api/v1/auth/me
Authorization: Bearer <accessToken>
```

**Request**

```json
{
  "nickname": "新昵称",
  "avatar": "https://cdn.example.com/avatars/new.jpg"
}
```

| 字段     | 类型   | 必填 | 说明                                |
| -------- | ------ | ---- | ----------------------------------- |
| nickname | string | 否   | 昵称，1-20 字符，传空字符串视为清空 |
| avatar   | string | 否   | 头像字符串，传空字符串视为清空      |

**Response** `200`

```json
{
  "code": 0,
  "message": "",
  "data": {
    "id": "u_abc123",
    "email": "user@example.com",
    "nickname": "新昵称",
    "avatar": "https://cdn.example.com/avatars/new.jpg",
    "emailVerified": true,
    "createdAt": "2026-05-30T12:00:00Z",
    "updatedAt": "2026-05-30T13:00:00Z"
  }
}
```

**Errors**

| HTTP | code   | message          |
| ---- | ------ | ---------------- |
| 400  | 400002 | DTO 字段校验详情 |
| 401  | 401001 | "未认证"         |
| 401  | 401002 | "Token 已过期"   |

---

## 11. 修改密码

```
POST /api/v1/auth/me/password
Authorization: Bearer <accessToken>
```

**Request**

```json
{
  "oldPassword": "Abc12345",
  "newPassword": "NewAbc678"
}
```

| 字段        | 类型   | 必填 | 说明                                      |
| ----------- | ------ | ---- | ----------------------------------------- |
| oldPassword | string | 是   | 当前密码                                  |
| newPassword | string | 是   | 新密码，8-32 字符，至少含大写、小写、数字 |

**Response** `200`

```json
{
  "code": 0,
  "message": "",
  "data": null
}
```

> 修改成功后，该账号的所有 refresh sessions 都会失效，包括当前设备。
>
> accessToken 是无状态 JWT，客户端应在成功后主动清理本地会话并按需重新登录。

**Errors**

| HTTP | code   | message          |
| ---- | ------ | ---------------- |
| 400  | 400002 | DTO 字段校验详情 |
| 401  | 401001 | "未认证"         |
| 401  | 401005 | "当前密码错误"   |

---

## 12. 修改邮箱

> 需先调用 [发送邮箱验证码](#5-发送邮箱验证码)（`scene=change-email`）获取发往新邮箱的验证码。

```
POST /api/v1/auth/me/email
Authorization: Bearer <accessToken>
```

**Request**

```json
{
  "newEmail": "newuser@example.com",
  "code": "123456"
}
```

| 字段     | 类型   | 必填 | 说明               |
| -------- | ------ | ---- | ------------------ |
| newEmail | string | 是   | 新邮箱             |
| code     | string | 是   | 发往新邮箱的验证码 |

**Response** `200`

```json
{
  "code": 0,
  "message": "",
  "data": {
    "email": "newuser@example.com",
    "emailVerified": true
  }
}
```

> `newEmail` 在后端会先 `trim + lowercase` 后再校验、查重和持久化；响应中的 `data.email` 返回规范化后的最终邮箱值。

**Errors**

| HTTP    | code   | message                  |
| ------- | ------ | ------------------------ |
| 400     | 400002 | DTO 字段校验详情         |
| 400/401 | 400100 | "验证码错误或已过期"     |
| 401     | 401001 | "未认证"                 |
| 409     | 409001 | "该邮箱已被其他账号使用" |

---

## 13. 注销账号

```
DELETE /api/v1/auth/me
Authorization: Bearer <accessToken>
```

**Request**

```json
{
  "password": "Abc12345"
}
```

| 字段     | 类型   | 必填 | 说明               |
| -------- | ------ | ---- | ------------------ |
| password | string | 是   | 当前密码，二次确认 |

**Response** `200`

```json
{
  "code": 0,
  "message": "",
  "data": null
}
```

> 账号进入软删除状态（`deletedAt` + `status=deleted`），期间可以保留恢复空间。
>
> 注销后该账号所有 refresh sessions 立即失效。

**Errors**

| HTTP | code   | message          |
| ---- | ------ | ---------------- |
| 400  | 400002 | DTO 字段校验详情 |
| 401  | 401001 | "未认证"         |
| 401  | 401005 | "密码错误"       |

---

## 认证说明

- 受保护接口通过 `Authorization: Bearer <accessToken>` 认证
- 用户身份从 JWT payload 派生，不接受 body / query 中的 `userId`
- 邮箱按大小写不敏感处理，后端会在鉴权前做 `trim + lowercase`
- accessToken 过期后客户端调用 `/auth/refresh` 换取新 token
- refreshToken 每次使用后轮换（旧 token 立即失效）
- refreshToken 是 opaque session secret，服务端仅以哈希形式存入 `user_sessions`
- refresh 不影响同账号其他设备的 refresh sessions
- 重置密码或修改密码后，所有 refresh sessions 失效；客户端应清理本地会话

---

## 错误码汇总

| code   | HTTP      | 说明                                |
| ------ | --------- | ----------------------------------- |
| 0      | 200/201   | 成功                                |
| 400002 | 400       | 字段校验失败，message 含详情        |
| 400100 | 400 / 401 | 验证码错误或已过期                  |
| 400101 | 400       | 验证码发送冷却中                    |
| 401001 | 401       | 未认证（无 token / token 格式错误） |
| 401002 | 401       | accessToken 过期                    |
| 401003 | 401       | refreshToken 无效或过期             |
| 401004 | 401       | 登录失败次数过多，触发风控          |
| 401005 | 401       | 当前密码错误                        |
| 409001 | 409       | 邮箱已注册 / 已被占用               |
