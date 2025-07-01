// 从KV获取配置
async function getConfig(env) {
    const kv = env.VPS_TG_KV;
    if (!kv) throw new Error("KV变量: VPS_TG_KV不存在");
    try {
      const [sitename, vpsurl, days] = await Promise.all([
        kv.get("sitename"), kv.get("vpsurl"), kv.get("days"),
      ]);
      return {
        sitename: sitename || "VPS到期监控",
        vpsurl: vpsurl || "",
        days: Number(days) || 5,
      };
    } catch (error) {
      console.error("获取KV数据失败:", error);
      throw error;
    }
}
  
// 保存配置到KV
async function saveConfig(env, newConfig) {
    const kv = env.VPS_TG_KV;
    try {
      await Promise.all([
        kv.put("sitename", newConfig.sitename.trim()),
        kv.put("vpsurl", newConfig.vpsurl.trim()),
        kv.put("days", newConfig.days.trim()),
      ]);
    } catch (error) {
      console.error("保存KV数据失败:", error);
      throw error;
    }
}
  
// 获取 vps json 数据并解析
async function getVpsData(env) {
    const { vpsurl } = await getConfig(env);
    if (!vpsurl) throw new Error("请在设置界面输入存储VPS信息的URL直链并保存");
  
    try {
      const requestOptions = {
        headers: {
          "Cache-Control": "no-cache, no-store, must-revalidate",
          Pragma: "no-cache",
          Expires: "0",
        },
      };
      const response = await fetch(vpsurl, requestOptions);
      if (!response.ok) {
        throw new Error(`获取VPS数据失败, HTTP状态码: ${response.status}`);
      }
      const vpsjson = await response.json();
      if (!Array.isArray(vpsjson) || vpsjson.length === 0) {
        throw new Error("VPS数据格式格式不是json");
      }
      return vpsjson;
    } catch (error) {
      console.error("获取 VPS 数据失败:", error);
      throw error;
    }
}
  
