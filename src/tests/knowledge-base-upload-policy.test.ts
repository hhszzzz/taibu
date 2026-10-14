import test from 'node:test';
import assert from 'node:assert/strict';
import {
  KNOWLEDGE_FILE_ACCEPT,
  KNOWLEDGE_FILE_HINT,
  KNOWLEDGE_FILE_MAX_BYTES,
  validateKnowledgeFile,
} from '../lib/knowledge-base/upload-policy';

const file = (name: string, type: string, size: number) => ({ name, type, size });

test('knowledge files accept text MIME types and fall back to the extension when the MIME is blank', () => {
  assert.equal(validateKnowledgeFile(file('notes.txt', 'text/plain', 12)), null);
  assert.equal(validateKnowledgeFile(file('table.csv', 'text/csv', 12)), null);
  assert.equal(validateKnowledgeFile(file('cases.json', 'application/json', 12)), null);
  // 多数浏览器给 .md 的 MIME 是空字符串。
  assert.equal(validateKnowledgeFile(file('滴天髓摘录.MD', '', 12)), null);
  assert.equal(validateKnowledgeFile(file('readme.markdown', '', 12)), null);
});

test('knowledge files reject binary formats the server cannot read as text', () => {
  const message = '只支持 .txt、.md、.csv、.json 等纯文本文件';
  assert.equal(validateKnowledgeFile(file('scan.pdf', 'application/pdf', 12)), message);
  assert.equal(validateKnowledgeFile(file('report.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 12)), message);
  assert.equal(validateKnowledgeFile(file('photo.png', 'image/png', 12)), message);
});

test('knowledge files must be non-empty and at most 5MB', () => {
  assert.equal(KNOWLEDGE_FILE_MAX_BYTES, 5 * 1024 * 1024);
  assert.equal(validateKnowledgeFile(file('empty.txt', 'text/plain', 0)), '文件内容为空');
  assert.equal(validateKnowledgeFile(file('edge.txt', 'text/plain', KNOWLEDGE_FILE_MAX_BYTES)), null);
  assert.equal(validateKnowledgeFile(file('big.txt', 'text/plain', KNOWLEDGE_FILE_MAX_BYTES + 1)), '文件不能超过 5MB');
});

test('the picker filter and the visible hint describe the same rule as the validator', () => {
  assert.equal(KNOWLEDGE_FILE_ACCEPT, 'text/*,application/json,.txt,.md,.markdown,.csv,.json');
  assert.equal(KNOWLEDGE_FILE_HINT, '支持 .txt、.md、.csv、.json 等纯文本文件，单个文件不超过 5MB');
  assert.doesNotMatch(KNOWLEDGE_FILE_HINT, /pdf|10MB/iu);
});
