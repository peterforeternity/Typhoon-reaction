# 台风监测与预警平台

一个 Cloudflare Worker/Next 兼容的台风监测台，包含官方路径与区域风场采集、影响区域筛查、120 小时强度预测、预警规则评估和邮件推送接口。

## 功能

- 实时读取香港天文台热带气旋路径与十分钟区域风场开放数据。
- 展示台风生成状态、官方路径、路径不确定范围、当前强度和风速趋势。
- 使用官方 0–24 小时预报点进行短期预测，使用 24–120 小时预报点进行中期预测。
- 结合中心风速筛查半径与官方路径误差半径，识别西北太平洋重点沿海影响区域。
- 支持按风速、等级、关注点距离和快速增强条件触发预警。
- 默认风速阈值为 63 km/h（热带风暴级），并支持按业务需要调整。
- 预警邮件包含级别、预计影响时段、影响区域、触发原因和防御建议。
- 每天北京时间 08:00 可自动检查台风生成状态并发送晨报；无台风时也会发送确认邮件。
- 支持 Resend 邮件发送，也支持自定义 `EMAIL_WEBHOOK_URL`。
- 官方数据不可达时自动切换到演示样本，便于界面和规则流程验证。

影响区域与风速筛查区间属于辅助研判，不替代当地气象部门发布的正式预警。

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
CRON_SECRET=
APP_BASE_URL=https://your-service.onrender.com
```

`RESEND_API_KEY` 与 `ALERT_FROM` 存在时走 Resend；否则如果配置了 `EMAIL_WEBHOOK_URL`，会向该 Webhook 投递邮件负载；都未配置时返回 dry-run 状态。

## Render 每日晨报

晨报接口为 `POST /api/cron/daily`，必须使用 `Authorization: Bearer <CRON_SECRET>` 调用。接口会读取官方台风列表并发送一封状态邮件；官方数据不可用时不会把演示样本当作真实台风报告。

1. 在现有 Render Web Service 的 Environment 中增加 `CRON_SECRET`，填写一段足够长的随机字符串。
2. 在 Render Dashboard 选择 **New > Cron Job**，连接同一个 GitHub 仓库和 `main` 分支。
3. Build Command 填 `npm ci`，Command 填 `npm run alert:daily`。
4. Schedule 填 `0 0 * * *`。Render 使用 UTC，该表达式对应北京时间每天 08:00。
5. 为 Cron Job 配置 `APP_BASE_URL=https://你的服务名.onrender.com`，并设置与 Web Service 完全相同的 `CRON_SECRET`。

创建后可在 Cron Job 页面点击 **Trigger Run** 验证一次。Render Cron Job 按实际运行时间计费，目前每个 Cron Job 每月至少收费 1 美元。
