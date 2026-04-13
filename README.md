# waimaianalyze

外卖门店经营数据可视化单页工具。

当前版本是一个纯静态站点，核心页面为 `index.html`。页面使用 ECharts 展示 15 分钟粒度的订单量和平均客单价，并支持导入美团标准报表 CSV 进行本地解析和可视化。

## 当前能力

- 模拟近 15 天订单数据，便于直接演示
- 按天切换查看经营曲线
- 双轴图展示订单量和平均客单价
- 汇总展示总订单、峰值时段、峰值订单量、订单总实付
- 上传 CSV 后在浏览器本地完成解析和聚合
- 导出当前图表为 PNG 图片
- 适配微信分享的 OG 标签和 JS-SDK 初始化

## 项目结构

- `index.html`: 单文件前端页面和全部业务逻辑
- `share-cover.png`: 分享封面图
- `.github/workflows/deploy.yml`: GitHub Actions 部署到华为云 ECS

## CSV 约定

页面当前支持下列字段名或同义字段：

- 日期
- 下单时间
- 订单状态
- 订单实付
- 订单编号

处理规则：

- 只统计 `已完成` 订单
- 按下单时间向下归档到 15 分钟桶
- 无订单时间桶自动补齐
- 数据解析和计算全部在浏览器本地完成，不依赖后端

## 本地使用

这是纯静态页面，直接用浏览器打开 `index.html` 即可。

如果要验证微信分享相关逻辑，建议通过实际站点地址访问，因为该能力依赖线上 `wx-config` 接口返回签名配置。

## 部署

当前主线部署方式不是 OBS，而是 GitHub Actions 通过 `scp` 上传静态文件到华为云 ECS 上的 Apache 目录：

- workflow 文件：`.github/workflows/deploy.yml`
- 目标目录：`/var/www/html/waimaianalyze/`
- 当前公开访问地址：`http://waimaiketang.com/waimaianalyze/`

### 需要的 GitHub Secrets

- `ECS_SSH_KEY`: 用于部署的私钥
- `ECS_USERNAME`: ECS 登录用户名
- `ECS_HOST`: ECS 主机地址

### 触发方式

- push 到 `main`
- 在 GitHub Actions 页面手动运行 `Deploy to Huawei ECS`

## 分享预览

当前页面不再依赖微信 JS-SDK。分享预览完全依赖 `index.html` 头部的静态 meta 标签：

- `description`
- `og:*`
- `twitter:*`
- `canonical`

如果后续迁移域名、站点路径或部署环境，需要同步调整 `index.html` 里的公开地址和分享图片地址。

当前公开访问地址：

- `https://waimaiketang.com/waimaianalyze/`

## 维护注意事项

- 当前仓库没有构建步骤、包管理器或自动化测试
- `index.html` 是单文件实现，改动前建议先确认工作树是否干净
- 如果修改部署方式，必须同步更新 `README.md`，避免再次出现文档与 workflow 不一致
