// Exact text edits against one immutable source. Never execute or normalize code.
function check(ok, message) { if (!ok) throw new Error(message); }
function shape(value, allowed, label) {
  check(value && typeof value === 'object' && !Array.isArray(value), label + ': 객체가 필요합니다.');
  check(Object.keys(value).length === allowed.length && allowed.every(key => Object.hasOwn(value, key)), label + ': 필드를 확인하세요.');
}
export const isTextEdit = value => value !== null && typeof value === 'object' && !Array.isArray(value);

export function textEditRanges(source, value, label = '부분편집') {
  check(typeof source === 'string', label + ': 수정할 기존 문자열이 없습니다.');
  shape(value, ['edits'], label);
  check(Array.isArray(value.edits) && value.edits.length > 0 && value.edits.length <= 100, label + ': edits는 1~100개 배열이어야 합니다.');
  const ranges = value.edits.map(edit => {
    shape(edit, ['before', 'after'], label);
    check(typeof edit.before === 'string' && edit.before.length > 0 && typeof edit.after === 'string', label + ': before는 비어 있지 않은 문자열, after는 문자열이어야 합니다.');
    const start = source.indexOf(edit.before);
    check(start !== -1, label + ': 원문과 일치하는 구간이 없습니다. 공백·줄바꿈까지 정확히 복사하세요.');
    check(source.indexOf(edit.before, start + 1) === -1, label + ': 원문이 여러 곳에 일치합니다. 주변 코드를 더 포함하세요.');
    return { start, end: start + edit.before.length, before: edit.before, after: edit.after };
  }).sort((a, b) => a.start - b.start);
  for (let i = 1; i < ranges.length; i++) check(ranges[i].start >= ranges[i - 1].end, label + ': 수정 구간이 겹칩니다. 원문 기준의 겹치지 않는 구간으로 합치세요.');
  return ranges;
}

export function resolveTextValue(source, value, label, existing = true) {
  if (typeof value === 'string') return value;
  check(existing, label + ': 새 항목은 부분편집 대신 완성 문자열을 사용하세요.');
  const ranges = textEditRanges(source, value, label);
  let cursor = 0;
  const parts = [];
  for (const range of ranges) { parts.push(source.slice(cursor, range.start), range.after); cursor = range.end; }
  parts.push(source.slice(cursor));
  return parts.join('');
}

export function textEditPreview(source, value, label) {
  const ranges = textEditRanges(source, value, label);
  const lineCount = text => (text.match(/\r\n|\r|\n/g) ?? []).length;
  const span = text => Math.max(1, text.split(/\r\n|\r|\n/).length - (/\r\n$|[\r\n]$/.test(text) ? 1 : 0));
  let delta = 0;
  return ranges.map(range => {
    const startLine = lineCount(source.slice(0, range.start)) + 1, afterStartLine = startLine + delta;
    delta += lineCount(range.after) - lineCount(range.before);
    return { ...range, label, mode: 'patch', startLine, endLine: startLine + span(range.before) - 1,
      afterStartLine, afterEndLine: afterStartLine + span(range.after) - 1 };
  });
}
