# Facebook setup for a staged (test only) release

This is the walkthrough for putting Tap Rush in front of a handful of testers
without touching production. Nothing here publishes the game to the public
Facebook app directory.

The Meta UI moves around fairly often. The steps below describe where each
setting lives rather than exact pixel positions; if a label has changed, the
setting it refers to is named in **bold**.

---

## 1. The app

The app already exists. Two values from it are needed by the backend:

| Value      | Where to find it                    | Used for                         |
| ---------- | ----------------------------------- | -------------------------------- |
| App ID     | App Settings -> Basic -> App ID     | `FB_APP_ID`                      |
| App Secret | App Settings -> Basic -> App Secret | `FB_APP_SECRET`, never commit it |

The secret is the only thing that proves a signature came from Facebook. Keep
it in the deployment environment and nowhere else.

## 2. Turn on the Instant Games product

1. Open the app in the [Meta for Developers dashboard](https://developers.facebook.com/).
2. Add the **Instant Games** product if it is not there yet.
3. Open **Instant Games -> Settings -> Basic**.
4. Fill in the basics: the game name, the category and the description.
5. Under **Data access**, make sure the app is allowed to use the
   **Instant Games** player and the basic profile fields the platform
   provides.

## 3. Switch the connection to Zero Permissions

This is the step that is easy to miss and impossible to ignore later.

1. Go to **Settings -> Network Connection Settings**.
2. Select **Zero Permissions** (the platform may call it _Network Enabled
   Zero Permissions_, _NEZP_ or _Zero Permissions_).
3. Save.

Under Zero Permissions the game gets no access to the player's name, photo,
friends list or friends' data. That is why Tap Rush runs its own leaderboard
and invents its own display names.

> Games that are still on the old standard connection stop working. The
> switch off was on 30 September 2026.

## 4. Allow the backend domain

The game calls our API from inside a Facebook iframe, which is a cross origin
request. The domain has to be on the allowlist or the browser blocks it
before it ever reaches the server.

1. Go to **Instant Games -> Settings -> Content Security Policy**.
2. Add the API domain to the connect sources, for example:

   ```
   connect-src https://your-api.vercel.app
   ```

3. Save.

Only the exact host is needed. Do not add a path.

The API also has its own allowlist, on the server side, in `CORS_ORIGINS`.
The default list covers the hosts Facebook serves the game from:

```
https://apps.facebook.com
https://www.facebook.com
https://web.facebook.com
https://m.facebook.com
https://messenger.com
```

If the game is served from another host, add it to `CORS_ORIGINS` as well.

## 5. Platform version and orientation

The bundle declares its own configuration in `fbapp-config.json`:

```json
{
  "instant_games": {
    "platform_version": "8.0",
    "orientation": "portrait",
    "navigation_menu_version": "NAV_BAR"
  }
}
```

- `platform_version` has to be `8.0`. Older versions are rejected.
- `orientation` is `portrait`, which matches the game.
- `navigation_menu_version` is required by the upload validator. `NAV_BAR` is
  the only version the platform currently supports: a fixed top bar above the
  game container. Leaving the property out fails the upload with
  **"Must specify property 'navigation_menu_version' in bundle config"**.

In the dashboard, **Instant Games -> Settings -> Client Settings** should
show the same platform version.

## 5b. The SDK reference

`index.html` loads the Instant Games SDK from Meta's CDN:

```html
<script src="https://connect.facebook.net/en_US/fbinstant.8.0.js"></script>
```

The upload validator rejects a bundle that does not reference a supported SDK
this way, with **"Must Reference SDK via CDN"**. The version in the URL has
to match `platform_version` in `fbapp-config.json`.

The script is a plain blocking script in the head, so `FBInstant` exists
before the game module runs. If the SDK fails to load, the game keeps working
offline and says so on the menu.

## 6. Build and upload the bundle

```bash
VITE_API_BASE_URL=https://your-api.vercel.app npm run build:game
npm run bundle:fb
```

That produces `dist/tap-rush.zip`. The zip contains `index.html` at its root,
which is what the platform expects.

1. Open **Instant Games -> Build** in the dashboard.
2. Upload `dist/tap-rush.zip`.
3. Wait for the processing to finish.

Every upload needs a new zip, even when only the backend URL changed, because
the API URL is baked into the bundle.

## 7. Keep it staged

The game must not become publicly available while it is being tested.

1. Under **Roles -> Testers**, add the accounts that should be able to play.
   Testers only see the game when they are logged in as one of those
   accounts, and they see it in a private tab in the app.
2. Leave the app in **development mode**. Do not switch on the public
   availability toggle.
3. Under **Settings -> Basic -> Privacy Policy** and the other mandatory
   fields, fill in placeholders that are good enough for a staged test.

A tester plays the game through the app, or through the
`apps.facebook.com` Instant Games entry point.

## 8. Verify the whole loop

With a tester account:

1. Open the game. The menu should show the default name `RUSH xxxx`.
2. Play a round. The score is shown on the game over screen.
3. The leaderboard sheet should show the score. If it says the leaderboard is
   unavailable, the request is being blocked: check the content security
   policy first, then the CORS allowlist, then that `FB_APP_SECRET` matches
   the app that is running the game.
4. `GET https://your-api.vercel.app/api/health` should report `"ok": true`
   and `"store": "postgres"`.

If the game loads but every score is refused, the signature check is the thing
to look at. The server logs `Rejected signed player info: <code>` with one of
`bad_signature`, `request_payload_mismatch`, `signature_expired`,
`player_not_in_payload` or `malformed_payload`. `docs/architecture.md`
explains what each of them means.

## 9. Before anything goes public

Not part of the staged release, but worth writing down now:

- Replace the placeholder privacy policy with a real one.
- Decide on a data deletion path for the leaderboard data.
- Switch the connection settings away from Zero Permissions if the game ever
  needs the player's name.
- Review the AI disclosure setting: Tap Rush generates no media, so it stays
  unset.
