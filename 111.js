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
  
