import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { codeWithResultSerializer, computationAudit, COMPUTATION_CONTRACT_VERSION } from './scientific-output-contract.js';

function execute(source, constraints = {}, files = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'power-agent-contract-test-'));
  try {
    for (const [name, contents] of Object.entries(files)) fs.writeFileSync(path.join(directory, name), contents);
    const script = path.join(directory, 'calculation.R');
    fs.writeFileSync(script, codeWithResultSerializer(source, constraints));
    const result = spawnSync(process.env.RSCRIPT_PATH || 'Rscript', ['--vanilla', script], { cwd: directory, encoding: 'utf8', timeout: 30000, maxBuffer: 2000000 });
    assert.ifError(result.error);
    const outputs = result.stdout.split('\n').filter(line => line.startsWith('POWER_AGENT_RESULT='));
    return { ...result, audit: computationAudit(result.stderr), rows: outputs.length === 1 ? JSON.parse(outputs[0].slice('POWER_AGENT_RESULT='.length)).results : null };
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
}
const emit = value => `power_agent_emit(list(power_agent_row("quantity", ${value}, "count")))`;
function accepted(result, rows = 1) {
  assert.equal(result.status, 0, result.stderr); assert.ok(result.audit, result.stderr);
  assert.equal(result.audit.version, COMPUTATION_CONTRACT_VERSION); assert.equal(result.rows.length, rows);
}
function rejected(source, pattern = /literal-only|literal result JSON/) {
  const result = execute(source);
  assert.notEqual(result.status, 0, 'Literal transcription unexpectedly passed');
  assert.match(result.stderr, pattern); assert.equal(result.rows, null);
}

test('R parses function bodies before an optional NULL source-reference argument', () => {
  const result = execute(`x <- as.list(parse(text="function(n) sqrt(n)", keep.source=FALSE)[[1L]])[-1L]; stopifnot(length(x)==3L, is.null(x[[3L]]), identical(x[[2L]], quote(sqrt(n)))); ${emit('length(x)')}`);
  accepted(result); assert.equal(result.rows[0].value, 3);
});

test('fresh minimum grid accepts values extracted from calculated package power', () => {
  const source = `ns<-seq(2,200); power_fn<-function(n) stats::power.t.test(n=n,delta=.4,sd=1,sig.level=.05,type="two.sample",alternative="two.sided",strict=TRUE)$power; powers<-vapply(ns,power_fn,numeric(1)); selected<-ns[which(powers>=.8)[1L]]; power_agent_emit(list(power_agent_row("minimum",selected,"participants per group"),power_agent_row("power",power_fn(selected),"probability"),power_agent_row("previous",power_fn(selected-1L),"probability")))`;
  const result = execute(source); accepted(result, 3);
  assert.ok(result.rows[1].value >= .8 && result.rows[2].value < .8);
});
test('fresh paired calculation accepts a locally aliased function and an explicit computed return', () => {
  const source = `delta<-.36; sd_diff<-sqrt(2*1.2^2*(1-.5)); paired<-function(n){p<-stats::power.t.test(n=n,delta=delta,sd=sd_diff,sig.level=.05,type="paired",alternative="two.sided",strict=TRUE)$power;return(p)}; alias<-paired; grid<-seq(2,300); p<-vapply(grid,alias,numeric(1)); selected<-grid[which(p>=.9)[1L]]; power_agent_emit(list(power_agent_row("minimum",selected,"pairs"),power_agent_row("power",alias(selected),"probability"),power_agent_row("previous",alias(selected-1L),"probability")))`;
  const result = execute(source); accepted(result, 3);
  assert.ok(result.rows[1].value >= .9 && result.rows[2].value < .9);
});
test('computed selection from a literal grid supplies selection lineage', () => {
  const result = execute(`grid<-c(2,4,8); index<-which(sqrt(grid)>1.5)[1L]; chosen<-grid[index]; ${emit('chosen')}`);
  accepted(result); assert.equal(result.rows[0].value, 4); assert.equal(result.audit.computed_or_read_expressions, 1);
});
test('fresh file reads retain read lineage through extraction', () => {
  const result = execute(`captured<-read.csv("captured.csv"); chosen<-captured$n[[1L]]; ${emit('chosen')}`, {}, { 'captured.csv': 'n,power\n44,0.91\n' });
  accepted(result); assert.equal(result.rows[0].value, 44);
});
test('direct literals are rejected', () => rejected(emit('64')));
test('literal scalar aliases are rejected', () => rejected(`literal<-64; a<-literal; b<-a; ${emit('b')}`));
test('constant getters are rejected despite their parsed NULL source reference', () => rejected(`f<-function(n)64; ${emit('f(10)')}`));
test('aliases to local constant getters are rejected', () => rejected(`f<-function(){64}; a<-f; b<-a; ${emit('b()')}`));
test('unrelated arithmetic cannot legitimize a constant function tail', () => rejected(`f<-function(){dummy<-sqrt(2);64}; ${emit('f()')}`));
test('unrelated arithmetic cannot legitimize an explicit constant return', () => rejected(`f<-function(){dummy<-sqrt(2);return(64)}; ${emit('f()')}`));
test('unrelated global calculations cannot legitimize aliased literal rows', () => rejected(`dummy<-sqrt(2); reported<-64; ${emit('reported')}`));
test('literal grid with literal selection remains rejected', () => rejected(`grid<-c(2,4,8); chosen<-grid[2L]; ${emit('chosen')}`));
test('literal JSON cannot bypass row inspection', () => rejected(`dummy<-sqrt(2); cat('POWER_AGENT_RESULT={"results":[{"metric":"quantity","value":64,"unit":"count"}]}')`));
test('ambiguous early-return control flow is labeled unresolved, not certified as computed', () => {
  const result = execute(`f<-function(n){if(n<0)return(64);sqrt(n)}; ${emit('f(4)')}`);
  accepted(result); assert.equal(result.audit.unresolved_expressions, 1); assert.equal(result.audit.computed_or_read_expressions, 0);
});
const strictConstraints = { power_t_test_strict: true, strict_two_sided: true };
const packagePower = options => `value<-stats::power.t.test(n=20,delta=.5,sd=1,sig.level=.05,type="two.sample"${options})$power; ${emit('value')}`;
test('explicit strict two-sided package options retain the existing request gate', () => {
  const result = execute(packagePower(',alternative="two.sided",strict=TRUE'), strictConstraints);
  accepted(result); assert.equal(result.audit.explicit_method_option_calls, 1);
});
test('missing or contradictory strict options still fail before calculation', () => {
  for (const options of [',alternative="two.sided"', ',alternative="two.sided",strict=FALSE']) {
    const result = execute(packagePower(options), strictConstraints); assert.notEqual(result.status, 0); assert.match(result.stderr, /explicitly use.*strict/);
  }
});
test('wrong alternative still fails the strict two-sided request gate', () => {
  const result = execute(packagePower(',alternative="one.sided",strict=TRUE'), strictConstraints);
  assert.notEqual(result.status, 0); assert.match(result.stderr, /alternative = 'two.sided'/);
});
