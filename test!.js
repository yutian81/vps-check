// 验证密码
function verifyPassword(password, env) {
    const validPassword = env.PASS || "123456";
    return password === validPassword;
}

// 从KV获取配置
async function getConfig(kv) {
    const config = {
        sitename: await kv.get('sitename') || "VPS到期监控",
        vpsurl: await kv.get('vpsurl') || "",
        days: await kv.get('days') || "5"
    };
    return config;
}

// 保存配置到KV
async function saveConfig(kv, config) { 
    await Promise.all([ 
        kv.put('sitename', config.sitename),
        kv.put('vpsurl', config.vpsurl),
        kv.put('days', config.days)
    ]);
}

function escapeMD2(text) {
    return text.replace(/([_*[\]()~`>#+\-=|{}.!])/g, '\\$1');
}

// tg消息发送函数
async function sendtgMessage(message, env) {
    const tgid = env.TGID;
    const tgtoken = env.TGTOKEN;
    if (!tgid || !tgtoken) {
        console.log('缺少变量 TGID 或 TGTOKEN，跳过消息发送');
        return;
    }

    const safemessage = escapeMD2(message);
    const url = `https://api.telegram.org/bot${tgtoken}/sendMessage`; 
    const params = {
        chat_id: tgid,
        text: safemessage,
        parse_mode: 'MarkdownV2', 
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
    const ipjson = await Promise.all(vpsjson.map(async ({ ip }) => {
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
    return ipjson.filter(info => info !== null);
}

export default {
    async fetch(request, env) {
        const url = new URL(request.url); 
        const path = url.pathname; 
        const cookies = request.headers.get('Cookie') || '';
        const isAuthenticated = cookies.includes(`password=${env.PASS || "123456"}`);

        // 登录路由
        if (path === '/login') {
            if (request.method === 'POST') {
                const formData = await request.formData();
                const password = formData.get('password'); 
                
                if (verifyPassword(password, env)) { 
                    return new Response(null, { 
                        status: 302,
                        headers: { 
                            'Location': '/',
                            'Set-Cookie': `password=${password}; path=/; HttpOnly`
                        } 
                    });
                } else {
                    return new Response(generateLoginHTML(true), { 
                        headers: { 'Content-Type': 'text/html' }
                    });
                }
            }
            return new Response(generateLoginHTML(), {
                headers: { 'Content-Type': 'text/html' }
            });
        }

        // 验证是否已登录
        if (!isAuthenticated) {
            return Response.redirect(`${url.origin}/login`, 302);
        }

        // 设置路由
        if (path === '/settings') { 
            const config = await getConfig(env.VPS_TG_KV); 
            
            if (request.method === 'POST') {
                const formData = await request.formData(); 
                const newConfig = {
                    sitename: formData.get('sitename'),
                    vpsurl: formData.get('vpsurl'),
                    days: formData.get('days')
                };

                if (!newConfig.vpsurl) {  
                    return new Response(generateSettingsHTML(newConfig, true), {
                        headers: { 'Content-Type': 'text/html' }
                    });
                }

                await saveConfig(env.VPS_TG_KV, newConfig);
                return Response.redirect(url.origin, 302); 
            }

            return new Response(generateSettingsHTML(config), {
                headers: { 'Content-Type': 'text/html' }
            });
        }

        // 主页路由
        const config = await getConfig(env.VPS_TG_KV);
        if (!config.vpsurl) {
            return Response.redirect(`${url.origin}/settings`, 302);
        }

        try {
            const response = await fetch(config.vpsurl);
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

                if (daysRemaining > 0 && daysRemaining <= Number(config.days)) {
                    const message = `🚨 [VPS到期提醒] 🚨
                    ====================
                    🌍 国家: ${info.country_code} | 城市: ${info.city}
                    💻 IP 地址: ${info.ip}
                    ⏳ 剩余时间: ${daysRemaining} 天
                    📅 到期日期: ${info.endday}
                    ⚠️ 点击续期：[${info.store}](${info.storeURL})`;
                                   
                    const lastSent = await env.VPS_TG_KV.get(info.ip);  // 检查是否已发送过通知
                    if (!lastSent || (new Date(lastSent).toISOString().split('T')[0] !== today.toISOString().split('T')[0])) {
                    await sendtgMessage(message, env);
                        await env.VPS_TG_KV.put(info.ip, new Date().toISOString());  // 更新 KV 存储的发送时间  
                    }
                }
            }

            // 处理 generateHTML 的返回值
            const htmlContent = await generateHTML(vpsdata, config.sitename); 
            return new Response(htmlContent, {
                headers: { 'Content-Type': 'text/html' },
            });

        } catch (error) {
            console.error("Fetch error:", error); 
            return new Response("无法获取或解析VPS的json文件", { status: 500 });
        }
    }
};

// 生成登录页面HTML
function generateLoginHTML(isError = false) { 
    return `
    <!DOCTYPE html>
    <html lang="zh-CN">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0"> 
        <title>登录 - VPS到期监控</title>
        <link rel="icon" href="https://raw.githubusercontent.com/yutian81/yutian81.github.io/master/assets/images/vpsinfo.png" type="image/png">
        <style>
            body {
                font-family: Arial, sans-serif;
                background-color: #f4f4f4;
                display: flex;
                justify-content: center;
                align-items: center;
                height: 100vh;
                margin: 0;
            }
            .login-container {
                background-color: white;
                padding: 2rem; 
                border-radius: 8px;
                box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
                width: 100%;
                max-width: 400px;
            }
            h1 {
                text-align: center;
                color: #2573b3;
                margin-bottom: 2rem;
            }
            .form-group {
                margin-bottom: 1rem;
            }
            label {
                display: block;
                margin-bottom: 0.5rem;
                color: #666;
            }
            input[type="password"] {
                width: 100%;
                padding: 0.8rem;
                border: 1px solid #ddd;
                border-radius: 4px;
                box-sizing: border-box;
                transition: border-color 0.3s ease;
            }
            input[type="password"]:focus {
                border-color: #2573b3;
                outline: none;
            }
            button {
                width: 100%;
                padding: 0.8rem;
                background-color: #2573b3;
                color: white;
                border: none;
                border-radius: 4px;
                cursor: pointer;
                font-size: 1rem;
                transition: background-color 0.3s ease;
            }
            button:hover {
                background-color: #1e5c8f;
            }
            .error-message {
                color: #e74c3c;
                text-align: center;
                margin-bottom: 1rem;
                display: ${isError ? 'block' : 'none'};
            }
        </style>
    </head>
    <body>
        <div class="login-container">
            <h1>VPS到期监控</h1>
            <div class="error-message">密码错误，请重试</div>
            <form method="POST" action="/login">
                <div class="form-group">
                    <label for="password">请输入密码</label>
                    <input type="password" id="password" name="password" required ${isError ? 'autofocus' : ''}>
                </div>
                <button type="submit">登录</button>
            </form>
        </div>
    </body>
    </html>
    `;
}

// 生成设置页面HTML
function generateSettingsHTML(config, showError = false) {
    return `
    <!DOCTYPE html>
    <html lang="zh-CN">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>设置 - VPS到期监控</title>
        <link rel="icon" href="https://raw.githubusercontent.com/yutian81/yutian81.github.io/master/assets/images/vpsinfo.png" type="image/png">
        <style>
            body {
                font-family: Arial, sans-serif;
                background-color: #f4f4f4; 
                margin: 0;
                padding: 20px;
            }
            .settings-container {
                max-width: 800px;  
                margin: 0 auto; 
                background-color: white;
                padding: 2rem;
                border-radius: 8px; 
                box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
            }
            h1 {
                color: #2573b3;
                margin-bottom: 2rem;
                text-align: center;
            }
            .form-group {
                margin-bottom: 1.5rem;
            }
            label {
                display: block;
                margin-bottom: 0.5rem;
                color: #666;
            }
            input[type="text"], input[type="number"] {
                width: 100%;
                padding: 0.8rem;
                border: 1px solid #ddd;
                border-radius: 4px;
                box-sizing: border-box;
                transition: border-color 0.3s ease;
            }
            input[type="text"]:focus, input[type="number"]:focus {
                border-color: #2573b3;
                outline: none;
            }
            .buttons {
                display: flex;
                gap: 1rem;
                justify-content: center;
                margin-top: 2rem;
            }
            button {
                padding: 0.8rem 2rem;
                border: none;
                border-radius: 4px;
                cursor: pointer;
                font-size: 1rem;
                transition: background-color 0.3s ease;
            }
            .save-btn {
                background-color: #2573b3;
                color: white;
                padding: 0.8rem 2rem;
                border: none;
                border-radius: 4px;
                cursor: pointer;
                font-size: 1rem;
                text-decoration: none;
                display: inline-block;
                text-align: center;
            }
            .back-btn {
                background-color: #7f8c8d;
                color: white;
                text-decoration: none;
                padding: 0.8rem 2rem;
                border: none;
                border-radius: 4px;
                cursor: pointer;
                font-size: 1rem;
                transition: background-color 0.3s ease;
            }
            .save-btn:hover {
                background-color: #1e5c8f;
            }
            .back-btn:hover {
                background-color: #666666;
            }
            .error-message {
                color: #e74c3c;
                text-align: center;
                margin-bottom: 1rem;
                display: ${showError ? 'block' : 'none'};
            }
            .required {
                color: #e74c3c;
            }
        </style>
    </head>
    <body>
        <div class="settings-container">
            <h1>系统设置</h1>
            <div class="error-message">存储VPS信息的URL直链为必填项</div>
            <form method="POST" action="/settings">
                <div class="form-group">
                    <label for="sitename">站点名称</label>
                    <input type="text" id="sitename" name="sitename" value="${config.sitename}">
                </div>
                <div class="form-group">
                    <label for="vpsurl">存储VPS信息的URL直链 <span class="required">*</span></label>
                    <input type="text" id="vpsurl" name="vpsurl" value="${config.vpsurl}" required>
                </div>
                <div class="form-group"> 
                    <label for="days">提醒天数</label>
                    <input type="number" id="days" name="days" value="${config.days}" min="1"> 
                </div>
                <div class="buttons">
                    <button type="submit" class="save-btn">保存</button>
                    <a href="/" class="back-btn">返回</a>
                </div>
            </form>
        </div>
    </body>
    </html>
    `;
}

// 生成主页HTML
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
                <td><span class="copy-ip" style="cursor: pointer;" onclick="copyToClipboard('${info.ip}')" title="点击复制">${info.ip}</span></td> 
                <td>${info.asn}</td>
                <td>${info.country_code}</td>
                <td>${info.city}</td>
                <td><a href="${info.storeURL}" target="_blank" class="store-link">${info.store}</a></td>
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
                max-width: 1400px;
                margin: 20px auto;
                background-color: #fff;
                box-shadow: 0 2px 5px rgba(0, 0, 0, 0.1);
                border-radius: 5px;
                overflow: hidden;
            }
            .head {
                display: flex; 
                justify-content: 
                space-between; 
                align-items: center; 
                background-color: #2573b3; 
                padding: 20px;
            }
            h1 {
                background-color: #2573b3;
                color: #fff;
                padding: 20px;
                margin: 0;
                font-size: 1.8rem;
            }
            .table-container {
                width: 100%;
                overflow-x: auto;
            }
            table {
                width: 100%;
                border-collapse: collapse;
                white-space: nowrap;
                table-layout: auto;
            }
            th, td {
                padding: 12px;
                text-align: left;
                border-bottom: 1px solid #ddd;
                white-space: nowrap;
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
                background-color: #2573b3;
                transition: width 0.3s ease;
            }
            footer {
                background-color: #2573b3;
                color: white;
                padding: 5px 0;
                text-align: center;
                font-size: 0.9rem;
                margin-top: 15px;
            }
            footer a {
                color: white;
                text-decoration: none;
                margin-left: 10px;
                font-weight: bold;
                transition: color 0.3s ease;
            }
            footer a:hover {
                color: #f1c40f;
            }
            .store-link {
                color: #2573b3;
                text-decoration: none;
                transition: color 0.3s ease;
            }
            .store-link:hover {
                color: #2980b9;
            }
            .settings-link {
                color: white;
                text-decoration: none;
                padding: 8px 16px;
                border: 2px solid white;
                border-radius: 4px;
                font-weight: bold;
                transition: all 0.3s ease;
            }
            .settings-link:hover {
                background-color: white;
                color: #2573b3;
            }
            .copy-ip:hover {
                color: #2573b3;
                text-decoration: underline;
            }
        </style>
        <script>
            function copyToClipboard(text) {
                navigator.clipboard.writeText(text).then(() => {
                    alert('IP已复制到剪贴板');
                }).catch(err => {
                    console.error('复制失败:', err);
                });
            }
        </script>
    </head>
    <body>
        <div class="container">
            <div class="head">
                <h1>${sitename}</h1>
                <a href="/settings" class="settings-link">设置</a>
            </div>
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
        <footer>
            <p>Copyright © 2025 Yutian81 | <a href="https://github.com/yutian81/vps-check" target="_blank">GitHub Repository</a> | <a href="https://blog.811520.xyz/" target="_blank">yutian81 Blog</a></p>
        </footer>
    </body>
    </html>
    `;
}
