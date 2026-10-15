import { createRequire } from 'node:module';
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import router from '../server/src/routes/index.js';
const require = createRequire(new URL('../client/package.json', import.meta.url));
const { parse } = require('@babel/parser');
const routes = router.stack.filter((layer) => layer.route).map(({ route }) => ({
  path: route.path, methods: route.methods,
  matches: new RegExp(`^${route.path.replace(/:[^/]+/g, '[^/]+')}$`),
}));
const calls = new Map();
function strings(node) {
  if (node?.type === 'StringLiteral') return [node.value];
  if (node?.type === 'TemplateLiteral') return [node.quasis.map((part) => part.value.cooked).join(':value')];
  if (node?.type === 'ConditionalExpression') return [...strings(node.consequent), ...strings(node.alternate)];
  return [];
}
function walk(node, file) {
  if (!node || typeof node !== 'object') return;
  if (node.type === 'CallExpression' && ['apiFetch','fetchWorkspaceData','refresh'].includes(node.callee?.name)) {
    const endpoint = node.arguments[0];
    const methodNode = node.arguments[1]?.properties?.find((property) => property.key?.name === 'method')?.value;
    let pairs;
    if (endpoint?.type === 'ConditionalExpression' && methodNode?.type === 'ConditionalExpression' && endpoint.test.name === methodNode.test.name) {
      pairs = [[endpoint.consequent, methodNode.consequent], [endpoint.alternate, methodNode.alternate]];
    } else pairs = [[endpoint, methodNode]];
    for (const [pathNode, verbNode] of pairs) {
      for (const path of strings(pathNode)) for (const method of strings(verbNode).length ? strings(verbNode) : ['GET']) {
        const key = `${method.toUpperCase()} ${path.split('?')[0]}`;
        calls.set(key, { path: path.split('?')[0], method: method.toLowerCase(), file });
      }
    }
  }
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) value.forEach((child) => walk(child, file));
    else if (value && typeof value === 'object') walk(value, file);
  }
}
async function scan(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = `${directory}/${entry.name}`;
    if (entry.isDirectory()) await scan(path);
    else if (/\.[jt]sx?$/.test(entry.name)) walk(parse(await readFile(path, 'utf8'), { sourceType: 'module', plugins: ['jsx'] }), path);
  }
}
await scan(fileURLToPath(new URL('../client/src', import.meta.url)));
for (const [key, call] of calls) {
  assert.ok(routes.some((route) => route.methods[call.method] && route.matches.test(call.path)), `${key} has no Express route (${call.file})`);
  console.log(`${call.method.toUpperCase()} /api${call.path}`);
}
console.log(`PASS: all ${calls.size} distinct frontend method/path combinations match the Express router mounted at /api.`);
