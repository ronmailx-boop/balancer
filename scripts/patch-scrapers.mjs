// Local fixes to israeli-bank-scrapers-core, re-applied after every install (npm postinstall).
// Max: a plan name the library does not know (e.g. "העברה לסל מצטבר") throws and fails the whole
// sync. Treat unknown plans as normal charges instead. Idempotent.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const file = path.join(root, 'node_modules/israeli-bank-scrapers-core/lib/scrapers/max.js');
const MARK = '/* balancer-patch: unknown plan -> normal */';
const FROM = 'throw new Error(`Unknown transaction type ${cleanedUpTxnTypeStr}`);';
const TO = `${MARK} return _transactions2.TransactionTypes.Normal;`;

if (!fs.existsSync(file)) {
  console.log('patch-scrapers: library not installed, skipping');
} else {
  const src = fs.readFileSync(file, 'utf8');
  if (src.includes(MARK)) console.log('patch-scrapers: max already patched');
  else if (src.includes(FROM)) {
    fs.writeFileSync(file, src.replace(FROM, TO));
    console.log('patch-scrapers: max patched');
  } else {
    console.warn('patch-scrapers: WARNING - max.js changed upstream, patch not applied');
  }
}
