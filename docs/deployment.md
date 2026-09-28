# Deploy ARGOS Lab with Coolify

ARGOS Lab is a static, multipage website. The Dockerfile builds it with Node.js
22 and serves only `dist/` through an unprivileged Nginx process on port 8080.
The development and Vite preview servers are not production servers.

## Data and persistence

No database, backend, application secrets or persistent volume is required.
The lesson recordings in `docs/results/` are versioned and included in the
compiled JavaScript. Visitor runs and imported recordings remain in browser
memory and reset on reload. This deployment does not add saved progress.
ROS 2, ArduPilot and Gazebo are optional recording tools; they do not run on
the web server. Do not mount a persistent volume over the compiled website:
it would hide the files delivered by subsequent deployments.

Private local notes, credentials, Git metadata and generated local output are
excluded from the Docker build context. The final image contains the compiled
public site only, not the source repository or documentation tree.

## Local container verification

```sh
docker build -t argos-lab:local .
docker run --rm --name argos-lab-preview -p 127.0.0.1:8080:8080 argos-lab:local
```

Open `http://127.0.0.1:8080/`, `/workshops/`, an interactive lesson such as
`/consensus/`, and a recording such as `/shared-world/`. Check `/healthz` for
HTTP 200. Unknown paths must return HTTP 404. Paths without a trailing slash
redirect to their matching directory without exposing the container port.

## Create a separate Coolify application

1. Create a new project and production application on the existing server.
   Select the repository and `main` branch. Prefer an existing GitHub App
   connection when available; a public Git repository also works.
2. Select **Dockerfile** as the build pack. Set the base directory to `/`,
   Dockerfile location to `/Dockerfile`, and exposed port to `8080`.
   Leave host port mappings empty. The existing Coolify proxy routes requests
   to the container; this application does not bind host ports 80 or 443.
3. Add only this site's DNS record: `A argoslab` pointing to the hosting
   server's IPv4 address. Resolve any conflicting record for that exact name;
   preserve all other DNS records. Do not add AAAA unless IPv6 is configured.
4. Set the application domain to `https://argoslab.victormonnot.com`.
   Keep HTTP Basic Authentication disabled for public access. Coolify manages
   HTTPS certificates through the existing proxy.
5. Use the image health check, or configure Coolify to check HTTP `/healthz`
   on port 8080 with expected status 200. Do not add volumes or environment
   variables for the current application.
6. Deploy only this new application. Verify its logs, health, certificate,
   HTTP-to-HTTPS redirection, all lesson links and representative interactions.
   Confirm previously hosted applications still return their original status.

Do not change the existing proxy, destination network or other applications.
Do not deploy the recording-tool Dockerfiles under lesson directories.

## Updates after a push

Commit changes and push `main` to the connected repository. Coolify must build
that revision before it can appear online. With a GitHub App connection and
**Auto Deploy** enabled, push events trigger deployment automatically. For a
plain public repository, configure the authenticated GitHub webhook documented
by Coolify; the repository URL alone does not enable automatic deployment.

Without a webhook, push first, then click **Deploy** on this application in
Coolify. Follow the deployment log and verify the deployed commit. Reload the
site when deployment is healthy. HTML is revalidated and compiled assets use
content-hashed names, so updated pages reference the new assets. A browser tab
already running an experiment continues its loaded version until reloaded.

There is no application database to migrate or restore. Preserve the Git
repository, the application's Coolify settings and normal server/Coolify
backups. To undo an update, deploy a known good revision or revert the change
and push again.

## References

- [Vite static deployment](https://vite.dev/guide/static-deploy.html)
- [Coolify Dockerfile builds](https://coolify.io/docs/applications/builds/dockerfile)
- [Coolify domains and HTTPS](https://coolify.io/docs/core/networking/domains)
- [Coolify automatic deployments](https://coolify.io/docs/applications/deployments/automatic-deployments)
- [Coolify manual webhooks](https://coolify.io/docs/applications/deployments/manual-webhooks)
