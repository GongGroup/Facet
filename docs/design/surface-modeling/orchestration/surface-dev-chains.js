export const meta = {
  name: 'surface-dev-chains',
  description: 'Implement surface-modeling tasks in isolated worktrees, verify each chain independently, fix findings',
  phases: [
    { title: 'Develop', detail: 'one agent per task; tasks of a chain run in sequence in its worktree' },
    { title: 'Verify', detail: 'independent check of each chain against spec, ledger and tests' },
    { title: 'Fix', detail: 'apply blocker and major findings' },
  ],
}

const S = '/tmp/claude-0/-home-user-crystallume/f118e1c6-ea51-5594-ad44-3edbe2cba708/scratchpad'
const D = S + '/design'
const HANDBOOK = D + '/dev-handbook.md'
const A = args || {}
const chains = A.chains || []
const LEDGERS = [D + '/ledger-F0.md'].concat(A.extraLedgers || [])

const DEV_SCHEMA = {
  type: 'object',
  properties: {
    commit: { type: 'string', description: 'final commit sha on the task branch' },
    summary: { type: 'string' },
    filesChanged: { type: 'array', items: { type: 'string' } },
    tests: { type: 'string', description: 'what was run and the result, e.g. "pytest: 231 passed; node --test: 48 passed"' },
    decisions: { type: 'array', items: { type: 'string' } },
    outOfScopeEdits: { type: 'array', items: { type: 'string' } },
    notDone: { type: 'array', items: { type: 'string' }, description: 'spec items left out, with the reason' },
  },
  required: ['commit', 'summary', 'tests'],
}
const VERIFY_SCHEMA = {
  type: 'object',
  properties: {
    verdict: { type: 'string', enum: ['pass', 'fix'] },
    testsRun: { type: 'string' },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          severity: { type: 'string', enum: ['blocker', 'major', 'minor'] },
          file: { type: 'string' },
          problem: { type: 'string' },
          fix: { type: 'string' },
        },
        required: ['severity', 'problem', 'fix'],
      },
    },
  },
  required: ['verdict', 'findings'],
}

const others = (chain) => [chains.filter(c => c.id !== chain.id)
  .map(c => `${c.id} (${c.tasks.map(t => t.id).join(' -> ')}; files: ${c.files})`).join('; '), A.external || '']
  .filter(Boolean).join('; ')

const common = (chain) => `You are a developer on the Crystallume surface-modeling team. READ FIRST: ${HANDBOOK} (environment, rules, commit format).
Sub-wave ${A.subwave}. Your worktree: ${chain.worktree} on branch ${chain.branch} (the sub-wave started from commit ${A.base}).${chain.port ? ` Your port for browser checks: ${chain.port}.` : ''}
Binding sources: the brief ${D}/00-architecture.md (section U = user decisions, highest priority), the ledgers ${LEDGERS.join(', ')} (where a ledger differs from a spec, the ledger wins: read its section 0 and every entry your task touches), and the spec sections cited in your task.
Already merged into the base before this sub-wave: ${A.merged || 'nothing yet (this is the first batch)'}.
Tasks running at the same time in other worktrees (do NOT edit their files): ${others(chain) || 'none'}.`

async function runChain(chain) {
  const reports = []
  for (const task of chain.tasks) {
    const prior = reports.map(r => r.id).join(', ')
    const r = await agent(`${common(chain)}
${prior ? `Earlier tasks in THIS worktree, already committed by colleagues (build on them, do not redo them): ${prior}.` : ''}
YOUR TASK ${task.id}: ${task.title}
${task.brief}
Deliver the complete task: every "must" item of the cited spec sections and ledger entries, the tests they specify (Python tests, JS tests run with node --test and through the pytest bridge once it exists, shared golden cases), and nothing outside the task. Run the whole Python suite and all node tests from the worktree root; everything must pass before you commit. Commit on ${chain.branch}, then return the structured report.`,
      { label: `dev:${task.id}`, phase: 'Develop', schema: DEV_SCHEMA })
    reports.push({ id: task.id, ...(r || { error: 'no result' }) })
  }
  const verify = await agent(`${common(chain)}
You are an INDEPENDENT REVIEWER, not the developer. Chain ${chain.id} implemented these tasks in ${chain.worktree} (branch ${chain.branch}):
${chain.tasks.map(t => `- ${t.id}: ${t.title}\n  ${t.brief}`).join('\n')}
Developer reports: ${JSON.stringify(reports).slice(0, 6000)}
Review the commits and the diff (git -C ${chain.worktree} log ${A.base}..HEAD; git -C ${chain.worktree} diff ${A.base}..HEAD) against the cited spec sections and ledger entries. Check: every must item present and behaving as specified; names and signatures exactly as the ledger fixes them; Python/JS parity (run the parity tests and add quick probes of your own under ${S}/proto/verify/${chain.id}/); compliance with U1-U6; tests that really test the behaviour (not vacuous); edge cases and error messages; no stray files; no edits to other tasks' files beyond minimal ones; no model names or identifiers in code, comments or docs. Run the full Python suite and the node tests yourself in the worktree.${chain.port ? ` For the UI parts, start the app from the worktree on port ${chain.port} and check it in Chromium with Playwright (screenshots for yourself only), including the browser console for errors.` : ''}
Do not edit any file. Verdict "fix" if there is at least one blocker or major finding.`,
    { label: `verify:${chain.id}`, phase: 'Verify', schema: VERIFY_SCHEMA })
  let fix = null
  const serious = (verify?.findings || []).filter(f => f.severity !== 'minor')
  if (verify && verify.verdict === 'fix' && serious.length) {
    fix = await agent(`${common(chain)}
TASK: apply the review findings below to the work in ${chain.worktree} (branch ${chain.branch}). Verify each finding first; reviewers can be wrong. Fix every real blocker and major finding, and the minor ones that are cheap and clearly right. Add or adjust tests so each fixed problem is covered. Run the whole Python suite and all node tests; everything must pass. Commit on ${chain.branch}.
Findings: ${JSON.stringify(verify.findings)}
Return a short report: what you fixed, what you rejected and why, the final commit sha and the test results.`,
      { label: `fix:${chain.id}`, phase: 'Fix' })
  }
  return { id: chain.id, branch: chain.branch, worktree: chain.worktree, reports, verify, fix }
}

const results = await parallel(chains.map(c => () => runChain(c)))
return results
