---
type: conversation-archive
created: 2026-10-09
updated: 2026-10-09
tags: [api-automation, pytest, redis, batch-registration]
status: blocked
source: Codex conversation
project: api-automation
---

# API 自动化注册流程与 50 账号批量执行记录

## 一句话结论

邮箱注册自动化全链路已经验证可用；2026-10-09 发起的 50 个账号批次成功创建 7 个，随后触发服务端 12 小时 IP 人机验证计数，剩余 43 个未创建。

## 背景与目标

目标是在 `api-automation` 项目中自动完成以下流程：

1. 生成唯一测试邮箱。
2. 请求发送注册验证码。
3. 从 Redis DB 11 读取验证码。
4. 使用 AES/RSA 协议加密注册请求。
5. 调用注册接口并解密响应。
6. 将邮箱、用户 ID、trace ID 和执行状态写入 CSV。

账号使用统一密码，但出于安全原因，本归档不保存密码、Redis 密码、令牌或验证码。

## 关键结论与决策

- Redis 验证码 key 的真实格式为 `tmd:verify:code:{email}-WEB_CLIENT-2`。
- 发送验证码接口成功响应为 `header.code=0000`、`header.message=SUCCESS`。
- 注册成功响应为 `header.code=0000`，加密响应体可以用本次请求的 AES key 和 IV 解密。
- `/h5/codes/phone/email` 使用 `@Captcha(type = "ipCode", count = 10)`。
- 服务端按 IP 统计注册验证码请求次数，计数有效期为 12 小时。超过阈值后必须提供合法的 `captchaVerification`。
- 不通过删除 Redis 限流 key、伪造参数或其他方式绕过人机验证。

## 账号结果

### 50 个账号批次

批次 ID：`20261009143740298804`

| 序号 | 邮箱 | 用户 ID | trace ID | 状态 |
|---:|---|---:|---|---|
| 1 | `auto-test-20261009143740298804-001@1.com` | 10790 | 8d60bf2583427c88b10a880c6c4f4191 | SUCCESS |
| 2 | `auto-test-20261009143740298804-002@1.com` | 10791 | 95d3435ab07df64a8040332dd19f7926 | SUCCESS |
| 3 | `auto-test-20261009143740298804-003@1.com` | 10792 | 6b5747c6d7593ca16cb1f88e7de1e639 | SUCCESS |
| 4 | `auto-test-20261009143740298804-004@1.com` | 10793 | 1fba58a712ed619c1dc4cdd76e7c3104 | SUCCESS |
| 5 | `auto-test-20261009143740298804-005@1.com` | 10794 | 56c13b77b4a9a3109500144a00662151 | SUCCESS |
| 6 | `auto-test-20261009143740298804-006@1.com` | 10795 | 6381adeb1a1749b7152f2a903c3edb05 | SUCCESS |
| 7 | `auto-test-20261009143740298804-007@1.com` | 10796 | a69fcf7f5bbd5235710d0108144c6448 | SUCCESS |

本批次统计：7 成功，43 失败。失败项没有创建账号。

### 先前单账号联调

| 邮箱 | 用户 ID | trace ID | 状态 |
|---|---:|---|---|
| `auto-test-20261009143254572610-001@1.com` | 10789 | 5ca906aa7d4b85580f1ab357bd3769a1 | SUCCESS |

截至归档时，本次对话共确认创建 8 个账号，其中 7 个属于本次 50 账号批次。

## 已完成的修改与产物

- `api/register_api.py`：组装加密注册请求。
- `utils/crypto_util.py`：AES-CBC/PKCS7 与 RSA PKCS#1 v1.5 实现。
- `utils/redis_util.py`：Redis 连接、真实验证码 key 和轮询逻辑。
- `test/test_batch_register.py`：批量发送验证码、注册、解密响应并记录报告。
- `conftest.py`：提供 `--register-count` 参数和 Redis 前置检查。
- 成功与失败明细：`/Users/cd-mac-thorne/pythonProjects/api-automation/reports/batch-register-20261009143740298804.csv`。

## 验收结果

- 单账号全链路：通过，用户 ID `10789`。
- 50 账号批次：收集 50 个用例，前 7 个注册成功。
- 第 8 个开始返回 `7777：请进行人机验证`。
- 继续高频请求后返回 `1000：请求过于频繁，请稍后再试`。
- 报告中没有保存密码、Redis 凭据或验证码。

## 待办与限制

- 本批次仍有 43 个账号未创建。
- 继续执行前需要二选一：
  - 由测试环境维护人员合法重置或放宽注册验证码 IP 策略；
  - 在自动化中接入前端完成后产生的合法 `captchaVerification`。
- 自动化应在第一次收到 `7777` 后停止当前批次，避免无意义地继续请求并触发 `1000` 限流。

## 相关

- 账号清单：[[自动化注册测试账号列表]]
- 项目：`/Users/cd-mac-thorne/pythonProjects/api-automation`
- 服务端规则：`H5ValidateCodeController.java` 的 `@Captcha(type = "ipCode", count = 10)`
- 计数实现：`RegisterIpCodeCaptchaCheck.java`，IP 计数有效期 12 小时
