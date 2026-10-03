import { html } from "hono/html";

/** The return origin is checked against APP_ORIGINS before this page is rendered. */
export function loginPage(
  returnTo: string,
  options: { local: boolean; google: boolean; github: boolean },
) {
  return html`
    <!doctype html>
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1" />
        <title>Workbench sign in</title>
        <style>
          body {
            font: 16px system-ui;
            max-width: 24rem;
            margin: 10vh auto;
            padding: 1rem;
          }
          label {
            display: block;
            margin: 1rem 0;
          }
          input {
            display: block;
            box-sizing: border-box;
            width: 100%;
            padding: 0.6rem;
          }
          button {
            padding: 0.6rem;
            margin-right: 0.5rem;
          }
          #error {
            color: crimson;
          }
        </style>
      </head>
      <body>
        <h1>Sign in to Workbench</h1>
        <p>One account for Reader and Spaced.</p>
        <form>
          <input
            type="hidden"
            name="returnTo"
            value="${returnTo}"
          />
          <label
            >Email<input name="email" type="email" autocomplete="username" required
          /></label>
          <label
            >Password<input
              name="password"
              type="password"
              autocomplete="current-password"
              minlength="8"
              required
          /></label>
          <button name="action" value="sign-in">Sign in</button>
          ${options.local ? html`<button name="action" value="sign-up">Create local account</button>` : ""} ${options.google ? html`<button type="button" data-provider="google">Continue with Google</button>` : ""}
          ${options.github ? html`<button type="button" data-provider="github">Continue with GitHub</button>` : ""}
          <p id="error" role="alert"></p>
        </form>
        <script>
          document.querySelectorAll("[data-provider]").forEach((button) => {
            button.addEventListener("click", async () => {
              button.disabled = true;
              try {
                const returnTo = document.querySelector('[name="returnTo"]').value;
                const response = await fetch("/api/auth/sign-in/social", {
                  method: "POST",
                  credentials: "include",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    provider: button.dataset.provider,
                    callbackURL: returnTo,
                  }),
                });
                const result = await response.json();
                if (!response.ok || !result.url)
                  throw new Error(result.message || "Sign in failed");
                location.assign(result.url);
              } catch (error) {
                document.querySelector("#error").textContent = error.message;
                button.disabled = false;
              }
            });
          });
          document
            .querySelector("form")
            .addEventListener("submit", async (event) => {
              event.preventDefault();
              const form = event.currentTarget,
                fields = new FormData(form),
                buttons = form.querySelectorAll("button");
              const action = event.submitter.value;
              buttons.forEach((button) => (button.disabled = true));
              document.querySelector("#error").textContent = "";
              try {
                const email = fields.get("email");
                const response = await fetch("/api/auth/" + action + "/email", {
                  method: "POST",
                  credentials: "include",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    email,
                    password: fields.get("password"),
                    name: email.split("@")[0],
                  }),
                });
                const result = await response.json();
                if (!response.ok)
                  throw new Error(result.message || "Sign in failed");
                location.assign(fields.get("returnTo"));
              } catch (error) {
                document.querySelector("#error").textContent = error.message;
              } finally {
                buttons.forEach((button) => (button.disabled = false));
              }
            });
        </script>
      </body>
    </html>
  `;
}
