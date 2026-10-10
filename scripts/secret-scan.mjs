// Blocks commits that contain obvious secrets or private data.
// Usage: node scripts/secret-scan.mjs          (staged files, used by the pre-commit hook)
//        node scripts/secret-scan.mjs --all    (all tracked files)
// Put "secret-scan:allow" on a line to accept a known false positive.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';

const all = process.argv.includes('--all');
const files = execFileSync('git', all ? ['ls-files'] : ['diff', '--cached', '--name-only', '--diff-filter=ACMR'], { encoding: 'utf8' })
  .split('\n').filter(Boolean);

const FORBIDDEN_FILES = [
  /(^|\/)\.env(\.|$)(?!example$)/,
  /(^|\/)data\//,
  /\.(db|sqlite3?|enc|pem|key|p12|har)$/i,
  /(^|\/)vault\.json$/,
  /\.balancer-backup$/,
  /(^|\/)balancer-backup-[^/]*\.json$/,
  /(^|\/)(screenshots|scraper-debug)\//,
];

const PATTERNS = [
  ['private key', /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ['GitHub token', /\b(ghp|gho|ghu|ghs|ghr|github_pat)_[A-Za-z0-9_]{20,}/],
  ['AWS key', /\bAKIA[0-9A-Z]{16}\b/],
  ['Google API key', /\bAIza[0-9A-Za-z_-]{35}\b/],
  ['Slack token', /\bxox[abpors]-[A-Za-z0-9-]{10,}/],
  ['Anthropic/OpenAI key', /\bsk-(ant-)?[A-Za-z0-9_-]{20,}/],
  ['hardcoded password', /\b(password|passwd|userCode|card6Digits)\s*[:=]\s*['"][^'"\s]{6,}['"]/i],
];

// 13-19 digit numbers that pass the Luhn check look like real card numbers
function looksLikeCard(line) {
  for (const m of line.matchAll(/\b(?:\d[ -]?){13,19}\b/g)) {
    const d = m[0].replace(/\D/g, '');
    if (d.length < 13 || /^(\d)\1+$/.test(d)) continue;
    let sum = 0;
    for (let i = 0; i < d.length; i++) {
      let n = +d[d.length - 1 - i];
      if (i % 2) { n *= 2; if (n > 9) n -= 9; }
      sum += n;
    }
    if (sum % 10 === 0) return true;
  }
  return false;
}

const problems = [];
for (const file of files) {
  if (FORBIDDEN_FILES.some(re => re.test(file))) {
    problems.push(`${file}: this kind of file must never be committed`);
    continue;
  }
  if (!fs.existsSync(file) || fs.statSync(file).size > 2_000_000) continue;
  const text = fs.readFileSync(file, 'utf8');
  if (text.includes('\0')) continue; // binary
  text.split('\n').forEach((line, i) => {
    if (line.includes('secret-scan:allow')) return;
    for (const [name, re] of PATTERNS) {
      // tests use fake passwords by design; every other pattern still applies there
      if (name === 'hardcoded password' && file.startsWith('tests/')) continue;
      if (re.test(line)) problems.push(`${file}:${i + 1}: possible ${name}`);
    }
    if (looksLikeCard(line)) problems.push(`${file}:${i + 1}: possible card number`);
  });
}

if (problems.length) {
  console.error('secret-scan: commit blocked\n  ' + problems.join('\n  '));
  console.error('If this is a false positive, add "secret-scan:allow" to that line.');
  process.exit(1);
}
console.log(`secret-scan: ${files.length} file(s) clean`);
