import { describe, expect, it } from 'vitest';
import { acceptedBuildTimeFindings, licenseAllowed, licenseFindings, licenseRows, maskEmail, scanHistoryPath, scanPath, scanText, scanTree, treeFiles, type LockPackage } from '../scripts/release-check';

// 16.3 公开前检查。这里测两件事：规则本身能抓到东西（全部用内存样例，样例里的危险串都是拼出来的，免得这个文件自己被扫出命中），
// 以及当前仓库（已追踪 + 未追踪但没被忽略的文件）扫出来是空的。历史、许可证和私密词清单由 `npm run release:check` 另行检查。

const join = (...parts: string[]) => parts.join('');

describe('release-check：规则自检（内存样例）', () => {
  it('抓到本机绝对路径', () => {
    for (const text of [join('/Us', 'ers/someone/project'), join('/ho', 'me/someone/project'), join('C:\\Us', 'ers\\someone\\x'), join('file:', '///tmp/x')]) {
      expect(scanText('a.md', `see ${text} here`).map((f) => f.rule), text).toContain('本机绝对路径');
    }
    expect(scanText('a.md', 'a relative ./src/main.tsx and /assets/x.png')).toEqual([]);
  });

  it('抓到密钥与口令，且不把内容原样打出来', () => {
    const samples: [string, string][] = [
      [join('-----BEGIN RSA PRIV', 'ATE KEY-----'), '私钥'],
      [join('gh', 'p_', 'a'.repeat(30)), 'GitHub 令牌'],
      [join('AK', 'IA', 'A'.repeat(16)), 'AWS 访问密钥'],
      [join('s', 'k-', 'b'.repeat(24)), '通用 API 密钥'],
      [join('pass', 'word = "', 'hunter2hunter2', '"'), '口令赋值'],
      [join('https://user:', 'pw1234', '@host.example/x'), '带口令的地址'],
    ];
    for (const [text, rule] of samples) {
      const found = scanText('a.ts', `x ${text} y`);
      expect(found.map((f) => f.rule), rule).toContain(rule);
      expect(found.every((f) => !f.detail.includes('hunter2') && !f.detail.includes('pw1234')), `${rule}: detail`).toBe(true);
    }
    expect(scanText('a.md', 'the password field and an api key are described here')).toEqual([]);
  });

  it('抓到邮箱并打码；示例域名不算', () => {
    const real = join('someone', '@', 'mail', '.test-host.net');
    const hits = scanText('a.md', `contact ${real}`);
    expect(hits.map((f) => f.rule)).toEqual(['邮箱']);
    expect(hits[0]!.detail).toBe('s***@mail.test-host.net');
    expect(maskEmail(real)).toBe('s***@mail.test-host.net');
    for (const ok of ['a@example.com', 'b@example.org', 'c@localhost', 'd@users.noreply.github.com']) expect(scanText('a.md', ok), ok).toEqual([]);
  });

  it('抓到私密词（大小写不敏感），词来自运行时清单，不写在仓库里', () => {
    expect(scanText('a.md', 'Hello Wanderer', ['wanderer']).map((f) => f.rule)).toEqual(['私密词']);
    expect(scanText('a.md', 'Hello', ['wanderer'])).toEqual([]);
    expect(scanPath('docs/wanderer-notes.md', ['wanderer']).map((f) => f.rule)).toEqual(['私密词']);
  });

  it('抓到参考图、未登记的图片与被追踪的本地输入目录', () => {
    expect(scanPath('public/assets/dollhouse/1x/lobby.png')).toEqual([]);
    expect(scanPath('docs/screenshots/house-en.png')).toEqual([]);
    expect(scanPath('assets/photo.png').map((f) => f.rule)).toEqual(['未登记的图片']);
    expect(scanPath('docs/screenshots/reference-sheet.png').map((f) => f.rule)).toContain('疑似参考图或概念稿');
    expect(scanPath('.local-inputs/lantern-source-1024x1536.png').map((f) => f.rule)).toEqual(expect.arrayContaining(['本地输入目录被追踪', '未登记的图片']));
    expect(scanPath('src/main.tsx')).toEqual([]);
  });

  it('历史路径只为 GitHub Pages 的已登记旧宅图片放行根目录形态', () => {
    expect(scanHistoryPath('assets/dollhouse/1x/lobby.png', false)).toEqual([]);
    expect(scanHistoryPath('assets/other/lobby.png', false).map((f) => f.rule)).toContain('未登记的图片');
    expect(scanHistoryPath('assets/dollhouse/private-name.png', false, ['private-name']).map((f) => f.rule)).toContain('私密词');
    expect(scanPath('assets/dollhouse/1x/lobby.png').map((f) => f.rule)).toContain('未登记的图片');
  });

  it('二进制文件只按路径查', () => {
    expect(scanTree([{ path: 'public/assets/dollhouse/1x/lobby.png', text: null }])).toEqual([]);
  });
});

