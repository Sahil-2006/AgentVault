let csrf = '';
export function setCsrf(value: string) { csrf = value; }
export async function api<T = any>(path: string, options: { method?: string; body?: unknown } = {}): Promise<T> {
  const response = await fetch(`/api${path}`, { method: options.method || 'GET', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', ...(csrf ? { 'X-CSRF-Token': csrf } : {}) }, ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}) });
  const data = await response.json().catch(() => ({ error: 'The server returned an unexpected response.' }));
  if (!response.ok) throw new Error(data.error || 'Request failed.');
  if (data.csrf) setCsrf(data.csrf);
  return data;
}
export const money = (cents: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100);
export const amount = (value: string) => { if (!/^\d+(\.\d{1,2})?$/.test(value)) throw new Error('Enter a positive amount with up to two decimal places.'); const [d, c = ''] = value.split('.'); return Number(d) * 100 + Number(c.padEnd(2, '0')); };
export function downloadCsv(name: string, rows: (string | number)[][]) {
  const csv = rows.map(row => row.map(value => { let text = String(value); if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`; return `"${text.replaceAll('"', '""')}"`; }).join(',')).join('\r\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' })); const a = document.createElement('a'); a.href = url; a.download = name; a.click(); URL.revokeObjectURL(url);
}
