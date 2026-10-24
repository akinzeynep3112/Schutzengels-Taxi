# Schutzengels Taxii

Seven public countdown timers with a private admin page. Timer values, global run/pause state, and admin sessions are stored in PostgreSQL so they survive web-service restarts (subject to the database provider's retention and availability).

## Required environment variables

Set these in your hosting provider's environment settings. Do not commit them to GitHub.

- `DATABASE_URL`: PostgreSQL connection string from your database provider.
- `ADMIN_USERNAME`: your chosen admin username.
- `ADMIN_PASSWORD`: your chosen admin password, entered only in the hosting provider’s private environment settings. Never put it in GitHub or send it in chat.
- `SESSION_SECRET`: a long random secret (at least 32 random characters).
- `NODE_ENV`: set to `production` on hosting.

Optional:
- `PGSSLMODE=disable` only for a database that explicitly does not use TLS. Usually leave unset.
- `PORT` is supplied by most hosting providers.

## Hosting notes

Use a Node.js web service and a managed PostgreSQL database. Free hosting plans may sleep, pause, change their limits, or remove inactive databases; review the provider's current terms. The site can take a short time to wake after inactivity. Keep this repository free of passwords, hashes, database URLs, and session secrets.

## Routes

- `/` public timer display
- `/admin` admin login and controls
