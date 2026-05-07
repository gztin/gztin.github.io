#!/usr/bin/env node
import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';

const args = process.argv.slice(2);

function values(flag) {
    const out = [];
    for (let i = 0; i < args.length; i++) {
        if (args[i] === flag && args[i + 1]) {
            out.push(args[i + 1]);
            i++;
        }
    }
    return out;
}

function value(flag, fallback = '') {
    return values(flag)[0] || fallback;
}

function has(flag) {
    return args.includes(flag);
}

function run(cmd, cmdArgs, opts = {}) {
    return execFileSync(cmd, cmdArgs, {
        encoding: 'utf8',
        stdio: opts.stdio || 'pipe',
        ...opts,
    });
}

function die(message) {
    console.error(`[release-update] ${message}`);
    process.exit(1);
}

const version = value('--version');
const title = value('--title');
const commitMessage = value('--commit');
const bullets = values('--bullet');
const stagePaths = values('--stage');
const shouldPush = has('--push');
const dryRun = has('--dry-run');
const date = value('--date', new Date().toISOString().slice(0, 10));

if (!/^v\d+\.\d+\.\d+$/.test(version)) die('請提供 --version vX.Y.Z');
if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) die('請提供合法日期 --date YYYY-MM-DD');
if (!title.trim()) die('請提供 --title');
if (bullets.length === 0) die('至少需要一個 --bullet');
if (bullets.length > 10) die('改版條列不可超過 10 點');
if (!commitMessage.trim()) die('請提供 --commit');

const changelog = `# Bot Changelog

此文件專為 Telegram Bot 的 \`/VERSION\` 指令設計，提供精簡版的改版摘要。

---

## [${version}] - ${date}
### ${title.trim()}

${bullets.map(b => `- ${b.trim()}`).join('\n')}
`;

if (dryRun) {
    console.log(changelog);
    process.exit(0);
}

const changelogPath = path.join(process.cwd(), 'BOT_CHANGELOG.md');
fs.writeFileSync(changelogPath, changelog, 'utf8');

const addPaths = ['BOT_CHANGELOG.md', ...stagePaths];
run('git', ['add', ...addPaths], { stdio: 'inherit' });
run('git', ['diff', '--cached', '--check'], { stdio: 'inherit' });
run('git', ['commit', '-m', commitMessage], { stdio: 'inherit' });

if (shouldPush) {
    const branch = run('git', ['branch', '--show-current']).trim();
    if (!branch) die('無法判斷目前 branch，未 push');
    run('git', ['push', 'origin', branch], { stdio: 'inherit' });
}
