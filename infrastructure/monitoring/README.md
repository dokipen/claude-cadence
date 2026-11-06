# Monitoring (bootsy)

Prometheus + node-exporter + Grafana, compose project `monitoring`.

```bash
cd infrastructure/monitoring
docker compose -p monitoring up -d
```

## Why node-exporter uses `network_mode: host`

The netdev collector reads `/proc/net/dev`, and `/proc/net` is `/proc/self/net`
— the network namespace of the reading process. Bind-mounting the host `/proc`
does not change that, so a bridged exporter only sees its own container NIC
(`eth0`/`lo`). Host networking exposes the real host interfaces (e.g. `enp3s0`).
`pid: host` is also set. Port 9100 binds directly on the host; Prometheus scrapes
`host.docker.internal:9100` (via `extra_hosts: host-gateway`). Requires Docker 20.10+ for `host-gateway`. Firewall 9100 from
untrusted networks (it is no longer limited to the compose network), but allow
the compose bridge subnet to reach it, or the `node` target will be DOWN under a
default-deny INPUT policy. veth/bridge devices are excluded from netdev metrics.
Set `GRAFANA_ADMIN_PASSWORD` in the environment (default `admin`).

## Verify

- Target UP: `http://<host>:9090/targets` (job `node`)
- `node_network_transmit_bytes_total{device="enp3s0"}` exists and tracks
  `cat /sys/class/net/enp3s0/statistics/tx_bytes`
- Grafana dashboard **Host Bandwidth** shows TX/RX for `enp3s0`
- Filesystem, CPU and memory metrics are still present
