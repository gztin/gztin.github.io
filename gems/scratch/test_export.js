import fs from 'fs';
import ExcelJS from 'exceljs';
import path from 'path';

const chatId = '931709772';
const pathJson = 'c:/Users/User/Documents/GitHub/gems/data/state_931709772.json';

async function testExport() {
    try {
        const data = JSON.parse(fs.readFileSync(pathJson, 'utf8'));
        const userHistory = data.history || [];
        console.log(`Testing export for ${userHistory.length} records...`);

        const workbook = new ExcelJS.Workbook();
        const sheet1 = workbook.addWorksheet('交易實績');
        const sheet2 = workbook.addWorksheet('排行榜預測');

        const columns = [
            { header: '幣種', key: 'symbol', width: 15 },
            { header: '方向', key: 'side', width: 10 },
            { header: '平均進場', key: 'entryPrice', width: 15 },
            { header: '平均出場', key: 'exitPrice', width: 15 },
            { header: '損益(%)', key: 'pnlPct', width: 12 },
            { header: '損益(USDT)', key: 'pnlUsdt', width: 15 },
            { header: '槓桿', key: 'leverage', width: 8 },
            { header: '本金', key: 'principal', width: 10 },
            { header: '進場時間', key: 'entryTime', width: 20 },
            { header: '出場時間', key: 'exitTime', width: 20 },
            { header: '出場原因', key: 'reason', width: 25 }
        ];

        const loopFColumns = [
            ...columns.slice(0, 10),
            { header: '入選 R²', key: 'r2', width: 12 },
            { header: '入選斜率', key: 'slope', width: 12 },
            { header: '入選排名', key: 'rank', width: 12 },
            { header: '出場原因', key: 'reason', width: 25 }
        ];

        sheet1.columns = columns;
        sheet2.columns = loopFColumns;

        userHistory.forEach((h, i) => {
            try {
                const rowData = {
                    symbol: h.symbol,
                    side: h.side === 'LONG' ? '做多' : '做空',
                    entryPrice: h.entryPrice,
                    exitPrice: h.exitPrice,
                    pnlPct: h.pnlPct + '%',
                    pnlUsdt: h.pnlUsdt,
                    leverage: h.leverage + 'x',
                    principal: h.principal + 'U',
                    entryTime: h.entryTime ? new Date(h.entryTime).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' }) : '',
                    exitTime: new Date(h.time).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' }),
                    reason: h.reason || '',
                    r2: h.entrySnapshot?.r2?.toFixed(3) || '',
                    slope: h.entrySnapshot?.slopePct?.toFixed(4) || '',
                    rank: h.entrySnapshot?.rank || ''
                };

                if (h.loopType === 'loopF') {
                    sheet2.addRow(rowData);
                } else {
                    sheet1.addRow(rowData);
                }
            } catch (err) {
                console.error(`Error at record index ${i}:`, h.symbol, err.message);
                throw err;
            }
        });

        const fileName = `test_export.xlsx`;
        await workbook.xlsx.writeFile(fileName);
        console.log("Export successful!");
    } catch (err) {
        console.error("Overall Export Failed:", err);
    }
}

testExport();
