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
```

`RESEND_API_KEY` 与 `ALERT_FROM` 存在时走 Resend；否则如果配置了 `EMAIL_WEBHOOK_URL`，会向该 Webhook 投递邮件负载；都未配置时返回 dry-run 状态。
