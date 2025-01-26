# VPS 到期提醒
基于Cloudflare Workers构建的VPS到期提醒可视化面板，让用户能够一目了然地查看VPS的状态、IP、ASN、国家、城市、注册商、注册日期、过期日期和使用进度，并可在到期前通过TG机器人向用户推送通知。

**DEMO**：<https://vps.yutian81.top>  

## 2024-11-11 更新：每天只进行一次 TG 通知
- 创建一个KV命令空间：名称随意，假设为`VPS_TG_KV`
- 在 workers 或 pages 的设置里，绑定 kv 空间，变量名为`VPS_TG_KV`（不能修改），绑定上一步中新建的 kv 空间
- 最新的代码为仓库中的 `VPS_TG_KV.js` 文件

## 部署方法

**worker部署**

- 在cf中创建一个workers，复制`_worker.js`中的代码到workers中，点击保存并部署
- 绑定一个KV，KV变量名`VPS_TG_KV.js`，KV空间名随意
- 设置以下环境变量：

## 变量设置
| 变量名 | 填写示例 | 说明 | 是否必填 | 
| ------ | ------- | ------ | ------ |
| SITENAME | VPS到期监控 | 自定义站点名称，默认为`VPS到期监控` | 否 |
| DOMAINS | `https://raw.githubusercontent.com/用户名/仓库名/main/vpsinfo.json` | 替换为你自己的json文件 | 是 |
| TGID | 652***4200 | TG机器人ID，不需要通知可不填 | 否 |
| TGTOKEN | 60947***43:BBCrcWzLb000000vdtt0jy000000-uKM7p8	 | TG机器人TOKEN，不需要通知可不填 | 否 |
| DAYS | 5 | 提前几天发送TG提醒，必须是整数，默认为`5` | 否 |

## 域名信息json文件格式
**示例**，请修改其中信息为你自己的vps
```
[
  { "ip": "209.138.178.63", "startday": "2025-01-11", "endday": "2026-01-10", "store": "DartNode", "storeURL": "https://app.dartnode.com/" },
  { "ip": "141.150.63.49", "startday": "2024-12-31", "endday": "2026-02-14", "store": "ChunkServe", "storeURL": "https://billing.chunkserve.com/" },
  { "ip": "31.88.142.101", "startday": "2025-01-19", "endday": "2027-01-19", "store": "Dasabo", "storeURL": "https://my.dasabo.com/" }
]
```

## TG 通知的文字样式
```
🚨 [VPS到期提醒] 🚨
====================
🌍 国家: US | 城市: Chicago
💻 IP 地址: 8.8.8.8
⏳ 剩余时间: 3 天
📅 到期日期: 2025-01-28
⚠️ 点击续期：Dasabo
```
续期那里可直接点击商家名称跳转到商家主页

## 更高级的玩法：worker-plus.js
- 只需要设置一个变量：`PASS`，其值为访问前端网页的密码
- 密码会缓存到 cookie 里，下次登录时不用再输入密码
- 再绑定一个KV，KV变量名`VPS_TG_KV.js`，KV空间名随意
- 其他参数在登录前端页面后的设置页面中填入，会自动保存到KV中

![image](https://github.com/user-attachments/assets/d7489572-1cf7-42ba-aa56-e44123cf15a9)

![image](https://github.com/user-attachments/assets/151bf1d7-e822-40c7-b7ce-f34877577a12)

![image](https://github.com/user-attachments/assets/985d940d-b0fe-49ec-9b38-8244240e3c22)

