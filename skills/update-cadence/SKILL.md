---
name: update-cadence
description: Update the claude-cadence plugin to the latest version
disable-model-invocation: true
---

# Update Claude Cadence

Pull the latest plugin version and report what changed.

## Steps

1. **Find the marketplace repo:**
   ```bash
   CADENCE_DIR=""
   for d in ~/.claude/plugins/marketplaces/claude-cadence .claude-plugins/claude-cadence; do
     [ -d "$d/.git" ] && CADENCE_DIR="$d" && break
   done
   echo "${CADENCE_DIR:-NOT FOUND}"
   ```

   If not found, tell the user the plugin is not installed via a marketplace.

2. **Pull latest:**
   ```bash
   git -C "$CADENCE_DIR" pull
   ```

3. **Show what changed:**
   ```bash
   git -C "$CADENCE_DIR" log --oneline -10
   ```

4. **Notify the user** to restart Claude Code to apply changes.
