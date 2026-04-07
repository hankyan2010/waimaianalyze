# 华为云部署说明（OBS 静态网站）

这个仓库已添加 GitHub Actions 工作流：

- `.github/workflows/deploy-huawei-obs.yml`

它会把仓库静态文件同步到华为云 OBS 桶（通过 OBS 的 S3 兼容接口）。

## 1) 准备华为云

1. 在 OBS 创建桶（建议同区域部署）。
2. 在 OBS 控制台开启静态网站托管，首页设置 `index.html`。
3. 给桶配置访问策略（按你公司安全规范）。
4. 准备 AK/SK（用于 CI 上传），建议最小权限。

## 2) 配置 GitHub Secrets

在仓库 `Settings -> Secrets and variables -> Actions` 添加：

- `HWC_AK`: 华为云 Access Key
- `HWC_SK`: 华为云 Secret Key
- `HWC_REGION`: 区域，例如 `cn-east-3`
- `HWC_OBS_BUCKET`: OBS 桶名

## 3) 触发部署

两种方式：

1. 直接 push 到 `work` 或 `main` 分支。
2. 在 GitHub Actions 页面手动运行 `Deploy to Huawei OBS`（workflow_dispatch）。

## 4) 本地手动部署（可选）

如果你想在本机手动传：

```bash
pip install awscli
export AWS_ACCESS_KEY_ID="<你的AK>"
export AWS_SECRET_ACCESS_KEY="<你的SK>"
export AWS_DEFAULT_REGION="cn-east-3"
ENDPOINT="https://obs.${AWS_DEFAULT_REGION}.myhuaweicloud.com"
aws s3 sync ./ "s3://<你的桶名>" --endpoint-url "$ENDPOINT" --delete
```

## 5) 常见问题

- 访问 403：检查桶策略/静态托管设置。
- 访问 404：确认 `index.html` 已上传到桶根目录。
- Action 报认证失败：检查 AK/SK 是否正确、是否过期、是否有 OBS 权限。

