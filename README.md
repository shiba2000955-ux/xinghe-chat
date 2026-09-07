# 星河通讯

星河通讯是一个可注册登录的即时通讯 Web APP，支持联系人、好友申请、新会话、建群、资料编辑、头像上传、设置、数据备份和 WebSocket 实时消息。

## 运行

在当前目录执行：

```powershell
py -m pip install -r requirements.txt
py server.py
```

然后打开 http://localhost:5173/ 。

打开 http://localhost:5173/，注册两个账号即可在不同浏览器页面联调实时聊天。

## 当前网络能力

当前项目已经包含公网所需的服务端：账号注册/登录、SQLite 用户库、消息库和 WebSocket 实时广播。Render 部署使用 `render.yaml`，启动命令是 `python server.py`。

Render 免费实例的本地 SQLite 文件会在实例重启或重新部署时丢失。要长期保存账号和聊天记录，应将 `server.py` 的数据库迁移到 Render Postgres，并把 `NOVA_DB_PATH` 改为数据库连接配置。免费实例也可能休眠，首次访问会有冷启动延迟。

## Render 部署

1. 将 `星河通讯` 文件夹推送到自己的 GitHub 仓库。
2. 在 Render 选择 **New > Blueprint**，连接该仓库并选择 `render.yaml`。
3. 点击部署，等待构建完成后使用 Render 分配的 `https://...onrender.com` 地址。
4. 生产环境建议绑定 HTTPS 域名并接入 Postgres。

## 管理后台

设置 Render 环境变量 `NOVA_ADMIN_KEY` 后，访问 `/admin`，输入该密钥即可查看会员用户名、昵称、注册时间、最近登录 IP 和最近登录时间。后台不会返回密码或密码哈希；不要把管理员密钥写入代码或发到聊天中。