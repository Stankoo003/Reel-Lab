import { query } from "@/lib/handler";

/**
 * The page a reset link opens: tries to hand the token to the app, and can finish the reset
 * itself for a recipient without the app. The same hand-written HTML the Spring
 * ResetPageController served, as a route handler so the headers are ours: the token is in this
 * page's URL, and no cache or crawler should keep it.
 */
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const safe = escape(query(req).get("token") ?? "");
  const html = PAGE.replace(/__TOKEN__/g, safe);
  return new Response(html, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
      "X-Robots-Tag": "noindex, nofollow",
    },
  });
}

/** The token goes into an attribute and a JS string; anything that could close either is neutralised. */
function escape(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

const PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>Reset your ReelLab password</title>
<style>
  :root { color-scheme: light dark; }
  body { margin:0; min-height:100vh; display:grid; place-items:center;
         font:15px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;
         background:#0E0E10; color:#F7F7F9; }
  .card { width:min(420px,90vw); padding:28px; border-radius:16px;
          background:#141416; border:1px solid rgba(255,255,255,0.08); }
  h1 { font-size:19px; margin:0 0 6px; }
  p.sub { margin:0 0 20px; color:rgba(255,255,255,0.55); font-size:13px; }
  label { display:block; font:11px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace;
          letter-spacing:.08em; color:rgba(255,255,255,0.42); margin-bottom:6px; }
  input { width:100%; box-sizing:border-box; padding:12px 13px; border-radius:10px;
          background:rgba(255,255,255,0.04); color:#F7F7F9;
          border:1px solid rgba(255,255,255,0.14); font-size:15px; }
  button { width:100%; margin-top:16px; padding:14px; border:0; border-radius:12px;
           background:#4C8DF6; color:#fff; font-size:15px; font-weight:600; }
  button[disabled] { opacity:.5; }
  .msg { margin-top:14px; font-size:13px; }
  .err { color:#FF8A80; }
  .ok  { color:#7BDCB5; }
  .app { display:block; margin-top:18px; text-align:center; font-size:13px;
         color:#4C8DF6; text-decoration:none; }
</style>
</head>
<body>
<main class="card">
  <h1>Choose a new password</h1>
  <p class="sub">The link you followed works once, and only for a little while.</p>

  <form id="f">
    <label for="p">NEW PASSWORD</label>
    <input id="p" type="password" autocomplete="new-password" minlength="8" required>
    <button id="b" type="submit">Change password</button>
  </form>

  <p class="msg" id="m"></p>
  <a class="app" href="reellab://reset-password?token=__TOKEN__">Open in the ReelLab app</a>
</main>
<script>
  var token = "__TOKEN__";
  var f = document.getElementById('f');
  var m = document.getElementById('m');
  var b = document.getElementById('b');
  if (!token) {
    f.style.display = 'none';
    m.className = 'msg err';
    m.textContent = 'This link is missing its token. Ask for a new reset email.';
  }
  f.addEventListener('submit', function (e) {
    e.preventDefault();
    b.disabled = true;
    m.className = 'msg';
    m.textContent = 'Working…';
    fetch('/api/auth/password/reset', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: token, newPassword: document.getElementById('p').value })
    }).then(function (r) {
      return r.json().then(function (body) { return { ok: r.ok, body: body }; });
    }).then(function (res) {
      if (res.ok) {
        f.style.display = 'none';
        m.className = 'msg ok';
        m.textContent = 'Done. Sign in with your new password.';
      } else {
        b.disabled = false;
        m.className = 'msg err';
        m.textContent = res.body.detail || 'That did not work.';
      }
    }).catch(function () {
      b.disabled = false;
      m.className = 'msg err';
      m.textContent = 'Could not reach the server. Try again.';
    });
  });
</script>
</body>
</html>
`;
