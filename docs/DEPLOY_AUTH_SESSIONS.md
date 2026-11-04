# Deploying Google linking and staff sessions

Runbook for the first production deploy of Sessions 24 and 25. The API and web app must go out
together, because this release changes how staff stay signed in.

## What staff will notice

- **Everyone is signed out once** and must sign in again. Tokens from before this release are refused.
- The API is unavailable while it restarts. Fly.io boots it in seconds, but it runs on one machine.
- Screens left open on the old version misbehave until reloaded.

## Before the window

1. Run the email review, which reads production and changes nothing:
   `npm run audit:user-emails --workspace apps/api -- --fly-app petropro-api`
   Fix every `[block]` finding on the Users screen, and look at each `[review]` finding.
2. Take a backup in Settings → Backup and download a copy.
3. Check that each station device is online and shows nothing queued on the Attendant and Billing
   screens. **The old app deletes a queued sale on any API error**, including during this restart.

## The window

Pause billing for about 5 minutes.

```powershell
# Build the web app without making it live, then note the deployment URL it prints.
vercel deploy --prod --skip-domain

flyctl deploy --remote-only -a petropro-api
curl.exe https://petropro-api.fly.dev/health

# Make the web app live.
vercel promote <deployment URL>
```

The new web app can't work until the new API is up, and the old web app can't work with the new
API. Building first keeps that gap to seconds rather than the length of a web build.

Have every device reload and sign in again.

## Check straight after

1. Password login, then a reload 16 minutes later: the user should still be signed in.
2. Sign out, then back in on the same device.
3. A first Google sign-in (asks for the password), then a second one (doesn't). **This has only been
   tested against a fake Google.**
4. In a browser's developer tools, check `petropro_refresh` is set on the website's own domain. **The
   cookie going through Vercel can only be confirmed here.** If it's missing, staff get signed out
   every 15 minutes, so roll back.
5. Deactivate a test user who is signed in on another device: their next action sends them to sign in.
6. `flyctl logs -a petropro-api`: look for errors.

## Rolling back

```powershell
vercel rollback dpl_GoQnDrXZ84vpF3UaMiWuysqqr2g7
flyctl deploy -a petropro-api --image registry.fly.io/petropro-api:deployment-01M6EN1SBWAXC2RHK5QWMFT90D
```

The database changes only add tables and a column, so the previous version runs on them unchanged and
no data needs restoring. Rolling back also brings back the never-expiring tokens and the old Google
sign-in until this is deployed again.
