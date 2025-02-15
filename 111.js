// 从KV获取配置
async function getConfig(kv) {
    const [sitename, vpsurl, days] = await Promise.all([
        kv.get('sitename'), kv.get('vpsurl'), kv.get('days')
    ]);
    return {
        sitename: sitename || "VPS到期监控",
        vpsurl: vpsurl || "",
        days: days || "5"
    };
}

// 保存配置到KV
async function saveConfig(kv, config) {
    try {
        await Promise.all([
            kv.put('sitename', config.sitename),
            kv.put('vpsurl', config.vpsurl),
            kv.put('days', config.days) 
        ]);
    } catch (error) {
        console.error("保存配置失败:", error);
    }
}

// 获取 vps json 数据并解析
async function getVpsData(kv) {
    try {
        const { vpsurl } = await getConfig(kv);
        if (!vpsurl) throw new Error('请在设置界面输入存储VPS信息的URL直链并保存');

        const response = await fetch(vpsurl);
        if (!response.ok) throw new Error(`无法获取VPS数据，状态码: ${response.status}`);

        const vpsjson = await response.json().catch(() => {
            throw new Error('解析JSON失败');
        });
        
        if (!Array.isArray(vpsjson)) throw new Error('VPS数据格式不正确，预期为数组');
        return vpsjson; 
    } catch (error) {
        console.error('获取 VPS 数据失败:', error);
        throw error;
    }
    return vpsjson;
}

// 获取IP地址的国家、城市、ASN信息
async function ipinfo_query(vpsjson) {
    const ipjson = await Promise.all(vpsjson.map(async ({ ip }) => {
        const apiUrl = `https://ip.eooce.com/${ip}`;
        try {
            const ipResponse = await fetch(apiUrl);
            if (!ipResponse.ok) {
                console.error(`IP查询失败: ${ip}，状态码: ${ipResponse.status}`);
                return null;
            }
            const { country_code, city, asn } = await ipResponse.json();  
            return { ip, country_code, city, asn };  
        } catch (error) {
            console.error(`请求IP信息失败: ${ip}`, error);
            return null;
        }
    }));
    return ipjson.filter(info => info !== null);
}

// 将IP信息与vps信息合并为一个新的数组
function mergeData(vpsjson, ipjson) {  
    const ipMap = new Map(ipjson.map(ipdata => [ipdata.ip, ipdata]));  
    return vpsjson.map(vps => {
        const ipdata = ipMap.get(vps.ip); // 从哈希表中查找IP信息
        return ipdata ? {  
            ...vps, 
            country_code: ipdata.country_code || 'Unknown',
            city: ipdata.city || 'Unknown',
            asn: ipdata.asn || 'Unknown'
        } : vps; // 如果没有找到IP信息，返回原始数据
    });
}

// 通过API获取人民币汇率
// 获取人民币汇率
async function getRates(env) {
    const rate_apiurls = [
        "https://v2.xxapi.cn/api/exchange?from=USD&to=CNY&amount=1",
        "https://v2.xxapi.cn/api/allrates",
        `https://v6.exchangerate-api.com/v6/${env.RATE_API}/latest/USD`
    ];

    for (let rate_apiurl of rate_apiurls) {
        try {
            const response = await fetch(rate_apiurl);
            if (!response.ok) {
                console.error(`${rate_apiurl} 请求失败，状态码: ${response.status}`);
                continue;
            }

            const ratedata = await response.json();
            let rawCNY, timestamp;

            if (rate_apiurl.includes('v6.exchangerate-api.com') && ratedata.result === 'success') {
                rawCNY = ratedata.conversion_rates?.CNY;
                timestamp = ratedata.time_last_update_unix * 1000; // 转为毫秒
            } else if (rate_apiurl.includes('/allrates') && ratedata.code === 200) {
                rawCNY = ratedata.data.rates?.CNY?.rate;
                timestamp = ratedata.data.update_at;
            } else if (rate_apiurl.includes('/exchange') && ratedata.code === 200) {
                rawCNY = ratedata.data.rate;
                timestamp = ratedata.data.update_at;
            }

            if (typeof rawCNY === 'number' && !isNaN(rawCNY) && typeof timestamp === 'number') {
                return {
                    ratejson: {
                        rateCNYnum: Number(rawCNY),
                        rateTimestamp: new Date(timestamp).toISOString()
                    }
                };
            } else {
                throw new Error('数据错误，获取的汇率不是数字');
            }
        } catch (error) {
            console.error(`${rate_apiurl} API请求失败:`, error);
        }
    }

    console.error('获取汇率数据失败，使用默认值');
    return {
        ratejson: {
            rateCNYnum: Number(7.29),
            rateTimestamp: new Date().toISOString()
        }
    };
}

