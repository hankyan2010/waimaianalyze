# 华为云 ECS 部署说明（Apache + Node + SQLite）

部署形态：

```
[ 访客浏览器 ]
      │  http://waimaiketang.com/waimaianalyze/...
      ▼
[ Apache httpd :80 ]
      ├── /waimaianalyze/*.html|.svg   ← /var/www/html/waimaianalyze/ (静态)
      └── /waimaianalyze/api/*         ← mod_proxy → 127.0.0.1:3000
                                            │
                                            ▼
                              [ Node + SQLite :3000 ]
                              /opt/waimaianalyze/
                              ├── server.js
                              ├── node_modules/
                              └── waimai.db   (sqlite 文件，由 systemd 单元跑的 waimai 用户持有)
```

CI 是 `.github/workflows/deploy.yml`。它会：

1. 在 Actions runner 上 `npm ci --omit=dev` 装好后端依赖，打成 `backend-bundle.tar.gz`
2. scp 前端静态文件 + 后端 tar + systemd unit + Apache conf 到 ECS
3. ssh 到 ECS 上幂等地：建 `waimai` 用户 / 解包后端 / 安装 systemd unit / 安装 Apache 反代 / reload httpd + restart node
4. 健康检查 `/api/health`（直连 node + 经 Apache）

## 1) 一次性：在 ECS 上配置部署账号的 sudoers

workflow 里的 ssh 会执行一堆 `sudo ...`。为了不卡在密码交互，给**部署用户**（`${{ secrets.ECS_USERNAME }}`）开 NOPASSWD：

```bash
sudo visudo -f /etc/sudoers.d/waimaianalyze-deploy
```

粘贴（把 `DEPLOY_USER` 换成你在 GitHub Secret `ECS_USERNAME` 里写的那个用户名）：

```
DEPLOY_USER ALL=(root) NOPASSWD: \
  /usr/bin/mkdir, \
  /usr/bin/mv, \
  /usr/bin/chown, \
  /usr/bin/tar, \
  /usr/sbin/useradd, \
  /usr/bin/systemctl, \
  /bin/systemctl, \
  /bin/diff
```

> 如果你的部署用户就是 `root`，跳过这一节。但强烈建议新建一个普通用户专门部署，root 别暴露给 CI。

## 2) 一次性：GitHub Secrets

`Settings → Secrets and variables → Actions` 添加：

| Secret | 说明 |
|---|---|
| `ECS_HOST` | ECS 公网 IP，例如 `121.36.105.43` |
| `ECS_USERNAME` | 部署用户名（配了 NOPASSWD 的那个） |
| `ECS_SSH_KEY` | SSH 私钥全文（部署用户对应的 ed25519 私钥） |

ECS 上对应的 `~/.ssh/authorized_keys` 要有配对的公钥。

## 3) 一次性：确认 ECS 上装了 httpd + mod_proxy + Node 18+

```bash
# CentOS / Alma / Rocky
sudo dnf install -y httpd nodejs
sudo systemctl enable --now httpd
# mod_proxy 默认已装在 httpd 包里，但要确认模块加载了
httpd -M 2>&1 | grep proxy
# 如果没看到 proxy_module，检查 /etc/httpd/conf.modules.d/00-proxy.conf
```

Node 版本：`node --version` 应当 ≥ v18。workflow 会推 CI 装好的 linux-x64 `better-sqlite3` prebuild，兼容 glibc 2.17+。

## 4) 触发部署

- **自动**：推送到 `main`、`claude/deploy-huawei-cloud-7sNvM` 或 `claude/review-previous-progress-Gvo7a` 任一分支
- **手动**：`Actions → Deploy to Huawei ECS → Run workflow`

## 5) 访问 & 自检

部署成功后：

```
前端：  http://waimaiketang.com/waimaianalyze/
API：   http://waimaiketang.com/waimaianalyze/api/health
         → {"ok":true,"t":<时间戳>}
```

在 ECS 上手动自检：

```bash
# 1) Node 直连
curl -s http://127.0.0.1:3000/api/health

# 2) Apache 反代
curl -s http://127.0.0.1/waimaianalyze/api/health

# 3) systemd 状态 & 日志
sudo systemctl status waimaianalyze
sudo journalctl -u waimaianalyze -n 100 --no-pager
```

## 6) 数据库

- SQLite 文件：`/opt/waimaianalyze/waimai.db`（含 `-wal` / `-shm`）
- 持有人：`waimai:waimai`
- 部署不会覆盖数据库。workflow 的 tar 解包只动 `server.js` / `package.json` / `package-lock.json` / `node_modules`
- 备份：`sudo -u waimai sqlite3 /opt/waimaianalyze/waimai.db ".backup '/tmp/waimai-$(date +%F).db'"`

## 7) API 接口（后端托管 credits）

基址：`http://waimaiketang.com/waimaianalyze/api`

| 方法 | 路径 | body | 说明 |
|---|---|---|---|
| `GET` | `/health` | — | 心跳 |
| `GET` | `/credits?browser_id=b_xxx` | — | 查额度，找不到则初始化为 1 |
| `POST` | `/credits/consume` | `{browser_id}` | 扣 1；余额不足返回 402 |
| `POST` | `/credits/claim-share` | `{browser_id}` | 分享奖励 +2；每 10 分钟最多 1 次、每天最多 5 次（429） |
| `POST` | `/credits/grant-on-scan` | `{scanner_id, referrer_id}` | 新访客带 `?ref=` 落地时给邀请人 +2，同一 scanner 只触发一次 |

所有写入都会写 `events` 表做审计。

## 8) 已知限制 / TODO

- `claim-share` 本质是信任前端，后端只加了限流。真正防刷要接微信 JS-SDK 的 `onMenuShareTimeline.success` 回调并在服务端校签 —— 等后端基建好了再做
- 没有迁移工具；`CREATE TABLE IF NOT EXISTS` 足够当前 schema 演进
- 没配 HTTPS。要搞 SSL 就再装 certbot + mod_ssl，反代规则不变
