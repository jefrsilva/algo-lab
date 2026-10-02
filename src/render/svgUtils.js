const SVG_NS = 'http://www.w3.org/2000/svg';

export function svgEl(tag, attrs = {}) {
  const el = document.createElementNS(SVG_NS, tag);
  Object.entries(attrs).forEach(([key, value]) => {
    if (value !== undefined && value !== null) el.setAttribute(key, value);
  });
  return el;
}

export { SVG_NS };
