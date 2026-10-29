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

export function reviewCandidates(source, before) {
  const result = [], seen = new Set();
  const add = (start, end, kind, score = 1) => {
    const key = start + ':' + end;
    if (start >= 0 && end > start && !seen.has(key)) {
      seen.add(key); result.push({ start, end, kind, score });
    }
  };
  let at = source.indexOf(before);
  while (before && at >= 0 && result.length < 50) {
    add(at, at + before.length, '정확히 일치'); at = source.indexOf(before, at + 1);
  }
  if (result.length) return result;
  const keep = /[A-Za-z0-9\p{Script=Hangul}]/u;
  const normalize = text => [...text].filter(c => keep.test(c)).join('');
  const needle = normalize(before), positions = [];
  let normalized = '', offset = 0;
  for (const c of source) {
    if (keep.test(c)) { normalized += c; positions.push(offset); }
    offset += c.length;
  }
  if (needle.length >= 6) {
    at = normalized.indexOf(needle);
    while (at >= 0 && result.length < 50) {
      let start = positions[at], end = positions[at + needle.length - 1] + 1;
      // Include transformed edge punctuation when the requested block had it;
      // leave surrounding whitespace and line separators outside the replacement.
      if (before.length && !keep.test(before[0]) && !/\s/.test(before[0])) while (start > 0 && !keep.test(source[start - 1]) && !/\s/.test(source[start - 1])) start--;
      if (before.length && !keep.test(before.at(-1)) && !/\s/.test(before.at(-1))) while (end < source.length && !keep.test(source[end]) && !/\s/.test(source[end])) end++;
      add(start, end, '공백·기호 차이');
      at = normalized.indexOf(needle, at + 1);
    }
  }
  if (result.length) return result;
  const grams = text => {
    const s = normalize(text), set = new Set();
    for (let i = 0; i < s.length - 1; i++) set.add(s.slice(i, i + 2));
    return set;
  };
  const target = grams(before), lines = [], re = /[^\r\n]+(?:\r\n|\r|\n|$)/g;
  let match;
  while ((match = re.exec(source))) lines.push({ start: match.index, end: re.lastIndex });
  const span = Math.min(12, Math.max(1, before.split(/\r\n|\r|\n/).length));
  for (let i = 0; i < lines.length; i++) {
    for (const size of new Set([1, span, Math.min(12, span + 1)])) {
      const end = lines[Math.min(lines.length - 1, i + size - 1)].end;
      const slice = source.slice(lines[i].start, end).replace(/[\r\n]+$/, '');
      if (slice.length > Math.max(4096, before.length * 4)) continue;
      const other = grams(slice);
      let common = 0; for (const g of target) if (other.has(g)) common++;
      const score = 2 * common / Math.max(1, target.size + other.size);
      if (score >= .3) add(lines[i].start, lines[i].start + slice.length, '유사 문장 · 직접 확인 필요', score);
    }
  }
  return result.sort((a, b) => b.score - a.score).slice(0, 8);
}
export async function reviewTextValue(source, value, label, choose) {
  if (!isTextEdit(value) || typeof source !== 'string') return value;
  // Validate the complete edit structure before offering any approximate match.
  shape(value, ['edits'], label);
  check(Array.isArray(value.edits) && value.edits.length > 0 && value.edits.length <= 100, 'edits는 1~100개여야 합니다.');
  for (const edit of value.edits) {
    shape(edit, ['before', 'after'], label);
    check(typeof edit.before === 'string' && edit.before.length > 0 && typeof edit.after === 'string', 'before/after 형식 오류');
  }
  try { textEditRanges(source, value, label); return value; } catch {}
  const ranges = [];
  for (const edit of value.edits) {
    const candidates = reviewCandidates(source, edit.before);
    let selected;
    if (candidates.length === 1 && candidates[0].kind === '정확히 일치') selected = { ...candidates[0], after: edit.after };
    else selected = await choose({ source, edit, label, candidates });
    if (selected) {
      check(Number.isInteger(selected.start) && Number.isInteger(selected.end) && selected.start >= 0 && selected.end > selected.start && selected.end <= source.length && typeof selected.after === 'string', '선택 구간이 올바르지 않습니다.');
      ranges.push(selected);
    }
  }
  ranges.sort((a, b) => a.start - b.start);
  for (let i = 1; i < ranges.length; i++) check(ranges[i].start >= ranges[i - 1].end, '선택한 수정 구간이 겹칩니다. 더 넓은 한 구간으로 직접 수정해 주세요.');
  let result = source;
  for (const range of ranges.slice().reverse()) result = result.slice(0, range.start) + range.after + result.slice(range.end);
  return result;
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
