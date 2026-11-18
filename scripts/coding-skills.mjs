import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {constants} from 'node:fs';
import {lstat, mkdtemp, open, readdir, realpath, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {basename, isAbsolute, join, relative, resolve, sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseArgs} from 'node:util';

const projectRoots = ['.agents/skills', '.claude/skills', '.codex/skills', '.cursor/skills'];
const skillName = /^[a-z0-9][a-z0-9-]{0,63}$/;
const maxSkillBytes = 64 * 1024;
const ignored = new Set(['and','the','with','this','that','from','into','using','work','use','task','skill','help','when','for']);

async function directory(path) {
  try { return (await lstat(path)).isDirectory(); }
  catch (error) { if (error.code === 'ENOENT') return false; throw error; }
}

async function readSkill(path) {
  const stat = await lstat(path);
  if (!stat.isFile() || stat.size > maxSkillBytes) return null;
  const file = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
  try {
    const opened = await file.stat();
    if (!opened.isFile() || opened.dev !== stat.dev || opened.ino !== stat.ino || await realpath(path) !== path) return null;
    const buffer = Buffer.alloc(maxSkillBytes + 1);
    let size = 0;
    while (size < buffer.length) {
      const {bytesRead} = await file.read(buffer, size, buffer.length - size, size);
      if (!bytesRead) break;
      size += bytesRead;
    }
    if (size > maxSkillBytes) return null;
    const bytes = buffer.subarray(0, size);
    const text = new TextDecoder('utf-8', {fatal: true}).decode(bytes);
    const header = text.match(/^---\r?\n([\s\S]+?)\r?\n---(?:\r?\n|$)/)?.[1];
    if (!header) return null;
    const name = header.match(/^name:\s*([^\r\n]+)$/m)?.[1].trim().replace(/^['"]|['"]$/g, '');
    if (!skillName.test(name ?? '')) return null;
    const desc = header.match(/^description:[ \t]*(.*)(?:\r?\n((?:[ \t]+[^\r\n]+(?:\r?\n|$))*))?/m);
    const description = (desc?.[1]?.trim().match(/^[|>][-+]?$/) ? desc[2] : desc?.[1])?.trim().replace(/\s+/g, ' ').replace(/^['"]|['"]$/g, '').slice(0, 1000) ?? '';
    return {name, description, sha256: createHash('sha256').update(bytes).digest('hex'), text};
  } finally { await file.close(); }
}

function terms(value) {
  return new Set((value.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? []).filter(term => !ignored.has(term)));
}

export async function discoverCodingSkills({worktree, task = '', policy = 'suggest', trustedRoots = [], trustProject = false, selected = []}) {
  if (!['off', 'suggest', 'auto'].includes(policy)) throw new Error('Use the off, suggest or auto skill policy.');
  if (policy === 'off' && selected.length) throw new Error('The off policy cannot select skills.');
  const root = await realpath(worktree);
  const manifest = {version: 1, policy, worktree: root, candidates: [], selected: []};
  if (policy === 'off') return manifest;
  if (trustedRoots.length > 16) throw new Error('Configure up to 16 trusted skill roots.');
  const sources = [];
  for (const path of trustedRoots) {
    if (!isAbsolute(path) || !await directory(path)) throw new Error('Trusted roots must be absolute directories.');
    sources.push({path: await realpath(path), trusted: true});
  }
  for (const name of projectRoots) {
    const path = join(root, name);
    if (await directory(join(root, name.split('/')[0])) && await directory(path) && await realpath(path) === path) {
      sources.push({path, trusted: trustProject});
    }
  }

  const candidates = new Map();
  const duplicates = [];
  const query = terms(task);
  for (const source of sources) {
    const entries = (await readdir(source.path, {withFileTypes: true})).filter(item => item.isDirectory() && skillName.test(item.name));
    entries.sort((a,b) => a.name.localeCompare(b.name, 'en'));
    for (const entry of entries.slice(0, 128)) {
      const path = join(source.path, entry.name, 'SKILL.md');
      try {
        if (await realpath(path) !== path) continue;
        const skill = await readSkill(path);
        if (!skill) continue;
        const words = terms(skill.name + ' ' + skill.description);
        const score = [...query].filter(term => words.has(term)).length;
        const candidate = {...skill, score, trusted: source.trusted, path};
        if (candidates.has(skill.name)) duplicates.push(candidate);
        else candidates.set(skill.name, candidate);
      } catch (error) {
        if (!['ENOENT', 'ELOOP', 'ENOTDIR', 'ERR_ENCODING_INVALID_ENCODED_DATA'].includes(error.code)) throw error;
      }
    }
  }
  const ranked = [...candidates.values()].sort((a,b) => b.score-a.score || a.name.localeCompare(b.name,'en'));
  const matched = selected.length ? [...new Set(selected)].map(name => {
    const candidate = candidates.get(name);
    if (!candidate?.trusted) throw new Error('Selected skill is missing or outside a trusted scope: ' + name);
    return candidate;
  }) : policy === 'auto' ? ranked.filter(candidate => candidate.trusted && candidate.score > 0).slice(0, 5) : [];
  if (matched.length > 12) throw new Error('Select up to 12 skills for a coding run.');
  const picked = new Set(matched.map(item => item.name));
  const display = ({text, ...entry}, reason) => {
    const location = relative(root, entry.path);
    return {...entry, path: location.startsWith('..' + sep) || isAbsolute(location) ? entry.path : location, reason};
  };
  manifest.candidates = [...ranked.map(entry => display(entry,
    picked.has(entry.name) ? 'selected' : !entry.trusted ? 'untrusted' : !entry.score ? 'no task match' : 'available')),
    ...duplicates.map(entry => display(entry, 'lower precedence'))];
  manifest.selected = matched.map(entry => ({...display(entry, 'selected'), instructions: entry.text}));
  return manifest;
}

async function main() {
  const args = process.argv.slice(2);
  const split = args.indexOf('--');
  const {values} = parseArgs({args: split < 0 ? args : args.slice(0, split), options: {
    repo: {type: 'string', default: process.cwd()}, task: {type: 'string', default: ''},
    mode: {type: 'string', default: 'suggest'}, 'trusted-root': {type: 'string', multiple: true},
    'trust-project': {type: 'boolean'}, select: {type: 'string', multiple: true}
  }});
  const manifest = await discoverCodingSkills({worktree: resolve(values.repo), task: values.task, policy: values.mode,
    trustedRoots: values['trusted-root'], trustProject: values['trust-project'], selected: values.select});
  if (split < 0) {
    const selected = manifest.selected.map(({instructions, ...skill}) => skill);
    console.log(JSON.stringify({...manifest, selected}, null, 2));
    return;
  }
  const [program, ...programArgs] = args.slice(split + 1);
  if (!program) throw new Error('Supply a coding-agent executable after --.');
  const folder = await mkdtemp(join(tmpdir(), 'kapron-coding-'));
  const path = join(folder, 'skill-manifest.json');
  try {
    await writeFile(path, JSON.stringify(manifest), {mode: 0o600, flag: 'wx'});
    const exitCode = await new Promise((done, fail) => {
      const child = spawn(program, programArgs, {cwd: manifest.worktree, stdio: 'inherit',
        env: {...process.env, KAPRON_SKILL_MANIFEST: path}});
      child.once('error', fail);
      child.once('exit', (code, signal) => done(signal ? 1 : code));
    });
    process.exitCode = exitCode;
  } finally { await rm(folder, {recursive: true, force: true}); }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main().catch(error => {console.error(basename(process.argv[1]) + ': ' + error.message);process.exitCode=1;});
}
