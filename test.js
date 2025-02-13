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
    return text.replace(/([_*[\]()~`>#+\-=|{}.!\\])/g, '\\$1');
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
    return ipjson.filter(info => info !== null) || [];
}

export default {
    async fetch(request, env) {
        const url = new URL(request.url);
        const path = url.pathname;
        const cookies = request.headers.get('Cookie') || '';
        const isAuthenticated = cookies.includes(`password=${env.PASS || "123456"}`);
        const config = await getConfig(env.VPS_TG_KV);

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
            const vpsdata = vpsjson.
