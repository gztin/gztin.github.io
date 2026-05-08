
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.join(__dirname, '..');

function updateSignalSummary(journal) {
    const byType = {};
    const byScoreBracket = {
        '60-70': { bracket: '60-70', total: 0, evaluated: 0, wins: 0, winRate: 0 },
        '70-80': { bracket: '70-80', total: 0, evaluated: 0, wins: 0, winRate: 0 },
        '80-90': { bracket: '80-90', total: 0, evaluated: 0, wins: 0, winRate: 0 },
        '90-100': { bracket: '90-100', total: 0, evaluated: 0, wins: 0, winRate: 0 },
    };

    for (const entry of journal.entries) {
        const score = entry.score || 0;
        let bracket = null;
        if (score >= 90) bracket = '90-100';
        else if (score >= 80) bracket = '80-90';
        else if (score >= 70) bracket = '70-80';
        else if (score >= 60) bracket = '60-70';

        if (bracket) {
            byScoreBracket[bracket].total += 1;
            if (entry.evaluations) {
                const ev15m = entry.evaluations['15m'];
                if (ev15m && typeof ev15m.win === 'boolean') {
                    byScoreBracket[bracket].evaluated += 1;
                    if (ev15m.win) byScoreBracket[bracket].wins += 1;
                }
            }
        }

        if (entry.evaluations) {
            for (const [horizon, result] of Object.entries(entry.evaluations)) {
                if (!result || typeof result.win !== 'boolean') continue;
                const typeKey = `${entry.signalType}__${horizon}`;
                if (!byType[typeKey]) byType[typeKey] = {
                    signalType: entry.signalType,
                    horizon,
                    threshold: result.threshold,
                    total: 0,
                    wins: 0,
                    winRate: 0,
                };
                byType[typeKey].total += 1;
                if (result.win) byType[typeKey].wins += 1;
            }
        }
    }

    Object.values(byScoreBracket).forEach(b => {
        b.winRate = b.evaluated > 0 ? Number(((b.wins / b.evaluated) * 100).toFixed(2)) : 0;
    });
    Object.values(byType).forEach(t => {
        t.winRate = t.total > 0 ? Number(((t.wins / t.total) * 100).toFixed(2)) : 0;
    });

    journal.summary = { byType, byScoreBracket };
}

const filePaths = [
    path.join(rootDir, 'data', 'signal_journal.json'),
    path.join(rootDir, 'public', 'api', 'signal_journal.json')
];

filePaths.forEach(file => {
    if (fs.existsSync(file)) {
        console.log('Processing:', file);
        try {
            const data = JSON.parse(fs.readFileSync(file, 'utf-8'));
            updateSignalSummary(data);
            fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf-8');
            console.log('Updated:', file);
        } catch (e) {
            console.error('Error processing', file, ':', e.message);
        }
    } else {
        console.log('File not found:', file);
    }
});
