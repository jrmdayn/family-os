/**
 * The few pages sign-in needs, until the web app (M5) exists:
 *
 *   /          who is signed in, with a link to sign in or out
 *   /sign-in   "Sign in with Google"; the OAuth server sends Claude's sign-in here
 *   /consent   "Allow Claude to use Family OS?", after signing in through Claude
 *
 * The OAuth server sends the browser here with a signed query (`sig`). The
 * pages pass that query back to better-auth as `oauth_query`, which then
 * carries on with the authorization and sends the browser back to Claude.
 *
 * Nothing from the request is written into the HTML: the scripts read the
 * query and talk to better-auth's JSON endpoints, and show what they get
 * with `textContent`.
 */
import * as HttpServerResponse from "effect/http/HttpServerResponse";

const page = (title: string, body: string, script: string) =>
  HttpServerResponse.html(
    `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${title} · Family OS</title>
<style>
  :root { color-scheme: light dark; --fg: #1f2328; --bg: #f6f7f9; --card: #fff; --muted: #59636e; --accent: #1d4ed8; }
  @media (prefers-color-scheme: dark) { :root { --fg: #e6e8eb; --bg: #0f1115; --card: #181b21; --muted: #9aa4af; --accent: #7aa2ff; } }
  * { box-sizing: border-box; }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 16px;
    font: 16px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; color: var(--fg); background: var(--bg); }
  main { width: 100%; max-width: 380px; background: var(--card); border-radius: 12px; padding: 28px 24px;
    box-shadow: 0 1px 3px rgb(0 0 0 / 0.12); }
  h1 { font-size: 1.25rem; margin: 0 0 8px; }
  p { margin: 0 0 20px; color: var(--muted); }
  button { width: 100%; font: inherit; font-weight: 600; padding: 12px; border-radius: 8px; cursor: pointer;
    border: 1px solid var(--accent); background: var(--accent); color: #fff; }
  button.secondary { background: transparent; color: var(--fg); border-color: var(--muted); margin-top: 10px; }
  button:disabled { opacity: 0.6; cursor: default; }
  .error { color: #d1242f; margin: 16px 0 0; }
  .error:empty { display: none; }
</style>
</head>
<body>
<main>
${body}
<p class="error" id="error" role="alert"></p>
</main>
<script>
const errorBox = document.getElementById("error");
const fail = (message) => { errorBox.textContent = message; document.querySelectorAll("button").forEach((b) => (b.disabled = false)); };
/** The query the OAuth server signed: only the signed parameters, as better-auth expects them back. */
const signedQuery = () => {
  const params = new URLSearchParams(location.search);
  if (!params.has("sig")) return undefined;
  const signed = new Set(params.getAll("ba_param"));
  const kept = new URLSearchParams();
  for (const [key, value] of params) if (key === "sig" || key === "ba_param" || signed.has(key)) kept.append(key, value);
  return kept.toString();
};
const post = async (path, body) => {
  const response = await fetch("/api/auth" + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(json.message || json.error_description || "Something went wrong (" + response.status + ").");
  return json;
};
${script}
</script>
</body>
</html>`,
  ).pipe(
    HttpServerResponse.setHeaders({
      "cache-control": "no-store",
      "content-security-policy":
        "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; form-action 'none'; frame-ancestors 'none'; base-uri 'none'",
      "referrer-policy": "no-referrer",
    }),
  );

/** `/sign-in`: sends the browser to Google, then back to the OAuth flow or to `/`. */
export const signInPage = page(
  "Sign in",
  `<h1>Family OS</h1>
<p>Sign in with the Google account of an owner of this household.</p>
<button id="google">Sign in with Google</button>`,
  `document.getElementById("google").addEventListener("click", async (event) => {
  event.currentTarget.disabled = true;
  try {
    const oauthQuery = signedQuery();
    const { url } = await post("/sign-in/social", {
      provider: "google",
      callbackURL: "/",
      errorCallbackURL: "/sign-in",
      ...(oauthQuery ? { oauth_query: oauthQuery } : {}),
    });
    location.href = url;
  } catch (error) { fail(error.message); }
});
const params = new URLSearchParams(location.search);
if (params.get("error") === "unable_to_create_user") fail("This Google account is not an owner of this household.");
else if (params.has("error")) fail("Sign-in failed: " + params.get("error"));`,
);

/** `/consent`: the owner allows (or not) the client that sent them here, usually Claude. */
export const consentPage = page(
  "Allow access",
  `<h1>Allow access?</h1>
<p><strong id="client">An app</strong> wants to read and change your Family OS: sitters, shifts and payouts.</p>
<button id="allow">Allow</button>
<button id="deny" class="secondary">Deny</button>`,
  `const params = new URLSearchParams(location.search);
fetch("/api/auth/oauth2/public-client?client_id=" + encodeURIComponent(params.get("client_id") || ""))
  .then((response) => (response.ok ? response.json() : {}))
  .then((client) => { if (client.client_name) document.getElementById("client").textContent = client.client_name; })
  .catch(() => {});
const answer = (accept) => async () => {
  document.querySelectorAll("button").forEach((b) => (b.disabled = true));
  try {
    const { url } = await post("/oauth2/consent", { accept, oauth_query: signedQuery() });
    location.href = url;
  } catch (error) { fail(error.message); }
};
document.getElementById("allow").addEventListener("click", answer(true));
document.getElementById("deny").addEventListener("click", answer(false));`,
);

/** `/`: who is signed in. The web app replaces it in M5. */
export const homePage = page(
  "Home",
  `<h1>Family OS</h1>
<p id="who">Checking who is signed in…</p>
<button id="action" hidden></button>`,
  `const who = document.getElementById("who");
const action = document.getElementById("action");
fetch("/api/auth/get-session").then((response) => response.json()).then((session) => {
  action.hidden = false;
  if (session && session.user) {
    who.textContent = "Signed in as " + session.user.email + ". Claude connects through /mcp.";
    action.textContent = "Sign out";
    action.addEventListener("click", () => post("/sign-out", {}).then(() => location.reload(), (error) => fail(error.message)));
  } else {
    who.textContent = "Not signed in.";
    action.textContent = "Sign in";
    action.addEventListener("click", () => (location.href = "/sign-in"));
  }
}).catch(() => (who.textContent = "Could not reach the server."));`,
);
