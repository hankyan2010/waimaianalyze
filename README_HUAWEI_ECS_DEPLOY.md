# 华为云 ECS 部署说明（SSH + Nginx）

这个仓库添加了 GitHub Actions 工作流：

- `.github/workflows/deploy-huawei-ecs.yml`

它会通过 SSH 把 `index.html` 复制到你的华为云 ECS 服务器，并自动安装/重载 Nginx 发布站点。

## 1) 在华为云 ECS 上准备

1. 确认 ECS 实例运行中，记下公网 IP（例如 `121.36.105.43`）。
2. 在 **华为云控制台 → ECS → 安全组** 入方向放行 TCP **80**（HTTP）端口；如需 HTTPS 再放行 443。
3. 确认服务器能从 GitHub Actions 出口 IP 范围被访问到 22 端口。
4. **强烈建议**：在服务器上生成 SSH 密钥对，使用密钥认证而不是密码：
   ```bash
   ssh-keygen -t ed25519 -f deploy_key -N ""
   cat deploy_key.pub >> ~/.ssh/authorized_keys
   chmod 600 ~/.ssh/authorized_keys
   # 然后把 deploy_key 私钥内容复制到 GitHub Secret ECS_SSH_KEY
   ```

## 2) 配置 GitHub Secrets

在仓库 `Settings → Secrets and variables → Actions → New repository secret` 添加：

| Secret 名 | 必填 | 说明 |
|---|---|---|
| `ECS_HOST` | 是 | ECS 公网 IP，例如 `121.36.105.43` |
| `ECS_USERNAME` | 是 | 登录用户名，例如 `root` |
| `ECS_SSH_KEY` | 二选一 | SSH 私钥全文（推荐） |
| `ECS_PASSWORD` | 二选一 | SSH 登录密码（不推荐） |
| `ECS_PORT` | 否 | SSH 端口，默认 22 |

> ⚠️ **安全提醒**：你之前在对话中明文发送过 root 密码，请立即在服务器上修改密码，并改用密钥认证。

## 3) 触发部署

两种方式：

- **自动**：推送到 `claude/deploy-huawei-cloud-7sNvM` 或 `main` 分支自动触发。
- **手动**：在 `Actions` 标签页选择 `Deploy to Huawei ECS (SSH)` → `Run workflow`。

## 4) 访问

部署成功后访问：

```
http://<ECS_HOST>/
```

例如：`http://121.36.105.43/`

## 5) 排错

- **SSH 连接失败**：检查安全组 22 端口是否对 GitHub Actions 出口开放（GitHub Actions 出口 IP 不固定，建议临时放行 0.0.0.0/0:22 或使用自托管 runner）。
- **Nginx 安装失败**：检查 ECS 是否能访问 yum/apt 源。华为云内网默认可用。
- **80 端口访问不通**：检查 ECS 安全组、操作系统防火墙（`firewalld` / `ufw`）是否放行 80。
- **权限不足**：脚本默认假设 root；非 root 用户需要 `sudo`，可改 workflow 的 `script` 部分。
