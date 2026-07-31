// gen-changelog.js — 构建时从 git log 生成结构化更新记录 JSON
// 用法：node scripts/gen-changelog.js
// 输出：frontend/src/assets/changelog.json
//
// 解析 commit message 格式：
//   MiscLite Beta 0.8.0 - 添加 1. xxx 2. xxx - 修改 1. xxx - 修复 1. xxx Author ... E-mail ...
//
// 输出结构：
//   [
//     {
//       "date": "2026-07-31",
//       "version": "MiscLite Beta 0.8.0",
//       "sections": [
//         { "type": "添加", "items": ["xxx", "yyy"] },
//         { "type": "修改", "items": ["zzz"] },
//         { "type": "修复", "items": [] }
//       ]
//     }
//   ]

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// 分段关键词（按出现顺序匹配）
const SECTION_KEYWORDS = ['添加', '修改', '修复', '问题修复', '架构重构', '逻辑闭环', '基础动画添加'];

function getGitLog() {
    try {
        // 取最近 100 条，日期 + 完整 commit message
        const out = execSync('git log --date=short --pretty=format:"%ad||%s" -n 100', {
            encoding: 'utf8',
            stdio: ['pipe', 'pipe', 'ignore'],
        });
        return out.trim().split('\n').filter(Boolean);
    } catch (e) {
        console.warn('[gen-changelog] git log 失败，输出空数组:', e.message);
        return [];
    }
}

function parseCommit(line) {
    const sep = line.indexOf('||');
    if (sep < 0) return null;
    const date = line.slice(0, sep).trim();
    let msg = line.slice(sep + 2).trim();

    // 1. 去掉尾部 " Author ... E-mail ..."
    msg = msg.replace(/\s*Author\s+.*?E-mail\s+\S+\s*$/i, '').trim();
    if (!msg) return null;

    // 2. 提取版本号（开头到第一个 " - " 之前）
    //    格式：MiscLite Beta 0.8.0 - 添加 ...
    const dashIdx = msg.indexOf(' - ');
    let version, body;
    if (dashIdx > 0) {
        version = msg.slice(0, dashIdx).trim();
        body = msg.slice(dashIdx + 3).trim();
    } else {
        // 无明确分段，整体作为版本
        version = msg.slice(0, 40);
        body = '';
    }

    // 3. 按 " - " 切分各段
    const parts = body.split(/\s*-\s*/).filter(Boolean);
    const sections = [];

    for (const part of parts) {
        // 每段开头是关键词 + 空格 + 编号列表
        let matched = false;
        for (const kw of SECTION_KEYWORDS) {
            if (part.startsWith(kw)) {
                let itemsStr = part.slice(kw.length).trim();
                // 按 "1. 2. 3." 或 "1、 2、" 切分
                let items = itemsStr
                    .split(/\s*\d+\.\s*/)
                    .map(s => s.trim())
                    .filter(Boolean);
                // 统一关键词："问题修复" → "修复"
                const displayType = (kw === '问题修复') ? '修复' : kw;
                sections.push({ type: displayType, items });
                matched = true;
                break;
            }
        }
        if (!matched && part) {
            // 未识别的段，归为"其他"
            sections.push({ type: '其他', items: [part] });
        }
    }

    return { date, version, sections };
}

function main() {
    const lines = getGitLog();
    const changelog = [];
    for (const line of lines) {
        const entry = parseCommit(line);
        if (entry) changelog.push(entry);
    }

    const outDir = path.join(__dirname, '..', 'frontend', 'src', 'assets');
    fs.mkdirSync(outDir, { recursive: true });
    const outPath = path.join(outDir, 'changelog.json');
    fs.writeFileSync(outPath, JSON.stringify(changelog, null, 2), 'utf8');
    console.log(`[gen-changelog] 已生成 ${changelog.length} 条更新记录 → ${outPath}`);
}

main();
