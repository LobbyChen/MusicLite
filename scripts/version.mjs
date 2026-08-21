// scripts/version.mjs
// 跨平台版本号生成器（Node.js 单文件）
//
// 计算 git describe 风格的版本号，输出：
//   - build/version.txt      单行版本字符串（NSIS / nfpm 可直接读）
//   - build/version-set.sh   bash 可 source 的环境变量文件
//   - build/version-set.cmd  Windows cmd 可 call 的 set 命令文件
//
// 用法：
//   node scripts/version.mjs                 # 仅写文件
//   node scripts/version.mjs --ci           # 同时输出 GITHUB_OUTPUT / GITHUB_ENV 行（CI 用）
//
// 版本规则：
//   - 正式发布（tag v0.7.1）          → "0.7.1"
//   - 开发构建（main 上 commit）      → "0.7.1-dev.5.gabc1234"
//   - 未打 tag                         → "0.0.0-dev.N.gSHA"

import { execSync } from 'node:child_process';
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const buildDir = join(__dirname, '..', 'build');

const isCI = process.argv.includes('--ci');

function git(args) {
    try {
        return execSync(`git ${args}`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    } catch {
        return '';
    }
}

function computeVersion() {
    // 优先用最近 tag（v[0-9]* 模式）
    const describe = git('describe --tags --always --dirty --match "v[0-9]*"');
    if (describe) {
        // 形如 v0.7.1 或 v0.7.1-5-gabc1234-dirty
        const v = describe.replace(/^v/, '');
        const m = v.match(/^(\d+\.\d+\.\d+(?:\.\d+)?)(?:-(\d+)-g([0-9a-f]+?)(?:-dirty)?)?$/);
        if (m) {
            const baseTag = m[1];
            const count = m[2] || '0';
            let sha = m[3] || '';
            if (!sha) {
                sha = git('rev-parse --short HEAD') || 'unknown';
            }
            return { version: v, baseTag, count, sha };
        }
    }
    // 无 tag 兜底
    const count = git('rev-list --count HEAD') || '0';
    const sha = git('rev-parse --short HEAD') || 'unknown';
    return {
        version: `0.0.0-dev.${count}.g${sha}`,
        baseTag: '0.0.0',
        count,
        sha,
    };
}

const info = computeVersion();
// 不使用单引号包裹 -X 值，避免跨平台 shell 引号处理差异
const ldflags = `-X app.Version=${info.version} -X app.BuildSHA=${info.sha} -X app.BuildNum=${info.count}`;

mkdirSync(buildDir, { recursive: true });

// 1. version.txt: 单行版本字符串
writeFileSync(join(buildDir, 'version.txt'), info.version, 'ascii');

// 2. version-set.sh: bash 可 source
writeFileSync(join(buildDir, 'version-set.sh'),
`export VERSION='${info.version}'
export BUILD_SHA='${info.sha}'
export BUILD_NUM='${info.count}'
export VERSION_LDFLAGS='${ldflags}'
`);

// 3. version-set.cmd: Windows cmd 可 call
writeFileSync(join(buildDir, 'version-set.cmd'),
`@echo off
set VERSION=${info.version}
set BUILD_SHA=${info.sha}
set BUILD_NUM=${info.count}
set VERSION_LDFLAGS=${ldflags}
`);

if (isCI && process.env.GITHUB_OUTPUT && process.env.GITHUB_ENV) {
    appendFileSync(process.env.GITHUB_OUTPUT,
        `version=${info.version}\nsha=${info.sha}\ncount=${info.count}\nldflags_extra=${ldflags}\n`);
    appendFileSync(process.env.GITHUB_ENV,
        `VERSION=${info.version}\nBUILD_SHA=${info.sha}\nBUILD_NUM=${info.count}\nVERSION_LDFLAGS=${ldflags}\n`);
}

console.log(`Version=${info.version} BuildSHA=${info.sha} BuildNum=${info.count}`);
