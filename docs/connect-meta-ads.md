# Connect Meta Ads

Meta's Ads MCP server (`https://mcp.facebook.com/ads`) lets no new app register itself for sign-in (OAuth dynamic client
registration): it answers `Dynamic registration is not available for this client`. An app other than Meta's own listed
clients signs in with **its own Meta developer app** ([Meta's guide](https://developers.facebook.com/documentation/ads-commerce/ads-ai-connectors/ads-mcp-server/ads-mcp-server-get-started)).
So before anyone can connect Meta Ads, the install owner makes one Meta app for the install and gives the install its ID
(#914). Until then, Connect on Meta Ads says so and opens no sign-in window.

## 1. Make the Meta app

1. In [Meta for Developers](https://developers.facebook.com/apps), create an app (type **Business**) owned by the
   business that owns the ad accounts.
2. Add the use case **Create & manage ads with ads MCP server**.
3. Add **Facebook Login for Business** and, under its settings, set the **Valid OAuth Redirect URI** to

   ```
   https://<install origin>/api/apps/callback/meta-ads
   ```

   where `<install origin>` is the install's `APP_ORIGIN` (the address people open gtmworks at), for example
   `https://app.example.com/api/apps/callback/meta-ads`.
4. Copy the app's **App ID** (and, if Meta asks for one, its **App secret**) from **App settings › Basic**.

## 2. Give the install its ID

On the install's server, in the install directory, add to `.env.install`:

```
META_ADS_CLIENT_ID=<App ID>
# Only if Meta asks for it:
META_ADS_CLIENT_SECRET=<App secret>
```

Then start the web app again so it reads them:

```
docker compose --env-file .env.install -f docker-compose.install.yml up -d web
```

Only the web app reads them, on the server. The ID and the secret are written into the Engine's config for the Meta Ads
server (`mcp_servers.meta-ads.oauth.client_id` / `client_secret`, as Hermes's own dashboard writes them) when someone
connects it; they never reach a browser, a log or the database.

## 3. Connect

An Administrator opens **Settings › Apps › Meta Ads**, picks the Agents and presses **Connect**. The sign-in window goes
to Meta (`www.facebook.com/…/dialog/oauth?client_id=<App ID>…`), and Meta sends the person back to the redirect URI above.

If Meta still refuses, the page says why, and the web app's log has one `app_sign_in_failed` line with Meta's answer
(`docs/production-logs.md`).
