import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {mkdir, mkdtemp, rm, symlink, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {fileURLToPath} from 'node:url';
import {promisify} from 'node:util';
import {discoverCodingSkills} from '../scripts/coding-skills.mjs';

test('coding preflight ranks trusted skills, rejects symlinks and supplies a pinned manifest before launch', async () => {
  const base = await mkdtemp(join(tmpdir(), 'kapron-skill-test-'));
  const worktree = join(base, 'repo');
  const trusted = join(base, 'trusted');
  async function skill(root, name, description, body) {
    const folder = join(root, name);
    await mkdir(folder, {recursive: true});
    await writeFile(join(folder, 'SKILL.md'), `---\nname: ${name}\ndescription: >\n  ${description}\n---\n${body}\n`);
  }
  try {
    const directory = join(worktree, '.agents', 'skills');
    await skill(directory, 'sql', 'SQLite migration verification', 'Repository version');
    await skill(directory, 'query', 'SQLite query analysis', 'Project candidate');
    await skill(trusted, 'sql', 'SQLite migration contract', 'Trusted version');
    await skill(trusted, 'style', 'Format CSS layouts', 'Irrelevant');
    await symlink(join(trusted, 'style'), join(directory, 'escape'), 'dir');
    const options={worktree,task:'SQLite migration',trustedRoots:[trusted]};
    const found=await discoverCodingSkills({...options,policy:'auto'});
    assert.deepEqual(found.selected.map(item=>item.name),['sql']);
    assert.deepEqual(found.candidates.filter(item=>item.name==='sql').map(item=>item.reason),['selected','lower precedence']);
    assert.equal(found.candidates.find(item=>item.name==='query').reason,'untrusted');
    assert.equal(found.candidates.filter(item=>item.name==='style').length,1);
    assert.match(found.selected[0].instructions,/Trusted version/);
    assert.match(found.selected[0].sha256,/^[a-f0-9]{64}$/);
    assert.deepEqual((await discoverCodingSkills({...options,policy:'suggest'})).selected,[]);
    assert.deepEqual((await discoverCodingSkills({...options,policy:'off'})).candidates,[]);
    assert.deepEqual((await discoverCodingSkills({...options,policy:'auto',trustProject:true})).selected.map(item=>item.name),['sql','query']);
    await assert.rejects(discoverCodingSkills({...options,selected:['query']}),/trusted scope/);

    const script=fileURLToPath(new URL('../scripts/coding-skills.mjs',import.meta.url));
    const {stdout}=await promisify(execFile)(process.execPath,[script,'--repo',worktree,'--task',options.task,'--mode','auto','--trusted-root',trusted,
      '--',process.execPath,'--input-type=module','-e',"import { readFileSync } from 'node:fs'; console.log(readFileSync(process.env.KAPRON_SKILL_MANIFEST, 'utf8'));"]);
    const dispatched=JSON.parse(stdout);
    assert.equal(dispatched.worktree,worktree);
    assert.equal(dispatched.selected[0].sha256,found.selected[0].sha256);
  } finally { await rm(base,{recursive:true,force:true}); }
});
