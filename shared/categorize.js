// Deterministic, local categorization. User rules beat system rules, then higher priority,
// then exact before contains before regex, then the longer (more specific) pattern.
const TYPE_RANK = { exact: 3, contains: 2, regex: 1 };

export function normalizeText(s = '') {
  return s.normalize('NFC').toUpperCase().replace(/\s+/g, ' ').trim();
}

export function sortRules(rules) {
  return [...rules].sort((a, b) =>
    (b.created_by === 'user') - (a.created_by === 'user')
    || (b.priority || 0) - (a.priority || 0)
    || TYPE_RANK[b.match_type] - TYPE_RANK[a.match_type]
    || b.pattern.length - a.pattern.length);
}

export function ruleMatches(rule, description) {
  const text = normalizeText(description);
  const pattern = normalizeText(rule.pattern);
  if (!pattern) return false;
  switch (rule.match_type) {
    case 'exact': return text === pattern;
    case 'contains': return text.includes(pattern);
    case 'regex':
      try { return new RegExp(rule.pattern, 'iu').test(description); } catch { return false; }
    default: return false;
  }
}

// rules must already be sorted with sortRules()
export function categorize(description, sortedRules) {
  for (const r of sortedRules) if (ruleMatches(r, description)) return r.category_id;
  return null;
}
