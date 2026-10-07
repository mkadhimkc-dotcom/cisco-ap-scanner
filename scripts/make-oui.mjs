// Builds site/data/oui-cisco.json: the IEEE MA-L prefixes registered to Cisco Systems and Cisco Meraki,
// from the pinned oui-data package. Used only for an "unusual OUI" hint; it never blocks a value.
import { readFileSync, writeFileSync } from 'node:fs';
const root = new URL('..', import.meta.url).pathname;
const all = JSON.parse(readFileSync(root + 'node_modules/oui-data/index.json', 'utf8'));
const version = JSON.parse(readFileSync(root + 'node_modules/oui-data/package.json', 'utf8')).version;
const out = { source: `oui-data ${version} (IEEE MA-L registry)`, cisco: [], meraki: [] };
for (const [prefix, org] of Object.entries(all)) {
  const name = org.split('\n')[0].trim();
  if (/^Cisco Meraki/i.test(name)) out.meraki.push(prefix);
  else if (/^Cisco Systems,? Inc/i.test(name)) out.cisco.push(prefix);
}
out.cisco.sort(); out.meraki.sort();
writeFileSync(root + 'site/data/oui-cisco.json', JSON.stringify(out));
console.log(`cisco ${out.cisco.length}, meraki ${out.meraki.length} -> site/data/oui-cisco.json`);
