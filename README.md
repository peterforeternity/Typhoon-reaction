# 台风监测与预警平台

一个 Cloudflare Worker/Next 兼容的台风监测台，包含官方路径数据获取、强度趋势分析、预警规则评估和邮件推送接口。

## 功能

- 实时读取香港天文台热带气旋路径开放数据。
- 展示台风生成状态、移动路径、预报路径、当前强度和风速趋势。
- 支持按风速、等级、关注点距离和快速增强条件触发预警。
- 支持 Resend 邮件发送，也支持自定义 `EMAIL_WEBHOOK_URL`。
- 官方数据不可达时自动切换到演示样本，便于界面和规则流程验证。

## 本地运行

```bash
npm run dev
```

打开 `http://localhost:3000/`。

## 邮件配置

复制 `.env.example` 并填入：

```bash
RESEND_API_KEY=
ALERT_FROM=Typhoon Monitor <alerts@example.com>
ALERT_TO=ops@example.com
EMAIL_WEBHOOK_URL=
```

`RESEND_API_KEY` 与 `ALERT_FROM` 存在时走 Resend；否则如果配置了 `EMAIL_WEBHOOK_URL`，会向该 Webhook 投递邮件负载；都未配置时返回 dry-run 状态。
