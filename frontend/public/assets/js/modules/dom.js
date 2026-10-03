// Utilidades de DOM y formato. Todo el contenido dinámico se inserta como texto
// (textContent / atributos), nunca como HTML, para evitar XSS.

const SVG_NS = 'http://www.w3.org/2000/svg';

export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === false || value === null || value === undefined) continue;
    if (key === 'class') el.className = value;
    else if (key === 'dataset') Object.assign(el.dataset, value);
    else if (key.startsWith('on') && typeof value === 'function') el.addEventListener(key.slice(2), value);
    else el.setAttribute(key, value === true ? '' : String(value));
  }
  el.append(...children.flat().filter((c) => c !== null && c !== undefined && c !== false));
  return el;
}

export function icon(name, extraClass = '') {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', `icon ${extraClass}`.trim());
  svg.setAttribute('aria-hidden', 'true');
  const use = document.createElementNS(SVG_NS, 'use');
  use.setAttribute('href', `#i-${name}`);
  svg.append(use);
  return svg;
}

let seq = 0;
export const uid = (prefix) => `${prefix}-${Date.now().toString(36)}-${(seq++).toString(36)}`;

const LOCALE = 'es-CR';

const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
export const formatMoney = (n) => money.format(Number(n) || 0);

const colones = new Intl.NumberFormat(LOCALE, { style: 'currency', currency: 'CRC', maximumFractionDigits: 0 });
export const formatPrice = (n, moneda = 'USD') => (moneda === 'CRC' ? colones.format(Number(n) || 0) : formatMoney(n));

const dayFmt = new Intl.DateTimeFormat(LOCALE, { day: 'numeric', month: 'short' });
const timeFmt = new Intl.DateTimeFormat(LOCALE, { hour: 'numeric', minute: '2-digit', hour12: true });
const longFmt = new Intl.DateTimeFormat(LOCALE, { day: 'numeric', month: 'long', year: 'numeric' });
const monthFmt = new Intl.DateTimeFormat(LOCALE, { month: 'long', year: 'numeric' });

export const parseDate = (value) => {
  if (!value) return null;
  const d = new Date(value.length === 10 ? `${value}T00:00` : value);
  return Number.isNaN(d.getTime()) ? null : d;
};

const clean = (s) => s.replace(/\./g, '').replace(/\s+/g, ' ');
const spaces = (s) => s.replace(/\s+/g, ' ');

export function formatDayTime(value) {
  const d = parseDate(value);
  if (!d) return '';
  const nb = (s) => s.replace(/\s/g, ' '); // espacio no separable: la fecha solo se parte en el «·»
  return `${nb(clean(dayFmt.format(d)))} · ${nb(spaces(timeFmt.format(d)))}`;
}

export function formatDay(value) {
  const d = parseDate(value);
  return d ? clean(dayFmt.format(d)) : '';
}

export function formatLongDate(value) {
  const d = parseDate(value);
  return d ? longFmt.format(d) : '';
}

export function formatMonth(year, monthIndex) {
  const label = monthFmt.format(new Date(year, monthIndex, 1)).replace(' de ', ' ');
  return label.charAt(0).toUpperCase() + label.slice(1);
}

export const initials = (name) =>
  name.trim().split(/\s+/).slice(0, 2).map((p) => p[0]?.toUpperCase() ?? '').join('');

export const normalize = (s) =>
  String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
