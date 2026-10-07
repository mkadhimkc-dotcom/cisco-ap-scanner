// Builds the fake-camera feeds (test/fixtures/*.y4m) from the fixture photos with ffmpeg.
import { mkdirSync, rmSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const root = new URL('..', import.meta.url).pathname;
const fx = root + 'test/fixtures/';
// photo, label centre (x, y) and source width cut for a 1920x1080 frame
// ap: 1x zoom framing (~1.85 px per module, the Phase 1 acceptance feed); switch: the app's default ~1.75x zoom
// framing of the whole label stack (~2.3 px per module)
const feeds = [['ap', 2050, 1150, 3900], ['switch', 2030, 1320, 2900]];
for (const [name, cx, cy, sw] of feeds) {
  const out = `${fx}${name}.y4m`;
  if (existsSync(out) && !process.argv.includes('--force')) { console.log('exists', out); continue; }
  const tmp = `${fx}.build/${name}-frames`;
  rmSync(tmp, { recursive: true, force: true }); mkdirSync(tmp, { recursive: true });
  execFileSync('python3', [root + 'scripts/make_frames.py', `${fx}${name}.jpg`, tmp, String(cx), String(cy), String(sw)], { stdio: 'inherit' });
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', '10', '-i', `${tmp}/f%03d.png`, '-pix_fmt', 'yuv420p', out], { stdio: 'inherit' });
  console.log('wrote', out);
}
