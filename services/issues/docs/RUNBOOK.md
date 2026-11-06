# Issues Service Runbook

## Incident A: backend down after logout / 502 on /graphql

**Symptom:** `https://cadence.whatisbackdoor.com/graphql` returns 502; the issues container is not running.

**Cause:** The Linux install used a `systemd --user` unit whose `ExecStop` ran `docker compose ... stop`/`down`. When the last login/SSH session ended, the user manager stopped and tore down the stack.

**History:** Outage ran 2026-08-16 to 2026-08-23 (about 7 days). Interim mitigation was `loginctl enable-linger <user>`.

**Fix:** The unit is now a system-level unit (`/etc/systemd/system/com.claude-cadence.issues.service`) that does not depend on any session, and `ExecStop=/bin/true`.

## System-unit model

- `./install.sh` on Linux requires sudo (or root) to write the unit and call `systemctl`.
- Manage with: `sudo systemctl status|restart|reload com.claude-cadence.issues`
  - `reload` rebuilds the image and recreates the container with a health-check wait (zero-downtime redeploy).
- Stopping the unit leaves the stack up. The container uses `restart: unless-stopped`; only `./install.sh uninstall` tears the stack down.
- The unit runs as the user who ran `install.sh` (`$SUDO_USER` if invoked via sudo), requires `docker.service`, and is `WantedBy=multi-user.target` (starts at boot).

## Verification

1. `systemctl is-enabled com.claude-cadence.issues` prints `enabled`.
2. `systemctl status com.claude-cadence.issues` shows `active (exited)`.
3. Log out of all sessions, then from elsewhere: `curl -i https://cadence.whatisbackdoor.com/graphql` returns 200.

## Migrating from the user unit

Re-run `./install.sh`. It detects `~/.config/systemd/user/com.claude-cadence.issues.service`, runs `systemctl --user disable --now` on it (without `compose down`), removes the file, reloads the user manager, and then installs and enables the system unit. `./install.sh uninstall` also cleans up a leftover legacy unit.

The `loginctl enable-linger` mitigation is superseded. After migrating you can disable it: `loginctl disable-linger <user>`.
