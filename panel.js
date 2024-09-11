// 定义外部变量
let sitename = "VPS到期监控"; // 变量名SITENAME，自定义站点名称，默认为“域名监控”
let vpsinfo = ""; // 变量名VPSINFO，填入域名信息json文件直链，必须设置的变量
let tgid = ""; // 变量名TGID，填入TG机器人ID，不需要提醒则不填
let tgtoken = ""; // 变量名TGTOKEN，填入TG的TOKEN，不需要提醒则不填
let days = "5"; // 变量名DAYS，提前几天发送TG提醒，默认为5天，必须为大于0的整数

async function sendtgMessage(message, tgid, tgtoken) {
    if (!tgid || !tgtoken) return;    
    const url = `https://api.telegram.org/bot${tgtoken}/sendMessage`;
    const params = {
      chat_id: tgid,
      text: message,
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

// 新增函数，用于处理VPS的增删改操作
async function handleVpsModification(vpsinfo, action, newVpsData = null) {
    if (action === 'add' && newVpsData) {
        vpsinfo.push(newVpsData);
    } else if (action === 'delete' && newVpsData) {
        vpsinfo = vpsinfo.filter(vps => vps.system !== newVpsData.system);
    }
    // 可将新的vpsinfo上传或保存至远程数据库或文件
    return vpsinfo;
}

export default {
    async fetch(request, env) {
        const url = new URL(request.url);
        const pathname = url.pathname;
        sitename = env.SITENAME || sitename;
        vpsinfo = env.VPSINFO || vpsinfo;
        tgid = env.TGID || tgid;
        tgtoken = env.TGTOKEN || tgtoken;
        days = parseInt(env.DAYS || days, 10);

        // 处理不同路径请求
        if (pathname === '/admin') {
            if (request.method === 'POST') {
                // 处理新增或删除请求
                const requestData = await request.json();
                const { action, newVpsData } = requestData;
                vpsinfo = await handleVpsModification(vpsinfo, action, newVpsData);
            }
            // 返回管理面板的 HTML
            const adminHtml = await generateAdminHTML(vpsinfo, sitename);
            return new Response(adminHtml, {
                headers: { 'Content-Type': 'text/html' },
            });
        }

        // 读取变量VPSINFO中的VPS数据，格式为json
        if (!vpsinfo) {
            return new Response("VPSINFO 环境变量未设置", { status: 500 });
        }

        try {
            const response = await fetch(vpsinfo);
            if (!response.ok) {
                throw new Error('Network response was not ok');
            }
            const data = await response.json();
            if (!Array.isArray(data)) {
                throw new Error('JSON 数据格式不正确');
            }
            vpsinfo = data;

            // 检查即将到期的VPS并发送 Telegram 消息
            for (const info of vpsinfo) {
                const expirationDate = new Date(info.expirationDate);
                const today = new Date();
                const daysRemaining = Math.ceil((expirationDate - today) / (1000 * 60 * 60 * 24));

                if (daysRemaining > 0 && daysRemaining <= days) {
                    const message = `[VPS] ${info.country} ${info.system} ${info.type} 将在 ${daysRemaining} 天后到期。到期日期：${info.expirationDate}`;
                    await sendtgMessage(message, tgid, tgtoken);
                }
            }

            // 处理 generateHTML 的返回值
            const htmlContent = await generateHTML(vpsinfo, sitename);
            return new Response(htmlContent, {
                headers: { 'Content-Type': 'text/html' },
            });
        } catch (error) {
            console.error("Fetch error:", error);
            return new Response("无法获取或解析VPS的 json 文件", { status: 500 });
        }
    }
};

// 后台管理页面HTML
async function generateAdminHTML(vpsinfo, SITENAME) {
    const rows = vpsinfo.map(info => `
        <tr>
            <td>${info.country}</td>
            <td>${info.system}</td>
            <td>${info.asn}</td>
            <td>${info.type}</td>
            <td>${info.registrationDate}</td>
            <td>${info.expirationDate}</td>
            <td><button onclick="deleteVps('${info.system}')">删除</button></td>
        </tr>
    `).join('');

    return `
    <!DOCTYPE html>
    <html lang="zh-CN">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>${SITENAME} 后台管理</title>
        <style>
            body {
                font-family: Arial, sans-serif;
                background-color: #f4f4f4;
            }
            .container {
                max-width: 800px;
                margin: 50px auto;
                padding: 20px;
                background-color: white;
                box-shadow: 0px 0px 10px rgba(0, 0, 0, 0.1);
            }
            table {
                width: 100%;
                border-collapse: collapse;
            }
            th, td {
                padding: 10px;
                border: 1px solid #ddd;
            }
            th {
                background-color: #f2f2f2;
            }
        </style>
    </head>
    <body>
        <div class="container">
            <h1>${SITENAME} 后台管理</h1>
            <h2>现有 VPS 信息</h2>
            <table>
                <thead>
                    <tr>
                        <th>国家/地区</th>
                        <th>注册商</th>
                        <th>ASN号</th>
                        <th>类型</th>
                        <th>注册时间</th>
                        <th>到期时间</th>
                        <th>操作</th>
                    </tr>
                </thead>
                <tbody>
                    ${rows}
                </tbody>
            </table>
            <h2>新增 VPS 信息</h2>
            <form id="addVpsForm">
                <label>国家/地区: <input type="text" id="country" required></label><br>
                <label>注册商: <input type="text" id="system" required></label><br>
                <label>ASN号: <input type="text" id="asn" required></label><br>
                <label>类型: <input type="text" id="type" required></label><br>
                <label>注册时间: <input type="date" id="registrationDate" required></label><br>
                <label>到期时间: <input type="date" id="expirationDate" required></label><br>
                <button type="submit">新增 VPS</button>
            </form>
        </div>
        <script>
            async function deleteVps(system) {
                const response = await fetch('/admin', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ action: 'delete', newVpsData: { system } })
                });
                location.reload();
            }

            document.getElementById('addVpsForm').addEventListener('submit', async (event) => {
                event.preventDefault();
                const newVpsData = {
                    country: document.getElementById('country').value,
                    system: document.getElementById('system').value,
                    asn: document.getElementById('asn').value,
                    type: document.getElementById('type').value,
                    registrationDate: document.getElementById('registrationDate').value,
                    expirationDate: document.getElementById('expirationDate').value,
                };
                const response = await fetch('/admin', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ action: 'add', newVpsData })
                });
                location.reload();
            });
        </script>
    </body>
    </html>
    `;
}

// 普通页面HTML
async function generateHTML(vpsinfo, SITENAME) {
    const rows = await Promise.all(vpsinfo.map(async info => {
        const expirationDate = new Date(info.expirationDate);
        const today = new Date();
        const daysRemaining = Math.ceil((expirationDate - today) / (1000 * 60 * 60 * 24));
        const daysColor = daysRemaining <= 5 ? 'red' : 'black';
        const favURL = "https://yuzong.nyc.mn/?url=" + info.system.replace(/^https?:\/\//, '');
        const flag = await getFlag(info.country);

        return `
        <tr>
            <td>${flag} ${info.country}</td>
            <td><img src="${favURL}" alt="favicon" width="16" height="16"> ${info.system}</td>
            <td>${info.asn}</td>
            <td>${info.type}</td>
            <td>${info.registrationDate}</td>
            <td style="color:${daysColor};">${info.expirationDate}</td>
        </tr>
        `;
    }));

    return `
    <!DOCTYPE html>
    <html lang="zh-CN">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>${SITENAME}</title>
        <style>
            body {
                font-family: Arial, sans-serif;
                background-color: #f4f4f4;
            }
            .container {
                max-width: 800px;
                margin: 50px auto;
                padding: 20px;
                background-color: white;
                box-shadow: 0px 0px 10px rgba(0, 0, 0, 0.1);
            }
            table {
                width: 100%;
                border-collapse: collapse;
            }
            th, td {
                padding: 10px;
                border: 1px solid #ddd;
            }
            th {
                background-color: #f2f2f2;
            }
        </style>
    </head>
    <body>
        <div class="container">
            <h1>${SITENAME}</h1>
            <table>
                <thead>
                    <tr>
                        <th>国家/地区</th>
                        <th>注册商</th>
                        <th>ASN号</th>
                        <th>类型</th>
                        <th>注册时间</th>
                        <th>到期时间</th>
                    </tr>
                </thead>
                <tbody>
                    ${rows.join('')}
                </tbody>
            </table>
        </div>
    </body>
    </html>
    `;
}

// 根据国家信息获取国旗
//async function getFlag(country) {
//    const flags = {
//        "中国": "🇨🇳",
//        "美国": "🇺🇸",
//        "日本": "🇯🇵",
//        "德国": "🇩🇪",
//    };

//    if (country in flags) {
//        return flags[country];
//    }

//    // 翻译并查找国旗
//    const cn = await translateCountryToChinese(country);
//    return flags[cn] || '🏳';
//}

// 翻译国家名为中文
//async function translateCountryToChinese(country) {
//    const translations = {
//        "China": "中国",
//        "United States": "美国",
//        "Japan": "日本",
//        "Germany": "德国",
//    };
//    return translations[country] || country;
//}
