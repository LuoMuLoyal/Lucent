# Auth API

> 标准 RESTful 认证模块 mock，前后端以此文档对齐即可并行开发。
>
> 基础约定见 [api-contract](public/api-contract.md)。响应统一 `{ code, message, data }`，分页接口附加 `meta`。

---

## 目录

- [Auth API](#auth-api)
  - [目录](#目录)
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

## 1. 注册

```
POST /api/v1/auth/register
```

**Request**

```json
{
  "email": "user@example.com",
  "password": "Abc12345",
  "nickname": "小明"
}
```

| 字段     | 类型   | 必填 | 说明                              |
| -------- | ------ | ---- | --------------------------------- |
| email    | string | 是   | 邮箱                              |
| password | string | 是   | 8-32 字符，至少含大写、小写、数字 |
| nickname | string | 否   | 昵称，1-20 字符                   |

> 密码规则仅要求大写+小写+数字，特殊字符不做强制要求，但前后端需约定一致。

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
      "emailVerified": false,
      "createdAt": "2026-05-30T12:00:00Z"
    },
    "tokens": {
      "accessToken": "eyJhbG...",
      "refreshToken": "eyJhbG...",
      "expiresIn": 7200
    }
  }
}
```

| 字段                | 类型         | 说明                     |
| ------------------- | ------------ | ------------------------ |
| user.id             | string       | 用户 ID                  |
| user.email          | string       | 邮箱                     |
| user.nickname       | string\|null | 昵称                     |
| user.emailVerified  | boolean      | 邮箱是否已验证           |
| user.createdAt      | string       | ISO 8601                 |
| tokens.accessToken  | string       | JWT，默认有效期 2h       |
| tokens.refreshToken | string       | 刷新令牌，默认有效期 30d |
| tokens.expiresIn    | number       | accessToken 剩余有效秒数 |

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
      "refreshToken": "eyJhbG...",
      "expiresIn": 7200
    }
  }
}
```

**Errors**

| HTTP | code   | message                             |
| ---- | ------ | ----------------------------------- |
| 400  | 400002 | DTO 字段校验详情                    |
| 401  | 401001 | "邮箱或密码错误"                    |
| 400  | 400100 | "验证码错误或已过期"                |
| 429  | 401004 | "登录失败次数过多，请 N 分钟后重试" |

---

## 3. 登出

```
POST /api/v1/auth/logout
Authorization: Bearer <accessToken>
```

**Request**

```json
{
  "refreshToken": "eyJhbG..."
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

> accessToken 短期有效（默认 2h），不主动失效；登出主要目的是使 refreshToken 失效。

---

## 4. 刷新 Token

> 此接口不需要 `Authorization` 头——accessToken 可能已过期，刷新正是为了获取新 token。

```
POST /api/v1/auth/refresh
```

**Request**

```json
{
  "refreshToken": "eyJhbG..."
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
    "refreshToken": "eyJhbG...",
    "expiresIn": 7200
  }
}
```

> 每次刷新后旧 refreshToken 失效，返回全新的 token 对。

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
    "cooldown": 60
  }
}
```

| 字段     | 类型   | 说明               |
| -------- | ------ | ------------------ |
| cooldown | number | 下次可重发冷却秒数 |

**Errors**

| HTTP | code   | message                       |
| ---- | ------ | ----------------------------- |
| 400  | 400002 | "scene 取值不合法"            |
| 429  | 400101 | "发送过于频繁，请 N 秒后再试" |

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

| HTTP | code   | message              |
| ---- | ------ | -------------------- |
| 400  | 400002 | DTO 字段校验详情     |
| 400  | 400100 | "验证码错误或已过期" |

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
    "cooldown": 60
  }
}
```

> 无论邮箱是否已注册，均返回成功（防止邮箱枚举）。验证码实际只发送给已注册邮箱。

**Errors**

| HTTP | code   | message                       |
| ---- | ------ | ----------------------------- |
| 400  | 400002 | "邮箱格式不正确"              |
| 429  | 400101 | "发送过于频繁，请 N 秒后再试" |

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

> 重置成功后，该账号所有旧 token 全部失效。

**Errors**

| HTTP | code   | message              |
| ---- | ------ | -------------------- |
| 400  | 400002 | DTO 字段校验详情     |
| 400  | 400100 | "验证码错误或已过期" |

> 无论邮箱是否已注册，验证码校验失败均返回 `400100`（防止邮箱枚举）。

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
| avatar   | string | 否   | 头像 URL，传空字符串视为清空        |

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

> 修改成功后，除当前 token 外该账号所有旧 token 全部失效。

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

**Errors**

| HTTP | code   | message                  |
| ---- | ------ | ------------------------ |
| 400  | 400002 | DTO 字段校验详情         |
| 400  | 400100 | "验证码错误或已过期"     |
| 401  | 401001 | "未认证"                 |
| 409  | 409001 | "该邮箱已被其他账号使用" |

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

> 账号数据保留 N 天后永久清除（软删除），期间可联系客服恢复。
>
> 注销后该账号所有 token 立即失效。

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
- accessToken 过期后客户端调用 `/auth/refresh` 换取新 token
- refreshToken 每次使用后轮换（旧 token 立即失效）
- 重置密码或修改密码后，除当前 token 外所有 token 失效

---

## 错误码汇总

| code   | HTTP    | 说明                                |
| ------ | ------- | ----------------------------------- |
| 0      | 200/201 | 成功                                |
| 400002 | 400     | 字段校验失败，message 含详情        |
| 400100 | 400     | 验证码错误或已过期                  |
| 400101 | 429     | 验证码发送冷却中                    |
| 401001 | 401     | 未认证（无 token / token 格式错误） |
| 401002 | 401     | accessToken 过期                    |
| 401003 | 401     | refreshToken 无效或过期             |
| 401004 | 429     | 登录失败次数过多，触发风控          |
| 401005 | 401     | 当前密码错误                        |
| 409001 | 409     | 邮箱已注册 / 已被占用               |
