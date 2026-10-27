// SPDX-License-Identifier: GPL-3.0-only
// Adapted from RisuBard promptV2.ts and util.ts, commit e5412a4878ae3a0073ffce8e06aed8f288dd9c53.
// Upstream: https://github.com/rpaddict/RisuBard ; copyright upstream contributors.
// Pure block-condition/toggle adapters; no Svelte store or host mutation.

export function parseToggleSyntax(template) {
  const parsed = [];
  for (const line of template.split('\n')) {
    const [key, value, type, option] = line.replace(/\r$/, '').split('=');
    if (['group', 'groupEnd', 'divider'].includes(type)) parsed.push({ key, value, type });
    else if (type === 'caption' && value) parsed.push({ key, value, type });
    else if (key && value) parsed.push({ key, value, type: ['select', 'text', 'textarea'].includes(type) ? type : 'switch', options: option?.split(',') ?? [] });
  }
  return parsed;
}
export function parseToggleTree(template) {
  const items = [], definitions = [], stack = [];
  const target = () => stack.at(-1)?.children ?? items;
  for (const toggle of parseToggleSyntax(template)) {
    if (toggle.type === 'group') { const g = { type: 'group', label: toggle.value ?? '', children: [] }; target().push(g); stack.push(g); }
    else if (toggle.type === 'groupEnd') stack.pop();
    else if (['caption', 'divider'].includes(toggle.type)) target().push({ type: toggle.type, label: toggle.value ?? '' });
    else {
      const definition = { ...toggle, key: 'toggle_' + toggle.key, rawKey: toggle.key, label: toggle.value, group: stack.at(-1)?.label };
      definitions.push(definition); target().push({ type: 'toggle', definition });
    }
  }
  return { items, definitions };
}
export const toggleDefault = definition => ['text', 'textarea'].includes(definition.type) ? '' : '0';
const ops = { is: 'equal', isnot: 'notequal', greater: 'greater', greaterequal: 'greater_equal', less: 'less', lessequal: 'less_equal' };
const safeArg = value => typeof value === 'string' && value.length > 0 && !/[{}\r\n]/.test(value) && !value.includes('::');
export function compileV2(body, activation) {
  if (!activation?.conditions.length) return body;
  if (!['and', 'or'].includes(activation.join)) throw new Error('조건 결합은 and/or여야 합니다.');
  const expression = activation.conditions.map(c => {
    if (!safeArg(c.key) || !safeArg(c.value) || !ops[c.operator]) throw new Error('조건 키·값에는 중괄호·줄바꿈·::를 사용할 수 없습니다.');
    return '{{' + ops[c.operator] + '::{{getglobalvar::' + c.key + '}}::' + c.value + '}}';
  }).join('::' + activation.join + '::');
  return '{{#when::keep::' + expression + '}}\n' + body + '\n{{/when}}';
}
export function parseV2(source) {
  const wrapper = source.match(/^\{\{#when::keep::(.+)\}\}\r?\n([\s\S]*)\r?\n\{\{\/when\}\}$/);
  if (!wrapper) return { body: source, activation: null };
  const comparison = /\{\{(equal|notequal|greater|greater_equal|less|less_equal)::\{\{getglobalvar::([^{}\r\n]+)\}\}::([^{}\r\n]+)\}\}/y;
  const conditions = [], joins = []; let cursor = 0;
  while (cursor < wrapper[1].length) {
    comparison.lastIndex = cursor; const m = comparison.exec(wrapper[1]);
    if (!m) return { body: source, activation: null };
    conditions.push({ key: m[2], operator: Object.keys(ops).find(k => ops[k] === m[1]), value: m[3] }); cursor = comparison.lastIndex;
    if (cursor === wrapper[1].length) break;
    const separator = wrapper[1].slice(cursor).match(/^::(and|or)::/);
    if (!separator) return { body: source, activation: null };
    joins.push(separator[1]); cursor += separator[0].length;
  }
  if (!conditions.length || joins.some(j => j !== joins[0])) return { body: source, activation: null };
  return { body: wrapper[2], activation: { join: joins[0] ?? 'and', conditions } };
}
