// 定义外部变量
let sitename = "VPS到期监控"; // 变量名SITENAME，自定义站点名称，默认为“域名监控”
let vpsurl = ""; // 变量名VPSINFO，填入域名信息json文件直链，必须设置的变量
let tgid = ""; // 变量名TGID，填入TG机器人ID，不需要提醒则不填
let tgtoken = ""; // 变量名TGTOKEN，填入TG的TOKEN，不需要提醒则不填
let days = "5"; // 变量名DAYS，提前几天发送TG提醒，默认为5天，必须为大于0的整数

// tg消息发送函数
async function sendtgMessage(message, tgid, tgtoken) {
    if (!tgid || !tgtoken) {
        console.log('缺少变量 TGID 或 TGTOKEN，跳过消息发送');
        return;
    }
    const url = `https://api.telegram.org/bot${tgtoken}/sendMessage`;
    const params = {
        chat_id: tgid,
        text: message,
        parse_mode: 'Markdown',
    };
    try {
        await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(params),
        });
    } catch (error) {
        console.error('Telegram 消息推送失败:', error);
    }
}

// 获取IP的国家、城市、ASN信息
async function ipinfo_query(vpsjson) {
    const results = await Promise.all(vpsjson.map(async ({ ip }) => {
        const apiUrl = `https://ip.eooce.com/${ip}`;
        try {
            const ipResponse = await fetch(apiUrl);
            if (ipResponse.ok) {
                const { country_code, city, asn } = await ipResponse.json();
                return { ip, country_code, city, asn };
            } else {
                console.error(`IP查询失败: ${ip}`);
                return null;
            }
        } catch (error) {
            console.error(`请求IP信息失败: ${ip}`, error);
            return null;
        }
    }));
    return results.filter(info => info !== null);  // 过滤掉请求失败的IP信息
}

export default {
    async fetch(request, env) {
        sitename = env.SITENAME || sitename;
        vpsurl = env.VPSINFO || vpsurl;
        tgid = env.TGID || tgid;
        tgtoken = env.TGTOKEN || tgtoken;
        days = Number(env.DAYS) || days;

        if (!vpsurl) {
            return new Response("VPSINFO 环境变量未设置", { status: 500 });
        }

        try {
            const response = await fetch(vpsurl);
            if (!response.ok) {
                throw new Error('网络响应失败');
            }
            const vpsjson = await response.json();
            if (!Array.isArray(vpsjson)) {
                throw new Error('JSON 数据格式不正确');
            }
            // 合并 vpsjson 和 ipdata
            const ipjson = await ipinfo_query(vpsjson);
            const vpsdata = vpsjson.map(vps => {
                const ipdata = ipjson.find(ip => ip.ip === vps.ip);  // 查找匹配的 IP 信息
                if (ipdata) {
                    return { ...vps, ...ipdata };
                }
                return vps;  // 如果没有找到 IP 信息，返回原始数据
            });

            // 检查即将到期的VPS并发送 Telegram 消息
            for (const info of vpsdata) {
                const endday = new Date(info.endday);
                const today = new Date();
                const daysRemaining = Math.ceil((endday - today) / (1000 * 60 * 60 * 24));

                if (daysRemaining > 0 && daysRemaining <= days) {
                    const message = `[VPS] ${info.country_code} | ${info.city} 将在 ${daysRemaining} 天后到期。IP：${info.ip}，到期日期：${endday}`;

                    // 在发送通知之前检查是否已经发送过通知
                    const lastSent = await env.VPS_TG_KV.get(info.ip);  // 检查是否已发送过通知

                    if (!lastSent || (new Date(lastSent).toISOString().split('T')[0] !== today.toISOString().split('T')[0])) {
                        await sendtgMessage(message, tgid, tgtoken);
                        await env.VPS_TG_KV.put(info.ip, new Date().toISOString());  // 更新 KV 存储的发送时间
                    }
                }
            }

            // 处理 generateHTML 的返回值
            const htmlContent = await generateHTML(vpsdata, sitename);
            return new Response(htmlContent, {
                headers: { 'Content-Type': 'text/html' },
            });

        } catch (error) {
            console.error("Fetch error:", error);
            return new Response("无法获取或解析VPS的json文件", { status: 500 });
        }
    }
};

