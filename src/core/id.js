let counter = 0;

export function nextId(prefix = 'n') {
  counter += 1;
  return `${prefix}-${counter}-${Math.random().toString(36).slice(2, 7)}`;
}
