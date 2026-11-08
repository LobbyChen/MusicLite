// scripts/version.mjs
// 跨平台版本号生成器（Node.js 单文件）
//
// 计算 git describe 风格的版本号，输出：
//   - build/version.txt        单行版本字符串
//   - build/version-set.sh     bash 可 source 的环境变量文件
//   - build/version-set.cmd    Windows cmd 可 call 的 set 命令文件
//   - internal/platform/version.txt  供 go:embed 注入（version / sha / num 三行）
//
// 用法：
//   node scripts/version.mjs          # 仅写文件
//   node scripts/version.mjs --ci     # 同时输出 GITHUB_OUTPUT / GITHUB_ENV 行
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
const rootDir = join(__dirname, '..');
const buildDir = join(rootDir, 'build');
const platformDir = join(rootDir, 'internal', 'platform');

const isCI = process.argv.includes('--ci');

function git(args) {
    try {
        return execSync(`git ${args}`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    } catch {
        return '';
    }
}

function computeVersion() {
    const describe = git('describe --tags --always --dirty --match "v[0-9]*"');
    if (describe) {
        // 可能形态：v0.8.0 / v0.8.0-dirty / v0.7.9-4-gabc1234 / v0.7.9-4-gabc1234-dirty
        // 注意：CI 在构建前会修改版本模板文件（sed），工作区必然为 dirty，
        // 因此 tag 命中 HEAD 时必须忽略 -dirty，否则会退化成 0.0.0-dev 版本号。
        const dirty = describe.endsWith('-dirty');
        const clean = describe.replace(/-dirty$/, '');
        const v = clean.replace(/^v/, '');
        const m = v.match(/^(\d+\.\d+\.\d+(?:\.\d+)?)(?:-(\d+)-g([0-9a-f]+))?$/);
        if (m) {
            const baseTag = m[1];
            const count = m[2] || '0';
            const sha = m[3] || git('rev-parse --short HEAD') || 'unknown';
            const version = count === '0'
                ? baseTag
                : `${baseTag}-dev.${count}.g${sha}${dirty ? '-dirty' : ''}`;
            return { version, baseTag, count, sha };
        }
    }
    const count = git('rev-list --count HEAD') || '0';
    const sha = git('rev-parse --short HEAD') || 'unknown';
    // 非 git 环境（如源码压缩包）使用稳定的开发版本号
    if (sha === 'unknown') {
        return { version: '0.0.0-dev', baseTag: '0.0.0', count: '0', sha: 'unknown' };
    }
    return {
        version: `0.0.0-dev.${count}.g${sha}`,
        baseTag: '0.0.0',
        count,
        sha,
    };
}

const info = computeVersion();
// 兼容旧构建脚本：仍输出 ldflags 字符串，路径改为新的 platform 包
const ldflags = `-X MusicLite/internal/platform.Version=${info.version} -X MusicLite/internal/platform.BuildSHA=${info.sha} -X MusicLite/internal/platform.BuildNum=${info.count}`;

mkdirSync(buildDir, { recursive: true });
mkdirSync(platformDir, { recursive: true });

// 1. version.txt: 单行版本字符串
writeFileSync(join(buildDir, 'version.txt'), info.version, 'utf8');

// 2. version-set.sh: bash 可 source
writeFileSync(join(buildDir, 'version-set.sh'),
`export VERSION='${info.version}'
export VERSION_BASE='${info.baseTag}'
export BUILD_SHA='${info.sha}'
export BUILD_NUM='${info.count}'
export VERSION_LDFLAGS='${ldflags}'
`, 'utf8');

// 3. version-set.cmd: Windows cmd 可 call
writeFileSync(join(buildDir, 'version-set.cmd'),
`@echo off
set VERSION=${info.version}
set VERSION_BASE=${info.baseTag}
set BUILD_SHA=${info.sha}
set BUILD_NUM=${info.count}
set VERSION_LDFLAGS=${ldflags}
`, 'utf8');

// 4. go:embed 注入文件（三行）
writeFileSync(join(platformDir, 'version.txt'), `${info.version}\n${info.sha}\n${info.count}\n`, 'utf8');

if (isCI && process.env.GITHUB_OUTPUT && process.env.GITHUB_ENV) {
    appendFileSync(process.env.GITHUB_OUTPUT,
        `version=${info.version}\nversion_base=${info.baseTag}\nsha=${info.sha}\ncount=${info.count}\nldflags_extra=${ldflags}\n`);
    appendFileSync(process.env.GITHUB_ENV,
        `VERSION=${info.version}\nVERSION_BASE=${info.baseTag}\nBUILD_SHA=${info.sha}\nBUILD_NUM=${info.count}\nVERSION_LDFLAGS=${ldflags}\n`);
}

console.log(`Version=${info.version} Base=${info.baseTag} BuildSHA=${info.sha} BuildNum=${info.count}`);
