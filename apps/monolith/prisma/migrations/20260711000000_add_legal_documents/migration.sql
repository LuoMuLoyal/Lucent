-- CreateTable
CREATE TABLE "legal_documents" (
    "id" TEXT NOT NULL,
    "doc_type" TEXT NOT NULL,
    "title_zh" TEXT NOT NULL,
    "title_en" TEXT NOT NULL,
    "content_zh" TEXT NOT NULL,
    "content_en" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "legal_documents_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "legal_documents_doc_type_key" ON "legal_documents"("doc_type");

-- CreateIndex
CREATE INDEX "legal_documents_is_active_idx" ON "legal_documents"("is_active");

-- Insert placeholder data for all legal document types
INSERT INTO "legal_documents" ("id", "doc_type", "title_zh", "title_en", "content_zh", "content_en", "is_active")
VALUES
  (
    gen_random_uuid(),
    'terms',
    '用户协议',
    'Terms of Service',
    '# 用户协议

> 待法务审阅填充

## 一、服务说明

Luminous 是一款健康管理应用，提供用药记录、健康数据追踪、AI 建议等功能。

## 二、用户注册与账号

用户需提供真实信息注册账号，账号仅限本人使用。

## 三、用户行为规范

用户不得利用本应用从事违法违规活动，不得上传虚假健康信息。

## 四、知识产权

本应用的所有内容版权归开发者所有，未经授权不得转载。

## 五、免责声明

具体医疗免责声明请参阅单独的免责声明页面。

## 六、协议变更

本协议可能不时更新，更新后将在应用内提示用户。',
    '# Terms of Service

> Pending legal review

## 1. Service Description

Luminous is a health management application that provides medication tracking, health data recording, and AI-powered suggestions.

## 2. Registration and Account

Users must provide accurate information to register. Accounts are for personal use only.

## 3. User Conduct

Users must not use the application for illegal activities or upload false health information.

## 4. Intellectual Property

All content in this application is copyrighted by the developer. Unauthorized reproduction is prohibited.

## 5. Disclaimer

Please refer to the separate disclaimer page for medical disclaimers.

## 6. Changes to Terms

These terms may be updated from time to time. Users will be notified within the application.',
    true
  ),
  (
    gen_random_uuid(),
    'privacy',
    '隐私政策',
    'Privacy Policy',
    '# 隐私政策

> 待法务审阅填充

## 一、数据处理者信息

公司名称：待填充
联系邮箱：待填充
个人信息保护负责人：待填充

## 二、处理目的、方式、种类、保存期限

| 数据类型 | 处理目的 | 处理方式 | 保存期限 |
|---------|---------|---------|---------|
| 基本账户信息（邮箱、昵称） | 账户管理 | 存储 | 账户注销后 30 天 |
| 健康记录 | 健康追踪与分析 | 存储与处理 | 账户注销后 30 天 |
| 用药记录 | 用药提醒与安全分析 | 存储与处理 | 账户注销后 30 天 |

## 三、用户权利清单

- 查阅权：用户可在应用内查看所有个人数据
- 复制权：用户可通过数据导出功能获取数据副本
- 更正权：用户可在应用内修改个人信息
- 删除权：用户可通过注销账户删除所有数据
- 撤回同意权：用户可在设置中关闭特定数据处理
- 注销账户权：用户可在设置中申请账户注销
- 投诉权：用户可通过邮件向开发者投诉

## 四、第三方共享情况

具体第三方 SDK 清单请参阅第三方 SDK 清单页面。

## 五、跨境传输情况

本应用数据存储在中国境内的服务器，不涉及跨境传输。

## 六、未成年人特别说明

本应用不建议未成年人单独使用。如未成年人需使用，应在监护人同意下使用。

## 七、政策更新通知机制

隐私政策重大变更时，将在应用内推送通知提示用户。',
    '# Privacy Policy

> Pending legal review

## 1. Data Controller Information

Company name: TBD
Contact email: TBD
Data Protection Officer: TBD

## 2. Processing Purpose, Method, Data Types, Retention

| Data Type | Purpose | Method | Retention |
|-----------|---------|--------|-----------|
| Basic account info (email, nickname) | Account management | Storage | 30 days after account deletion |
| Health records | Health tracking and analysis | Storage & processing | 30 days after account deletion |
| Medication records | Medication reminders and safety analysis | Storage & processing | 30 days after account deletion |

## 3. User Rights

- Access: Users can view all personal data in the app
- Copy: Users can export data via the data export feature
- Correction: Users can modify personal information in the app
- Deletion: Users can delete all data by deleting their account
- Withdraw consent: Users can disable specific data processing in settings
- Account deletion: Users can request account deletion in settings
- Complaint: Users can file complaints via email

## 4. Third-party Sharing

Please refer to the Third-party SDK List page for details.

## 5. Cross-border Transfer

Data is stored on servers within China. No cross-border transfer is involved.

## 6. Minors

This application is not recommended for minors to use independently. If minors need to use it, they should do so with guardian consent.

## 7. Policy Update Notification

Users will be notified in the app when significant changes are made to this privacy policy.',
    true
  ),
  (
    gen_random_uuid(),
    'disclaimer',
    '医疗免责声明',
    'Medical Disclaimer',
    '# 医疗免责声明

> 待法务审阅填充

## 重要提示

1. **本应用提供的信息不构成医疗建议。**

2. **本应用不替代医生诊断和处方。**

3. **用药决策应遵医嘱。**

4. **AI 生成的总结和报告仅供参考，不作为诊疗依据。**

## 详细说明

Luminous 是一款健康管理工具，旨在帮助用户记录和追踪健康数据。应用中的所有内容（包括但不限于用药提醒、健康分析、AI 建议、报告等）均为信息参考，不构成专业的医疗诊断、治疗或处方建议。

用户在做出任何医疗决策前，应咨询合格的医疗专业人员。开发者不对用户基于应用信息做出的任何决策承担责任。

如遇紧急医疗情况，请立即拨打急救电话或前往就近医院就诊。',
    '# Medical Disclaimer

> Pending legal review

## Important Notice

1. **The information provided by this application does not constitute medical advice.**

2. **This application does not replace doctor diagnosis and prescriptions.**

3. **Medication decisions should follow medical advice.**

4. **AI-generated summaries and reports are for reference only and should not be used as a basis for diagnosis or treatment.**

## Detailed Description

Luminous is a health management tool designed to help users record and track health data. All content in the application (including but not limited to medication reminders, health analysis, AI suggestions, reports, etc.) is for informational reference only and does not constitute professional medical diagnosis, treatment, or prescription advice.

Users should consult qualified medical professionals before making any medical decisions. The developer is not responsible for any decisions made by users based on application information.

In case of a medical emergency, please call emergency services or go to the nearest hospital immediately.',
    true
  ),
  (
    gen_random_uuid(),
    'minor-protection',
    '未成年人保护说明',
    'Minor Protection Statement',
    '# 未成年人保护说明

> 待法务审阅填充

## 一、使用限制

本应用主要面向成年人。未成年人应在监护人的指导和同意下使用本应用。

## 二、监护人同意机制

监护人应仔细阅读本说明及隐私政策，在充分了解后决定是否允许未成年人使用本应用。

## 三、未成年人信息保护

对于未成年人用户，我们将采取以下额外保护措施：
- 限制收集不必要的个人信息
- 不向未成年人推送个性化广告
- 加强健康数据的保密措施

## 四、监护人责任

监护人应：
- 监督未成年人的使用行为
- 定期检查未成年人录入的健康数据
- 及时删除不必要的健康信息',
    '# Minor Protection Statement

> Pending legal review

## 1. Usage Restrictions

This application is primarily designed for adults. Minors should use this application under the guidance and consent of their guardians.

## 2. Guardian Consent Mechanism

Guardians should carefully read this statement and the privacy policy, and decide whether to allow minors to use this application after full understanding.

## 3. Minor Information Protection

For minor users, we will take the following additional protective measures:
- Limit the collection of unnecessary personal information
- Do not push personalized advertisements to minors
- Strengthen the confidentiality of health data

## 4. Guardian Responsibilities

Guardians should:
- Supervise minors usage behavior
- Regularly check health data entered by minors
- Promptly delete unnecessary health information',
    true
  ),
  (
    gen_random_uuid(),
    'sdk-list',
    '第三方 SDK 清单',
    'Third-party SDK List',
    '# 第三方 SDK 清单

> 待整理完善

## 说明

本应用使用的第三方 SDK 清单如下：

| SDK 名称 | 用途 | 数据收集范围 |
|---------|------|------------|
| 待整理 | 待整理 | 待整理 |

## 更新机制

本清单将随应用版本更新而维护。如有新增第三方 SDK，将在更新前在此清单中补充。',
    '# Third-party SDK List

> Pending compilation

## Description

The list of third-party SDKs used in this application is as follows:

| SDK Name | Purpose | Data Collection Scope |
|----------|---------|----------------------|
| TBD | TBD | TBD |

## Update Mechanism

This list will be maintained with application version updates. If new third-party SDKs are added, they will be added to this list before the update.',
    true
  ),
  (
    gen_random_uuid(),
    'permissions',
    '权限使用说明',
    'Permissions Usage Statement',
    '# 权限使用说明

> 待整理完善

## 说明

本应用使用的系统权限清单如下：

| 权限 | 用途 |
|------|------|
| 待整理 | 待整理 |

## 更新机制

本清单将随应用版本更新而维护。',
    '# Permissions Usage Statement

> Pending compilation

## Description

The list of system permissions used by this application is as follows:

| Permission | Purpose |
|------------|---------|
| TBD | TBD |

## Update Mechanism

This list will be maintained with application version updates.',
    true
  ),
  (
    gen_random_uuid(),
    'account-cancellation',
    '账号注销政策',
    'Account Cancellation Policy',
    '# 账号注销政策

> 待法务审阅填充

## 一、注销流程

用户可在「设置 > 账号 > 注销账号」中发起注销申请。注销需验证身份（密码 + 验证码）。

## 二、数据处理

注销后，用户的以下数据将在 30 天内永久删除：
- 账户基本信息（邮箱、昵称、头像等）
- 健康记录数据
- 用药记录数据
- AI 对话历史
- 其他个人数据

## 三、不可恢复

注销操作不可撤销。30 天宽限期后，所有数据将永久删除，无法恢复。

## 四、例外情况

根据法律法规要求，部分数据可能需要保留更长时间，包括但不限于：
- 反洗钱相关数据
- 法律纠纷相关数据

## 五、注销后处理

注销完成后：
- 账户将无法登录
- 所有会话将立即失效
- 已订阅的服务将自动取消',
    '# Account Cancellation Policy

> Pending legal review

## 1. Cancellation Process

Users can initiate cancellation in Settings > Account > Delete Account. Identity verification (password + verification code) is required.

## 2. Data Processing

After cancellation, the following user data will be permanently deleted within 30 days:
- Account basic information (email, nickname, avatar, etc.)
- Health record data
- Medication record data
- AI conversation history
- Other personal data

## 3. Irreversibility

The cancellation operation is irreversible. After the 30-day grace period, all data will be permanently deleted and cannot be recovered.

## 4. Exceptions

Some data may need to be retained for a longer period as required by law, including but not limited to:
- Anti-money laundering related data
- Legal dispute related data

## 5. Post-cancellation Processing

After cancellation is complete:
- The account will not be able to log in
- All sessions will be immediately invalidated
- Subscribed services will be automatically cancelled',
    true
  );
