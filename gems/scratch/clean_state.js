import fs from 'fs';
const path = 'c:/Users/User/Documents/GitHub/gems/data/state_931709772.json';
if (fs.existsSync(path)) {
    const data = JSON.parse(fs.readFileSync(path, 'utf8'));
    let count = 0;
    if (data.activeStrategies) {
        for (const key of Object.keys(data.activeStrategies)) {
            if (data.activeStrategies[key].entryPrice === 0) {
                delete data.activeStrategies[key];
                count++;
            }
        }
    }
    fs.writeFileSync(path, JSON.stringify(data, null, 2));
    console.log(`Successfully removed ${count} entries with 0 entryPrice.`);
}
