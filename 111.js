// 生成主页HTML
async function generateHTML(vpsdata, sitename, exchangeRates) {
    const rows = await Promise.all(vpsdata.map(async info => {
        const startday = new Date(info.startday);
        const endday = new Date(info.endday);
        const today = new Date();
        const totalDays = (endday - startday) / (1000 * 60 * 60 * 24);
        const daysRemaining = Math.ceil((endday - today) / (1000 * 60 * 60 * 24));

        // 计算年费价格和剩余价值
        const priceStr = info.price.replace('USD', '').replace('CNY', '');
        const price = parseFloat(priceStr);
        const remainingValueUSD = (price / 365) * daysRemaining;
        const remainingValueCNY = remainingValueUSD * exchangeRates.CNY; // 根据汇率转换为CNY

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
                <td>${info.price}</td>
                <td>${remainingValueUSD.toFixed(2)}USD/year | ${remainingValueCNY.toFixed(2)}CNY/year</td>
            </tr>
        `;
    }));
    return generateFormHTML(sitename, rows, exchangeRates);
}

// 生成主页表单
function generateFormHTML(sitename, rows, exchangeRates) {
    const currentRate = `汇率（1USD = ${exchangeRates.CNY.toFixed(2)} CNY）`;
    const updatedAt = `汇率更新时间：${new Date().toLocaleString()}`;

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
                justify-content: space-between; 
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
                overflow-x: auto;
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
                word-wrap: break-word;
                word-break: break-word;
            }
            th {
                background-color: rgba(255, 255, 255, 0.6);
                font-weight: bold;
            }
            td:first-child {
                max-width: 120px;
                word-wrap: break-word;
                white-space: normal;
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
                background-color: rgba(255, 255, 255, 0.6);
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
                text-align: center;
                font-size: 0.9rem;
                margin-top: 20px;
                width: 100%;
                margin-top: auto;
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
                            <th>IP</th>
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
               <a href="https://blog.811520.xyz/" target="_blank">青云志博客</a>
            </p>
            <p>${currentRate} | ${updatedAt}</p>
        </footer>
    </body>
    </html>
    `;
}

// 获取汇率数据
async function getExchangeRates() {
    const response = await fetch("https://v2.xxapi.cn/api/allrates");
    const data = await response.json();
    if (data.code === 200) {
        return data.data.rates;
    }
    return {};
}

export default {
    async fetch(request, env) {
        const exchangeRates = await getExchangeRates(); 

        // 获取其他逻辑...
        // 生成 HTML 并返回
    }
};