export default {
    async fetch(request, env) { 
        const url = new URL(request.url);
        const path = url.pathname;
        const validPassword = env.PASS || "123456";
        const cookies = request.headers.get('Cookie') || '';
        const isAuth = cookies.includes(`password=${validPassword}`);
        const config = await getConfig(env.VPS_TG_KV);
        await tgTemplate(vpsdata, config, env);

        // 验证是否已登录
        if (!isAuth) {
            return Response.redirect(`${url.origin}/login`, 302); 
        }
        // 如果没有设置vpsurl则登陆后跳转到设置页面
        if (!config.vpsurl) { 
            return Response.redirect(`${url.origin}/settings`, 302);
        }
        
        // 登录路由
        if (path === '/login') {
            if (request.method === 'POST') {
                const formData = await request.formData();   
                const password = formData.get('password');  
                
                if (password === validPassword) {
                    return new Response(null, {
                        status: 302, 
                        headers: {
                            'Location': '/',
                            'Set-Cookie': `password=${password}; path=/; HttpOnly; Secure`
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

        // 设置路由
        if (path === '/settings') {       
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

        try {
            const vpsjson = await getVpsData(env.VPS_TG_KV);
            if (!vpsjson) throw new Error('VPS 数据为空或无法加载数据');
            const ipjson = await ipinfo_query(vpsjson); 
            if (!ipjson) throw new Error('IP 信息查询失败');
            const vpsdata = mergeData(vpsjson, ipjson);
            const ratejson = await getRates(env); 

            // 处理 generateHTML 的返回值
            const htmlContent = await generateHTML(vpsdata, ratejson, config.sitename); 
            return new Response(htmlContent, { 
                headers: { 'Content-Type': 'text/html' },
            });
        } catch (error) {
            console.error("Fetch error:", error);     
            let errorMessage = "无法获取或解析VPS的json文件";
            if (error.message.includes('VPS 数据为空')) { 
                errorMessage = "请检查 vpsurl 直链是否可以有效访问";
            } else if (error.message.includes('IP 信息查询失败')) {    
                errorMessage = "IP 信息查询失败，可能是外部服务不可用";
            } else if (error.message.includes('无法加载数据')) { 
                errorMessage = "请检查 vpsurl 直链中的 json 内容是否正确";
            } else if (error.message.includes('JSON 格式错误')) {  
                errorMessage = "VPS 或 IP 数据格式错误，请检查数据源";
            } else {
                errorMessage = "未知错误，请稍后重试";
            }
            return new Response(errorMessage, { status: 500 });
        }
    }
};

// tg消息发送函数
async function sendtgMessage(message, env) { 
    const tgid = env.TGID; 
    const tgtoken = env.TGTOKEN;
    if (!tgid || !tgtoken) {
        console.log('缺少变量 TGID 或 TGTOKEN，跳过消息发送');
        return; 
    }

    const safemessage = message.replace(/([_*\[\]()~`>#+\-=|{}.!\\])/g, '\\$1'); 
    const url = `https://api.telegram.org/bot${tgtoken}/sendMessage`; 
    const params = { 
        chat_id: tgid,
        text: safemessage,
        parse_mode: 'MarkdownV2',
        // parse_mode: 'HTML', // 使用 HTML 则不需要转义 Markdown 特殊字符
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

// 构建TG消息模板并在到期前发送提醒
async function tgTemplate(vpsdata, config, env) {
    await Promise.all(vpsdata.map(async (info) => { 
        const today = new Date().toISOString().split('T')[0]; // 获取今天的日期（YYYY-MM-DD）
        const endday = new Date(info.endday);  
        const daysRemaining = Math.ceil((endday - today) / (1000 * 60 * 60 * 24));

        if (daysRemaining > 0 && daysRemaining <= Number(config.days)) {
            const message = `🚨 [VPS到期提醒] 🚨
            ====================
            🌍 VPS位置: ${info.country_code} | ${info.city} 
            💻 IP 地址: ${info.ip}
            ⏳ 剩余时间: ${daysRemaining} 天
            📅 到期日期: ${info.endday}
            ⚠️ 点击续期：[${info.store}](${info.storeURL})`; 

            const lastSent = await env.VPS_TG_KV.get(info.ip);  // 检查是否已发送过通知
            if (!lastSent || lastSent.split('T')[0] !== today) {  
                await sendtgMessage(message, env);
                await env.VPS_TG_KV.put(info.ip, new Date().toISOString());  // 更新 KV 存储的发送时间
            }
        }
    }));
}

// 生成主页HTML
async function generateHTML(vpsdata, ratesInfo, sitename) {
    const rows = await Promise.all(vpsdata.map(async info => {
        // const startday = new Date(info.startday);
        const today = new Date();
        const endday = new Date(info.endday);
        // const totalDays = (endday - startday) / (1000 * 60 * 60 * 24);
        const daysRemaining = Math.ceil((endday - today) / (1000 * 60 * 60 * 24));
        const isExpired = today > endday;
        const statusColor = isExpired ? '#e74c3c' : '#2ecc71';
        const statusText = isExpired ? '已过期' : '正常';

        // 计算年费价格和剩余价值
        const price = parseFloat(info.price.replace(/[^\d.]/g, ''));
        const { ratesCNYnum } = ratesInfo;
        const ValueUSD = (price / 365) * daysRemaining;
        const finalRatesCNYnum = isNaN(ratesCNYnum) ? 0 : ratesCNYnum;
        const ValueCNY = parseFloat(ValueUSD) * finalRatesCNYnum;
        const formatValueUSD = `${ValueUSD.toFixed(2)}USD`;  // 格式化为两位小数
        const formatValueCNY = `${ValueCNY.toFixed(2)}CNY`;
        
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
                <td>${isExpired ? '已过期' : daysRemaining + '天'}</td>
                <td>${info.price}</td>
                <td>${formatValueUSD} | ${formatValueCNY}</td>
            </tr>
        `;
    }));
    return generateFormHTML(vpsdata, sitename, rows, ratesInfo);
}

function generateFormHTML(_vpsdata, sitename, rows, ratesInfo) {
    const { ratesCNYnum, ratesTimestamp } = ratesInfo;
    const BeijingTime = new Date(ratesTimestamp).toLocaleString('zh-CN', { 
        timeZone: 'Asia/Shanghai', 
        hour12: false  // 使用24小时制
      });

    return `
    <!DOCTYPE html>
    <html lang="zh-CN">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>${sitename}</title>
        <link rel="icon" href="https://github.com/yutian81/data-source/raw/main/picbed/vps_icon.png" type="image/png">
        <style>
            body {
                font-family: Arial, sans-serif;
                background-color: #f4f4f4;
                display: flex;
                flex-direction: column;
                justify-content: center;
                align-items: center;
                height: 100vh;
                margin: 0;
                background-image: url('https://github.com/yutian81/data-source/raw/main/picbed/vpscheck_beijing.jpg?v=1.0');
                background-size: cover;
                box-sizing: border-box;
            }
            .container {
                width: 95%;
                max-width: 1400px;
                margin: 40px auto;
                background-color: rgba(255, 255, 255, 0.6);
                box-shadow: 0 0 4px rgba(0, 0, 0, 0.2);
                border-radius: 8px;
                overflow: auto;
            }
            .head {
                display: flex; 
                justify-content: 
                space-between; 
                align-items: center; 
                background-color: #2573b3;
                padding: 20px 40px;
            }
            h1 {
                color: #fff;
                margin: 0;
                text-align: left;
            }
            .settings-link {
                color: white;
                text-decoration: none;
                padding: 8px 16px;
                border: 2px solid white;
                border-radius: 8px;
                font-weight: bold;
                transition: all 0.3s ease;
                margin-left: auto;
            }
            .settings-link:hover {
                background-color: white;
                color: #2573b3;
            }
            .table-container {
                width: 100%;
                overflow: auto;
            }
            table {
                width: 100%;
                border-collapse: collapse;
                table-layout: auto;
            }
            th, td {
                padding: 12px;
                text-align: left;
                border-bottom: 1px solid #ddd;
                /*word-wrap: break-word;*/
                /*word-break: break-word;*/
            }
            th {
                background-color: rgba(255, 255, 255, 0.6);
                font-weight: bold;
                white-space: nowrap;  /* 禁止所有表头换行 */
            }
            td:nth-child(2) {
                max-width: 180px;
                word-wrap: break-word;
                word-break: break-word;
                white-space: normal;  /* 允许第二列换行 */
            }
            .status-dot {
                display: inline-block;
                width: 10px;
                height: 10px;
                border-radius: 50%;
                background-color: #2ecc71;
            }
            footer {
                background-color: #2573b3;
                color: white;
                text-align: center;
                font-size: 0.9rem;
                margin-top: 20px;
                width: 100%;
                margin-top: auto; /* 使footer推到底部 */
            }
            footer a {
                color: white;
                text-decoration: none;
                margin-left: 10px;
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
                            <th>IP地址</th>
                            <th>ASN</th>
                            <th>国家</th>
                            <th>城市</th>
                            <th>商家</th>
                            <th>注册日</th>
                            <th>到期日</th>
                            <th>剩余天数</th>
                            <th>年费价格</th>
                            <th>剩余价值</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${rows.join('')}
                    </tbody>
                </table>
            </div>
        </div>
        <footer>
            <p>
                Copyright © 2025 Yutian81&nbsp;&nbsp;&nbsp;| 
                <a href="https://github.com/yutian81/vps-check" target="_blank">GitHub Repository</a>&nbsp;&nbsp;&nbsp;| 
                <a href="https://blog.811520.xyz/" target="_blank">青云志博客</a>&nbsp;&nbsp;&nbsp;|&nbsp;&nbsp;&nbsp;
                汇率更新时间: ${BeijingTime} | 当前汇率: 1USD = ${ratesCNYnum?.toFixed(2) || '获取中'}CNY
            </p>
        </footer>
    </body>
    </html>
    `;
}

// 生成登录页面HTML
function generateLoginHTML(isError = false) {
    return `
    <!DOCTYPE html>
    <html lang="zh-CN">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>登录 - VPS到期监控</title>
        <link rel="icon" href="https://github.com/yutian81/data-source/raw/main/picbed/vps_icon.png" type="image/png">
        <style>
            body {
                font-family: Arial, sans-serif;
                background-color: #f4f4f4;
                display: flex;
                justify-content: center;
                align-items: center;
                height: 100vh;
                background-image: url('https://github.com/yutian81/data-source/raw/main/picbed/vpscheck_beijing.jpg?v=1.0');
                background-size: cover;
                box-sizing: border-box;
            }
            .login-container {
                max-width: 400px;
                width: 100%;
                margin: 0 auto;
                background-color: rgba(255, 255, 255, 0.6);
                padding: 10px 40px;
                border-radius: 8px;
                box-shadow: 0 0 4px rgba(0, 0, 0, 0.2);
            }
            h1 {
                text-align: center;
                color: #2573b3;
                margin-bottom: 20px;
            }
            .form-group {
                margin-bottom: 20px;
            }
            label {
                display: block;
                margin-bottom: 0.5rem;
                color: #666;
            }
            input[type="password"] {
                width: 100%;
                padding: 8px;
                border: 1px solid #ddd;
                border-radius: 4px;
                box-sizing: border-box;
                transition: border-color 0.3s ease;
                background-color: rgba(255, 255, 255, 0.6);
            }
            input[type="password"]:focus {
                border-color: #2573b3;
                outline: none;
            }
            button {
                width: 100%;
                padding: 8px;
                background-color: #2573b3;
                color: white;
                border: none;
                border-radius: 4px;
                cursor: pointer;
                font-size: 1rem;
                transition: background-color 0.3s ease;
                margin-bottom: 20px;
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
        <link rel="icon" href="https://github.com/yutian81/data-source/raw/main/picbed/vps_icon.png" type="image/png">
        <style>
            body {
                font-family: Arial, sans-serif;
                background-color: #f4f4f4;
                display: flex;
                justify-content: center;
                align-items: center;
                height: 100vh;
                background-image: url('https://github.com/yutian81/data-source/raw/main/picbed/vpscheck_beijing.jpg?v=1.0');
                background-size: cover;
                box-sizing: border-box;
            }
            .settings-container {
                max-width: 750px;
                width: 100%;
                margin: 0 auto;
                background-color: rgba(255, 255, 255, 0.6);
                padding: 10px 40px;
                border-radius: 8px;
                box-shadow: 0 0 4px rgba(0, 0, 0, 0.2);
            }
            h1 {
                color: #2573b3;
                margin-bottom: 30px;
                text-align: center;
            }
            .form-group-first {
                display: flex;
                gap: 20px;
                justify-content: space-between;
            }
            .form-first {
                flex: 1; /* 让每个输入框占据可用空间 */
            }
            .form-group {
                margin-top: 30px;
                margin-bottom: 30px;
            }
            label {
                display: block;
                margin-bottom: 5px;
                color: #666;
            }
            input[type="text"], input[type="number"] {
                width: 100%;
                padding: 8px;
                border: 1px solid #ddd;
                border-radius: 4px;
                box-sizing: border-box;
                transition: border-color 0.3s ease;
                background-color: rgba(255, 255, 255, 0.6);
            }
            input[type="text"]:focus, input[type="number"]:focus {
                border-color: #2573b3;
                outline: none;
            }
            .buttons {
                display: flex;
                gap: 20px;
                justify-content: center;
                margin-top: 20px;
                margin-bottom: 20px;
            }
            button, .back-btn {
                padding: 6px 15px;
                border: none;
                border-radius: 4px;
                cursor: pointer;
                font-size: 1rem;
                transition: background-color 0.3s ease;
                text-decoration: none;
                display: inline-block;
                text-align: center;
            }
            .save-btn {
                background-color: #2573b3;
                color: white;
            }
            .back-btn {
                background-color: #7f8c8d;
                color: white;
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
                <div class="form-group-first">
                    <div class="form-first">
                        <label for="sitename">站点名称</label>
                        <input type="text" id="sitename" name="sitename" value="${config.sitename}">
                    </div>
                    <div class="form-first">
                        <label for="days">提醒天数</label>
                        <input type="number" id="days" name="days" value="${config.days}" min="1">
                    </div>
                </div>
                <div class="form-group">
                    <label for="vpsurl">存储VPS信息的URL直链 <span class="required">*</span></label>
                    <input type="text" id="vpsurl" name="vpsurl" value="${config.vpsurl}" required>
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
