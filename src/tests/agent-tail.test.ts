import test from 'node:test';
import assert from 'node:assert/strict';
import { clearAgentTail, pushAgentTail, readAgentTail } from '../lib/agent/use-agent-tail';

test('增量按序号只进不退，运行结束就清掉', () => {
  pushAgentTail('run', 2, '甲乙');
  pushAgentTail('run', 1, '甲');
  assert.equal(readAgentTail('run'), '甲乙');
  pushAgentTail('run', 3, '甲乙丙');
  assert.equal(readAgentTail('run'), '甲乙丙');
  clearAgentTail('run');
  assert.equal(readAgentTail('run'), '');
});