// 通用IP查询请求函数
async function fetchIPInfo(ip, { urlBuilder, dataParser }, timeout = 3000) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);
    try {
      const response = await fetch(urlBuilder(ip), {
        signal: controller.signal
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      return dataParser(data);
    } catch (error) {
      if (error.name !== 'AbortError') {
        console.error(`[${urlBuilder(ip)}] 请求失败:`, error.message);
      }
      return null;
    } finally {
      clearTimeout(timeoutId);
    }
}
  
// 获取IP地址的国家、城市、ASN信息
async function ipinfo_query(vpsjson) {
    const IP_API = [
      {
        name: 'ip.eooce',
        urlBuilder: (ip) => `https://ip.eooce.com/${ip}`,
        dataParser: (data) => ({
          country_code: data.country_code || 'Unknown',
          city: data.city || 'Unknown',
          asn: data.asn || 'Unknown'
        })
      },
      {
        name: 'ipinfo.io',
        urlBuilder: (ip) => `https://ipinfo.io/${ip}/json`,
        dataParser: (data) => ({
          country_code: data.country || 'Unknown',
          city: data.city || 'Unknown',
          asn: (data.org?.split(' ')[0] || '').startsWith('AS') 
          ? data.org.split(' ')[0] 
          : 'Unknown'
        })
      }
    ];
    const ipjson = await Promise.allSettled(
      vpsjson.map(async ({ ip }) => {
        try {
          const requests = IP_API.map(provider => 
            fetchIPInfo(ip, provider)
              .then(data => data ? { provider: provider.name, data } : null)
              .catch(() => null)
          );
          const result = await Promise.any(requests).catch(() => null);
  
          if (result?.data) {
            return {
              ip,
              country_code: result.data.country_code || 'Unknown',
              city: result.data.city || 'Unknown',
              asn: result.data.asn || 'Unknown'
            };
          }
          return null;
        } catch (error) {
          return null;
        }
      })
    );
    return ipjson
      .filter(result => result.status === 'fulfilled' && result.value !== null)
      .map(result => result.value);
}
  
// 将IP信息与vps信息合并为一个新的数组
function getMergeData(vpsjson, ipjson) {
    const ipMap = new Map(ipjson.map((ipdata) => [ipdata.ip, ipdata]));
    return vpsjson.map((vps) => {
      const mergeData = vps.ip ? ipMap.get(vps.ip) : null;
      return mergeData
        ? {
            ...vps,
            country_code: mergeData.country_code || "Unknown",
            city: mergeData.city || "Unknown",
            asn: mergeData.asn || "Unknown",
          }
        : vps; // 如果没有找到IP信息，返回原始数据
    });
}
  
// 获取实时汇率数据
async function getRates(env) {
    const apis = [
      {
        url: "https://v2.xxapi.cn/api/exchange?from=USD&to=CNY&amount=1",
        parser: data => data.code === 200 && data.data?.rate
          ? { rawCNY: data.data.rate, timestamp: data.data.update_at }
          : null
      },
      {
        url: "https://v2.xxapi.cn/api/allrates",
        parser: data => data.code === 200 && data.data?.rates?.CNY?.rate
          ? { rawCNY: data.data.rates.CNY.rate, timestamp: data.data.update_at }
          : null
      },
      {
        url: `https://v6.exchangerate-api.com/v6/${env.RATE_API}/latest/USD`,
        parser: data => data.result === "success" && data.conversion_rates?.CNY
          ? { rawCNY: data.conversion_rates.CNY, timestamp: data.time_last_update_unix * 1000 }
          : null
      }
    ];
  
    let rawCNY = null, timestamp = null;
  
    // 遍历 API 配置，获取数据
    for (const api of apis) {
      const parsed = await fetchData(api);
      if (parsed) {
        rawCNY ||= parsed.rawCNY; // 获取汇率
        timestamp ||= parsed.timestamp; // 获取时间戳
        if (rawCNY !== null && timestamp) break; // 如果都获取到了有效数据，跳出循环
      }
    }
  
    // 判断是否获得了有效的汇率数字
    if (typeof rawCNY === "number" && !isNaN(rawCNY)) {
      return {
        rateCNYnum: Number(rawCNY),
        rateTimestamp: new Date(timestamp).toISOString()
      };
    } else {
      console.error("获取汇率数据失败，使用默认值");
      return {
        rateCNYnum: 7.29,
        rateTimestamp: new Date().toISOString()
      };
    }
}
  
// API 请求逻辑，包括超时控制、错误处理和解析数据
async function fetchData(api) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 500);
    try {
      const response = await fetch(api.url, { signal: controller.signal });
      if (!response.ok) {
        console.error(`API 请求失败 ${api.url}，状态码：${response.status}`);
        return null;
      }
      const data = await response.json();
      return api.parser(data); // 返回解析后的数据
    } catch (err) {
      if (err.name !== "AbortError") {
        console.error(`API 请求错误 ${api.url}:`, err);
      }
      return null;
    } finally {
      clearTimeout(timeoutId);
    }
}

// 构建TG消息模板并在到期前发送提醒
async function tgTemplate(mergeData, config, env) {
    const today = new Date().toISOString().split("T")[0];
    await Promise.allSettled(
      mergeData.map(async (info) => {
        const endday = new Date(info.endday);
        const daysRemaining = Math.ceil((endday - new Date(today)) / (1000 * 60 * 60 * 24));
        if (daysRemaining > 0 && daysRemaining <= Number(config.days)) {
          const message = `🚨 [VPS到期提醒] 🚨
  ====================
  🌍 VPS位置: ${info.country_code} | ${info.city}
  💻 IP 地址: ${info.ip}
  ⏳ 剩余时间: ${daysRemaining} 天
  📅 到期日期: ${info.endday}
  ⚠️ 点击续期：[${info.store}](${info.storeURL})`;
  
          const lastSent = await env.VPS_TG_KV.get(info.ip); // 检查是否已发送过通知
          if (!lastSent || lastSent.split("T")[0] !== today) {
            const isSent = await sendtgMessage(message, env);
            if (isSent) await env.VPS_TG_KV.put(info.ip, new Date().toISOString());
          }
        }
      })
    );
}
  
