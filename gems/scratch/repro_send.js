import fs from 'fs';
import FormData from 'form-data';
const TOKEN = '7678768784:AAH7Ym18H_m1YF2nUjC676lY9pM-qCioBE';
const chatId = '931709772';
const filePath = 'c:/Users/User/Documents/GitHub/gems/TradeReport_931709772_1777111874349.xlsx'; // Use one of the existing files

async function testSend() {
    if (!fs.existsSync(filePath)) {
        console.error("File not found locally. Trying to find it in container...");
        return;
    }

    const url = `https://api.telegram.org/bot${TOKEN}/sendDocument`;
    const form = new FormData();
    form.append('chat_id', chatId);
    form.append('document', fs.createReadStream(filePath));
    form.append('caption', 'Test Export');

    console.log("Sending...");
    try {
        const response = await fetch(url, {
            method: 'POST',
            body: form,
            headers: form.getHeaders()
        });
        const data = await response.json();
        console.log("Response:", data);
    } catch (err) {
        console.error("Error:", err.message);
    }
}

testSend();
