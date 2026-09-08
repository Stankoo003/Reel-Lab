package dev.reellab.server.web;

import java.nio.charset.StandardCharsets;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * The page a reset link opens.
 *
 * <p>Why the email links here rather than straight to {@code reellab://reset-password}: a
 * custom scheme in an email is a dead link for everyone who does not have the app. Mail
 * clients often refuse to make it clickable at all, and a recipient reading on a laptop has
 * nothing to open it with. An https link always works, and this page then does two things:
 * it tries to hand the token to the app, and it can finish the reset itself if there is no
 * app to hand it to.
 *
 * <p>Served by the API rather than by a separate site because it is one page whose only job
 * is to call this API — a second deployment for it would be more moving parts than the
 * feature has.
 *
 * <p>Hand-written HTML, no template engine: adding Thymeleaf for one page would put a
 * rendering stack in a service that has none.
 */
@RestController
public class ResetPageController {

    @GetMapping(value = "/reset", produces = MediaType.TEXT_HTML_VALUE)
    public ResponseEntity<byte[]> page(@RequestParam(required = false) String token) {
        String safe = escape(token == null ? "" : token);
        String html = PAGE.replace("__TOKEN__", safe);
        return ResponseEntity.ok()
                // The token is in the URL of this page. Telling every cache and crawler not
                // to keep it is the least this can do about that.
                .header("Cache-Control", "no-store")
                .header("Referrer-Policy", "no-referrer")
                .contentType(MediaType.TEXT_HTML)
                .body(html.getBytes(StandardCharsets.UTF_8));
    }

    /**
     * The token is put into an HTML attribute and a JS string, so anything that could close
     * either has to stop being itself first. The generator only ever produces base64url, so
     * this defends against a hand-typed URL rather than against our own tokens.
     */
    private static String escape(String value) {
        return value.replace("&", "&amp;")
                .replace("<", "&lt;")
                .replace(">", "&gt;")
                .replace("\"", "&quot;")
                .replace("'", "&#39;");
    }

    private static final String PAGE = """
            <!doctype html>
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
            """;
}
