# VPS 到期提醒
基于Cloudflare Workers构建的VPS到期提醒可视化面板，让用户能够一目了然地查看VPS的状态、IP、ASN、国家、城市、注册商、注册日期、过期日期、`年费价格`、`剩余价值`，并可在到期前通过TG机器人向用户推送通知。

**DEMO**：<https://vps.yutian81.top>

- **_worker.js**：不显示年费和剩余价值的版本  
- **vps_plus**：显示年费和剩余价值的版本

## 部署方法

**worker部署**

- 在cf中创建一个workers，复制`_worker.js`中的代码到workers中，点击保存并部署
- 绑定一个KV，KV变量名`VPS_TG_KV`，KV空间名随意
- 设置以下环境变量：

## 变量设置
| 变量名 | 填写示例 | 说明 | 是否必填 | 
| ------ | ------- | ------ | ------ |
| PASS  | 123456 | 前端访问密码，默认为`123456` | 是 |
| RATE_API  | f5bc********7d1e66**** | 获取实时汇率的免费API KEY | 是 |
| TGID | 652***4200 | TG机器人ID，不需要通知可不填 | 否 |
| TGTOKEN | 60947***43:BBCrcWzLb000000vdtt0jy000000-uKM7p8	 | TG机器人TOKEN，不需要通知可不填 | 否 |

## 域名信息json文件格式
**示例**，其中的`price`需要保留2位小数，支持美元（USD）和人民币（CNY）；`store`指商家名称，`storeURL`指商家链接
```
[
  {
    "ip": "209.138.178.63",
    "startday": "2025-01-11",
    "endday": "2026-01-10",
    "price": "11.99USD",
    "store": "DartNode",
    "storeURL": "https://app.dartnode.com/"
  },
  {
    "ip": "141.150.63.49",
    "startday": "2024-12-31",
    "endday": "2026-02-14",
    "price": "11.99USD",
    "store": "ChunkServe",
    "storeURL": "https://billing.chunkserve.com/"
  },
  {
    "ip": "31.88.142.101",
    "startday": "2025-01-19",
    "endday": "2027-01-19",
    "price": "11.99USD",
    "store": "Dasabo",
    "storeURL": "https://my.dasabo.com/" }
]
```
请修改其中信息为你自己的vps，并将这个内容存为json文件，放到公开仓库或私有gist生成一个直链  
**直链格式类似以下**
```
https://gist.githubusercontent.com/用户名/591b80ed80baabcdef369a330bb8e88e/raw/vpsinfo.json
```

## TG 通知的文字样式
```
🚨 [VPS到期提醒] 🚨
====================
🌍 国家: US | 城市: Chicago
💻 IP 地址: 8.8.8.8
⏳ 剩余时间: 3 天
📅 到期日期: 2025-01-28
⚠️ 点击续期：[Dasabo](https://my.dasabo.com)
```
续期那里可直接点击商家名称跳转到商家主页

## 使用方法
- 访问你的worker项目域名，会提示输入密码，输入你在环境变量中设置的密码
- 首次登录会直接跳转到设置页，在设置页中填入`存储VPS信息的URL直链`
- 点击保存即跳转到vps到期监控信息页面

![image](https://github.com/user-attachments/assets/d7489572-1cf7-42ba-aa56-e44123cf15a9)

![image](https://github.com/user-attachments/assets/6fbef2e9-6071-4605-b961-ca785f18d0f9)

![image](https://github.com/user-attachments/assets/38041a99-6f0f-4ee6-9a59-f663389c5b59)