// tg消息发送函数
async function sendtgMessage(message, env) {
    if (!env.TGID || !env.TGTOKEN) {
      console.log("缺少变量 TGID 或 TGTOKEN, 跳过消息发送");
      return;
    }
  
    const safemessage = message.replace(/([_*\[\]()~`>#+\-=|{}.!\\])/g, "\\$1");
    const tgApiurl = `https://api.telegram.org/bot${env.TGTOKEN}/sendMessage`;
    const params = {
      chat_id: env.TGID,
      text: safemessage,
      parse_mode: "MarkdownV2",
    };
  
    try {
      const response = await fetch(tgApiurl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(params),
      });
      if (!response.ok) {
        console.error("Telegram 消息推送失败，状态码:", response.status);
        return false;
      }
      return true;
    } catch (error) {
      console.error("Telegram 消息推送失败:", error);
      return false;
    }
}

// 处理登录路由
async function handleLogin(request, validPassword) {
    if (request.method === "POST") {
      const formData = await request.formData();
      const password = formData.get("password");
  
      if (password === validPassword) {
        return new Response(null, {
          status: 302,
          headers: {
            Location: "/",
            "Set-Cookie": `password=${password}; path=/; HttpOnly; Secure`,
          },
        });
      } else {
        return new Response(generateLoginHTML(true), {
          headers: { "Content-Type": "text/html" },
        });
      }
    }
    return new Response(generateLoginHTML(), {
      headers: { "Content-Type": "text/html" },
    });
}

// 处理设置路由
async function handleSettings(request, config, env) {
    if (request.method === "POST") {
      const formData = await request.formData();
      const newConfig = {
        sitename: formData.get("sitename"),
        vpsurl: formData.get("vpsurl"),
        days: formData.get("days"),
      };
  
      if (!newConfig.vpsurl) {
        return new Response(generateSettingsHTML(newConfig, true), {
          headers: { "Content-Type": "text/html" },
        });
      }
  
      await saveConfig(env, newConfig);
      return Response.redirect(new URL("/", request.url).toString(), 302);
    }
  
    return new Response(generateSettingsHTML(config), {
      headers: { "Content-Type": "text/html" },
    });
}

// 处理根路由
async function handleRoot(env, config) {
    try {
      const vpsjson = await getVpsData(env);
      if (!vpsjson) throw new Error("VPS json数据为空或无法加载数据");
      const ipjson = await ipinfo_query(vpsjson);
      if (!ipjson) throw new Error("IP 信息查询失败");
      const mergeData = getMergeData(vpsjson, ipjson);
      const ratejson = await getRates(env);
  
      await tgTemplate(mergeData, config, env);
      const htmlContent = await generateHTML(mergeData, ratejson, config.sitename);
      return new Response(htmlContent, {
        headers: { "Content-Type": "text/html" },
      });
    } catch (error) {
      console.error("Fetch error:", error);
      let errorMessage = "无法获取或解析VPS的json文件";
      if (error.message.includes("VPS json数据为空或无法加载数据")) {
        errorMessage = "请检查 vpsurl 直链的格式及 json 内容格式";
      } else if (error.message.includes("IP 信息查询失败")) {
        errorMessage = "IP 信息查询失败，可能是外部服务不可用";
      } else {
        errorMessage = "未知错误，请稍后重试";
      }
      return new Response(errorMessage, { status: 500 });
    }
}

// 导出 fetch 函数
export default {
    async fetch(request, env) {
      const url = new URL(request.url);
      const path = url.pathname;
      const validPassword = env.PASS || "123456";
      const cookies = request.headers.get("Cookie") || "";
      const isAuth = cookies.includes(`password=${validPassword}`);
      const config = await getConfig(env);
  
      if (!isAuth && path !== "/login") {
        return Response.redirect(`${url.origin}/login`, 302);
      }
  
      if (!config.vpsurl && path !== "/settings" && path !=="/login") {
        return Response.redirect(`${url.origin}/settings`, 302);
      }
  
      switch (path) {
        case "/login":
          return await handleLogin(request, validPassword); // 登录路由 
        case "/settings":
          return await handleSettings(request, config, env); // 设置路由 
        default:
          return await handleRoot(env, config); // 根路由
      }
    },
    
    async scheduled(event, env, ctx) {
      try {
        const config = await getConfig(env);
        const vpsjson = await getVpsData(env);
        const ipjson = await ipinfo_query(vpsjson);
        const mergeData = getMergeData(vpsjson, ipjson);
        await tgTemplate(mergeData, config, env);
        console.log("Corn 执行时间:", new Date().toISOString());
      } catch (error) {
        console.error("Cron 执行失败:", error);
      }
    },
};
  
// 生成主页HTML
async function generateHTML(mergeData, ratejson, sitename) {
    const rows = await Promise.all(
      mergeData.map(async (info) => {
        const today = new Date();
        const endday = new Date(info.endday);
        const daysRemaining = Math.ceil((endday - today) / (1000 * 60 * 60 * 24));
        const isExpired = today > endday;
        const statusColor = isExpired ? "#e74c3c" : "#2ecc71";
        const statusText = isExpired ? "已过期" : "正常";
  
        // 计算年费价格和剩余价值
        const [, price, unit] = info.price.match(/^([\d.]+)([A-Za-z]+)$/) || [];
        const priceNum = parseFloat(price);
        const rateCNYnum = ratejson?.rateCNYnum || 7.29;
        const [ValueUSD, ValueCNY] = unit === "USD"
          ? [(priceNum / 365) * daysRemaining, (priceNum / 365) * daysRemaining * rateCNYnum]
          : [(priceNum / 365) * daysRemaining / rateCNYnum, (priceNum / 365) * daysRemaining];
        const formatValueUSD = `${ValueUSD.toFixed(2)}USD`;
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
              <td>${isExpired ? "已过期" : daysRemaining + "天"}</td>
              <td>${info.price}</td>
              <td>${formatValueUSD} | ${formatValueCNY}</td>
          </tr>
        `;
      })
    );
    return generateFormHTML(sitename, rows, ratejson);
}
  
function generateFormHTML(sitename, rows, ratejson) {
    const { rateCNYnum, rateTimestamp } = ratejson;
    const BeijingTime = new Date(rateTimestamp).toLocaleString("zh-CN", {
      timeZone: "Asia/Shanghai",
      hour12: false, // 使用24小时制
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
                  background-image: url('https://pan.811520.xyz/icon/back.webp');
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
                  white-space: nowrap;
              }
              th {
                  background-color: rgba(255, 255, 255, 0.6);
                  font-weight: bold;   
              }
              td:nth-child(2) {
                  max-width: 160px;
                  word-wrap: break-word;
                  word-break: break-word;
                  white-space: normal;
              }
              @media (max-width: 768px) {
                td:nth-child(2) {
                  width: auto;
                  max-width: none;
                  min-width: 180px;
                  overflow: hidden;
                  text-overflow: ellipsis;
                }
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
                          ${rows.join("")}
                      </tbody>
                  </table>
              </div>
          </div>
          <footer>
              <p>
                  Copyright © 2025 Yutian81&nbsp;&nbsp;&nbsp;| 
                  <a href="https://github.com/yutian81/vps-check" target="_blank">GitHub Repository</a>&nbsp;&nbsp;&nbsp;| 
                  <a href="https://blog.811520.xyz/" target="_blank">青云志博客</a>&nbsp;&nbsp;&nbsp;|&nbsp;&nbsp;&nbsp;
                  汇率更新时间: ${BeijingTime} | 当前汇率: 1USD = ${rateCNYnum ? `${rateCNYnum.toFixed(2)}CNY` : "获取中"}
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
                  background-image: url('https://pan.811520.xyz/icon/back.webp');
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
                  display: ${isError ? "block" : "none"};
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
                      <input type="password" id="password" name="password" required ${isError ? "autofocus" : ""}>
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
                  background-image: url('https://pan.811520.xyz/icon/back.webp');
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
                  display: ${showError ? "block" : "none"};
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