// 生成HTML表格的函数
async function generateHTML(vpsdata, sitename) {
    const rows = await Promise.all(vpsdata.map(async info => {
        const startday = new Date(info.startday);
        const endday = new Date(info.endday);
        const today = new Date();
        const totalDays = (endday - startday) / (1000 * 60 * 60 * 24);
        const daysElapsed = (today - startday) / (1000 * 60 * 60 * 24);
        const progressPercentage = Math.min(100, Math.max(0, (daysElapsed / totalDays) * 100));
        const daysRemaining = Math.ceil((endday - today) / (1000 * 60 * 60 * 24));
        const isExpired = today > endday;
        const statusColor = isExpired ? '#e74c3c' : '#2ecc71';
        const statusText = isExpired ? '已过期' : '正常';

        return `
            <tr>
                <td><span class="status-dot" style="background-color: ${statusColor};" title="${statusText}"></span></td>
                <td>${info.ip}</td>
                <td>${info.asn}</td>
                <td>${info.country_code}</td>
                <td>${info.city}</td>
                <td><a href="${info.storeURL}" target="_blank">${info.store}</a></td>
                <td>${info.startday}</td>
                <td>${info.endday}</td>
                <td>${isExpired ? '已过期' : daysRemaining + ' 天'}</td>
                <td>
                    <div class="progress-bar">
                        <div class="progress" style="width: ${progressPercentage}%;"></div>
                    </div>
                </td>
            </tr>
        `;
    }));

    return `
        <!DOCTYPE html>
        <html lang="zh-CN">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>${sitename}</title>
            <link rel="icon" href="https://raw.githubusercontent.com/yutian81/yutian81.github.io/master/assets/images/vpsinfo.png" type="image/png">
            <style>
                body {
                    font-family: Arial, sans-serif;
                    line-height: 1.6;
                    margin: 0;
                    padding: 0;
                    background-color: #f4f4f4;
                    color: #333;
                    display: flex;
                    flex-direction: column;
                    min-height: 100vh;
                }
                .container {
                    flex: 1;
                    width: 95%;
                    max-width: 1200px;
                    margin: 20px auto;
                    background-color: #fff;
                    box-shadow: 0 2px 5px rgba(0, 0, 0, 0.1);
                    border-radius: 5px;
                    overflow: hidden;
                }
                h1 {
                    background-color: #3498db;
                    color: #fff;
                    padding: 20px;
                    margin: 0;
                }
                .table-container {
                    width: 100%;
                    overflow-x: auto;
                }
                table {
                    width: 100%;
                    border-collapse: collapse;
                    white-space: nowrap;
                    table-layout: auto; /* 自动列宽 */
                }
                th, td {
                    padding: 12px;
                    text-align: left;
                    border-bottom: 1px solid #ddd;
                    white-space: nowrap; /* 避免内容自动换行 */
                }
                th {
                    background-color: #f2f2f2;
                    font-weight: bold;
                }
                .status-dot {
                    display: inline-block;
                    width: 10px;
                    height: 10px;
                    border-radius: 50%;
                    background-color: #2ecc71;
                }
                .progress-bar {
                    width: 100%;
                    min-width: 100px;
                    background-color: #e0e0e0;
                    border-radius: 4px;
                    overflow: hidden;
                }
                .progress {
                    height: 20px;
                    background-color: #3498db;
                }
            </style>
        </head>
        <body>
            <div class="container">
                <h1>${sitename}</h1>
                <div class="table-container">
                    <table>
                        <thead>
                            <tr>
                                <th>状态</th>
                                <th>IP</th>
                                <th>ASN</th>
                                <th>国家</th>
                                <th>城市</th>
                                <th>商家</th>
                                <th>注册日</th>
                                <th>到期日</th>
                                <th>剩余天数</th>
                                <th>使用进度</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${rows.join('')}
                        </tbody>
                    </table>
                </div>
            </div>
        </body>
        </html>
    `;
}
