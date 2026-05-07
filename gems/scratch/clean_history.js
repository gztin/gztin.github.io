import fs from 'fs';

const path = 'c:/Users/User/Documents/GitHub/gems/data/state_931709772.json';
const threshold = new Date('2026-04-24T00:00:00').getTime();

if (fs.existsSync(path)) {
    const data = JSON.parse(fs.readFileSync(path, 'utf8'));
    if (data.history) {
        const originalCount = data.history.length;
        data.history = data.history.filter(h => h.time >= threshold);
        const newCount = data.history.length;
        
        fs.writeFileSync(path, JSON.stringify(data, null, 2));
        console.log(`Successfully cleaned history. Removed ${originalCount - newCount} records. Kept ${newCount} records from 4/24 onwards.`);
    } else {
        console.log("No history found in the file.");
    }
} else {
    console.log("File not found.");
}
