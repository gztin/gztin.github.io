import fs from 'fs';
import FormData from 'form-data';

const TOKEN = process.env.TG_TOKEN;
const chatId = '931709772';
const filePath = '/app/TradeReport_931709772_1777111874349.xlsx'; 

async function testSend() {
    if (!fs.existsSync(filePath)) {
        console.error("File not found:", filePath);
        return;
    }

    console.log(`Using Token: ...${TOKEN.slice(-6)}`);
    const url = `https://api.telegram.org/bot${TOKEN}/sendDocument`;
    const form = new FormData();
    form.append('chat_id', chatId);
    form.append('document', fs.createReadStream(filePath));
    form.append('caption', 'Internal Container Test');

    console.log("Sending to Telegram...");
    
    form.submit(url, (err, res) => {
        if (err) {
            console.error("Submit Error:", err.message);
            return;
        }
        let body = '';
        res.on('data', (chunk) => body += chunk);
        res.on('end', () => {
            console.log("Response:", body);
        });
    });
}

testSend();
