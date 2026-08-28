/**
 * Shared browser JS interpolated into dashboard, agent window, and main-grid HTML.
 * AUTH_TOKEN must already be defined in the page script. Query param is `token=`.
 * apiJson also sends Authorization: Bearer when AUTH_TOKEN is set.
 */
export function clientApiJavaScript(): string {
  return `
      function withToken(path){
        if(!AUTH_TOKEN){ return path; }
        const glue = path.includes('?') ? '&' : '?';
        return path + glue + 'token=' + encodeURIComponent(AUTH_TOKEN);
      }
      async function apiJson(path, options){
        const opts = options && typeof options === "object" ? options : {};
        const headers = Object.assign({}, opts.headers || {});
        if(AUTH_TOKEN){
          headers.Authorization = "Bearer " + AUTH_TOKEN;
        }
        const res = await fetch(withToken(path), Object.assign({}, opts, { headers }));
        const text = await res.text();
        let data = null;
        try { data = text ? JSON.parse(text) : null; } catch (e) {
          return { ok: false, error: "non-json " + res.status, status: res.status, raw: text.slice(0, 200) };
        }
        if (!res.ok) {
          const err = (data && (data.error || data.message)) ? (data.error || data.message) : ("HTTP " + res.status);
          return { ok: false, error: err, status: res.status, ...data };
        }
        return data && typeof data === "object" ? data : { ok: true, data: data };
      }
  `;
}