describe('release-check：许可证规则', () => {
  it('只允许 MIT、ISC、Apache-2.0、BSD 类；OR 取任一，AND 要求全部', () => {
    for (const ok of ['MIT', 'ISC', 'Apache-2.0', 'BSD-2-Clause', 'BSD-3-Clause', '0BSD', '(MIT OR CC0-1.0)', 'MIT OR GPL-3.0-only', '(BSD-2-Clause AND MIT)']) expect(licenseAllowed(ok), ok).toBe(true);
    for (const bad of ['MPL-2.0', 'CC-BY-4.0', 'GPL-3.0-only', 'LGPL-2.1', 'AGPL-3.0', 'UNLICENSED', '?', '', '(MIT AND GPL-3.0-only)']) expect(licenseAllowed(bad), bad).toBe(false);
  });

  it('区分会随页面发布的与只在构建时用的，并报出不在范围内的', () => {
    const lock: { packages: Record<string, LockPackage> } = {
      packages: {
        '': {},
        'node_modules/preact': { version: '1.0.0' },
        'node_modules/tool': { version: '2.0.0', dev: true },
        'node_modules/tool/node_modules/data': { version: '3.0.0', dev: true, license: 'CC-BY-4.0' },
        'node_modules/native-x': { version: '4.0.0', dev: true, optional: true, license: 'MPL-2.0' },
      },
    };
    const installed: Record<string, string> = { 'node_modules/preact': 'MIT', 'node_modules/tool': 'ISC' };
    const rows = licenseRows(lock, (key) => installed[key] ?? null);
    expect(rows.find((r) => r.name === 'preact')).toMatchObject({ license: 'MIT', shipped: true, installed: true });
    expect(rows.find((r) => r.name === 'data')).toMatchObject({ license: 'CC-BY-4.0', shipped: false, installed: false });
    const findings = licenseFindings(rows);
    expect(findings.map((f) => f.where)).toEqual(['data@3.0.0', 'native-x@4.0.0']);
    expect(findings[1]!.detail).toContain('可选的平台包');
  });

  // 下面几项从真实的锁文件结构（LockPackage）出发，经过 licenseRows 分类，再进规则，不手工拼 LicenseRow 绕过分类。
  const lockOf = (packages: Record<string, LockPackage>) => ({ packages: { '': {}, ...packages } });
  const classify = (packages: Record<string, LockPackage>) => {
    const rows = licenseRows(lockOf(packages), () => null);
    return { rows, accepted: acceptedBuildTimeFindings(rows).map((f) => f.where).sort(), rejected: licenseFindings(rows).map((f) => f.where).sort() };
  };

  it('锁文件分类：只有明确 dev:true 才算构建专用；optional 不代表不发布', () => {
    const { rows } = classify({
      'node_modules/a': { version: '1.0.0', license: 'MIT' },
      'node_modules/b': { version: '1.0.0', license: 'MIT', dev: false },
      'node_modules/c': { version: '1.0.0', license: 'MIT', optional: true },
      'node_modules/d': { version: '1.0.0', license: 'MIT', optional: true, dev: false },
      'node_modules/e': { version: '1.0.0', license: 'MIT', dev: true },
      'node_modules/f': { version: '1.0.0', license: 'MIT', dev: true, optional: true },
    });
    expect(Object.fromEntries(rows.map((r) => [r.name, r.shipped]))).toEqual({ a: true, b: true, c: true, d: true, e: false, f: false });
    expect(rows.find((r) => r.name === 'c')!.optional).toBe(true);
  });

  it('仅构建时的 lightningcss(MPL-2.0) 与 caniuse-lite(CC-BY-4.0)（锁文件里明确 dev:true，含 optional 的平台包）被单独列为已接受', () => {
    const r = classify({
      'node_modules/lightningcss': { version: '1.0.0', license: 'MPL-2.0', dev: true },
      'node_modules/lightningcss-darwin-arm64': { version: '1.0.0', license: 'MPL-2.0', dev: true, optional: true },
      'node_modules/caniuse-lite': { version: '1.0.0', license: 'CC-BY-4.0', dev: true },
    });
    expect(r.accepted).toEqual(['caniuse-lite@1.0.0', 'lightningcss-darwin-arm64@1.0.0', 'lightningcss@1.0.0'].sort());
    expect(r.rejected).toEqual([]);
  });

  it('optional:true 但 dev 缺省或为 false 的同名包算会发布，不能被构建专用的例外放过', () => {
    const r = classify({
      'node_modules/lightningcss': { version: '1.0.0', license: 'MPL-2.0', optional: true },
      'node_modules/lightningcss-darwin-arm64': { version: '1.0.0', license: 'MPL-2.0', optional: true, dev: false },
      'node_modules/caniuse-lite': { version: '1.0.0', license: 'CC-BY-4.0', dev: false },
      'node_modules/lightningcss-linux-x64': { version: '1.0.0', license: 'MPL-2.0' },
    });
    expect(r.accepted).toEqual([]);
    expect(r.rejected).toEqual(['caniuse-lite@1.0.0', 'lightningcss-darwin-arm64@1.0.0', 'lightningcss-linux-x64@1.0.0', 'lightningcss@1.0.0'].sort());
  });

  it('许可证变了（即使名字和 dev:true 不变）、或是别的包，仍然拒绝', () => {
    const r = classify({
      'node_modules/lightningcss': { version: '1.0.0', license: 'GPL-3.0-only', dev: true },
      'node_modules/caniuse-lite': { version: '1.0.0', license: 'CC-BY-SA-4.0', dev: true },
      'node_modules/other-mpl': { version: '1.0.0', license: 'MPL-2.0', dev: true },
      'node_modules/caniuse-lite-fork': { version: '1.0.0', license: 'CC-BY-4.0', dev: true },
    });
    expect(r.accepted).toEqual([]);
    expect(r.rejected).toEqual(['caniuse-lite-fork@1.0.0', 'caniuse-lite@1.0.0', 'lightningcss@1.0.0', 'other-mpl@1.0.0'].sort());
  });
});

describe('release-check：当前仓库', () => {
  it('已追踪与未追踪（未被忽略）的文件里没有本机路径、密钥、真实邮箱、参考图或 .local-inputs', () => {
    const files = treeFiles();
    expect(files.length).toBeGreaterThan(100);
    expect(scanTree(files)).toEqual([]);
  });
});
