# Deploying When2Yi (RackNerd VPS + Docker)

A practical, security-first guide for a $1–2/month KVM VPS (RackNerd 1 GB works fine —
the app idles at ~150–300 MB). Everything here also applies to Hetzner, a home box, etc.

**Design constraints that matter for hosting:** one long-lived Node process, an
in-memory SSE bus, and SQLite on local disk. So: **run exactly one instance** (no
autoscaling), give it a **persistent volume**, and keep it **always-on** (no scale-to-zero).

---

## 0. What you need

- A VPS with root SSH (RackNerd 1 GB KVM: 1 vCPU / 1 GB / 20 GB — plenty).
- A domain name. Free-and-easiest path: put the domain on **Cloudflare** (Option B below).
- ~20 minutes.

---

## 1. First login — harden the box

SSH in as root, then:

```bash
# --- a non-root user with sudo ---
adduser yi && usermod -aG sudo yi

# --- SSH keys (run this on YOUR laptop, not the server) ---
#   ssh-copy-id yi@SERVER_IP
# then back on the server, lock SSH down:
sudo sed -i 's/^#\?PermitRootLogin.*/PermitRootLogin no/' /etc/ssh/sshd_config
sudo sed -i 's/^#\?PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config
sudo systemctl restart ssh

# --- firewall: only SSH + web ---
sudo apt-get update && sudo apt-get install -y ufw
sudo ufw allow OpenSSH
sudo ufw allow 80,443/tcp     # SKIP this line if you use Cloudflare Tunnel (Option B)
sudo ufw --force enable

# --- brute-force protection + auto security updates ---
sudo apt-get install -y fail2ban unattended-upgrades sqlite3
sudo dpkg-reconfigure -plow unattended-upgrades   # choose "Yes"

# --- swap: lets a 1 GB box build the app without OOM (see §4) ---
sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile
sudo mkswap /swapfile && sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

## 2. Install Docker

```bash
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker yi     # log out / back in so `docker` works without sudo
```

## 3. Get the app on the box

```bash
sudo mkdir -p /opt/when2yi && sudo chown yi:yi /opt/when2yi
git clone https://github.com/yizhutlon-coder/when2yi.git /opt/when2yi
cd /opt/when2yi
printf 'SITE_ADDRESS=meet.example.com\n' > .env   # <-- your domain
```

## 4. Build & run

```bash
docker compose up -d --build
docker compose logs -f app        # watch it come up
```

The **2 GB swap from §1** is what lets `next build` finish on a 1 GB box. If you'd
rather not build on the server at all, build the image on your laptop and push it to a
registry, or `docker save | ssh ... docker load`. (Building on Apple Silicon for an
x86 VPS? add `--platform linux/amd64` — `better-sqlite3` ships a native binary.)

Your SQLite database lives in `/opt/when2yi/data/when2yi.db` — that directory **is**
your data. Everything else is disposable.

## 5. Expose it to the internet — pick ONE

### Option A — Caddy (in this compose file), automatic HTTPS
1. DNS: an **A record** for `meet.example.com` → your server IP.
2. `docker compose up -d` (Caddy is already in `docker-compose.yml`).
3. Caddy fetches a Let's Encrypt cert automatically. Done — visit `https://meet.example.com`.

### Option B — Cloudflare Tunnel (recommended: no open ports, hides your IP, free WAF)
1. Add your domain to Cloudflare (free plan).
2. In `docker-compose.yml`: delete the `caddy` service, and change the app's `expose:`
   to `ports: ["127.0.0.1:3000:3000"]`.
3. Install the tunnel and point it at the app:
   ```bash
   curl -fsSL https://pkg.cloudflare.com/install.sh | sudo bash   # or: docker cloudflare/cloudflared
   cloudflared tunnel login
   cloudflared tunnel create when2yi
   # route meet.example.com -> http://localhost:3000 (dashboard or config.yml), then:
   cloudflared tunnel run when2yi
   ```
   You can now close 80/443 in ufw entirely — nothing connects inward.

## 6. Put Cloudflare in front (do this even with Option A)

Proxy the domain through Cloudflare (orange cloud) and you get, for free:
- **DDoS protection + WAF**, **Bot Fight Mode**, and origin-IP hiding.
- **Rate-limiting rules** — the app has light per-IP limits built in, but Cloudflare is
  your real shield if a share link goes public. A good starter rule: limit
  `/api/*` to ~30 requests/10s per IP.

## 7. Backups (do not skip)

```bash
crontab -e
# daily 03:30, keep 14 compressed copies:
30 3 * * * cd /opt/when2yi && ./scripts/backup.sh >> /var/log/when2yi-backup.log 2>&1
```

`scripts/backup.sh` uses SQLite's safe `.backup` (WAL-aware) and prunes old copies.
**Then copy `data`/`backups` offsite** (rclone to a bucket, or scp) — a backup on the
same disk isn't one.

## 8. Updating

```bash
cd /opt/when2yi && git pull && docker compose up -d --build
```

The DB in `./data` is untouched by rebuilds.

---

## Security recap

The app has **no accounts — the link is the access.** Two link types:

- **Share link** `/e/{slug}` — view + respond. Fine to share with your group.
- **Organizer link** `/e/{slug}?organizer=<token>` — **full admin. Treat it like a
  password.** Only ever share the plain link.

Built-in protections you should use:
- **Rotate organizer link** button on the event page — invalidates a leaked admin link
  and issues a new one (no need to remake the event).
- **Per-respondent PINs** — encourage people to set one so others can't edit their name.
- **Response deadline** — auto-closes the poll.
- **Built-in per-IP rate limits** on event-creation / sign-in / availability saves
  (HTTP 429); API keys are exempt.
- **`Referrer-Policy` + security headers** (in `next.config.ts`) keep the token in the
  URL from leaking to other sites.

Operational:
- Keep the box patched (unattended-upgrades, §1), SSH keys only, ufw on, Cloudflare in front.
- Serve **only over HTTPS** (tokens ride in URLs).
- Never paste an `?organizer=` URL into a public channel or issue tracker.

---

## Troubleshooting

- **Build killed / OOM on 1 GB** → you skipped the swap in §1, or build off-box (§4).
- **`Error: ... invalid ELF header` / better-sqlite3 won't load** → the image was built
  for a different CPU arch. Rebuild on the target arch or with `--platform linux/amd64`.
- **Live heatmap doesn't update through the proxy** → SSE needs unbuffered proxying; the
  provided `Caddyfile` sets `flush_interval -1`. On nginx use `proxy_buffering off;`.
- **Cert won't issue (Option A)** → DNS A record not pointing at the box yet, or 80/443
  blocked by ufw / the provider firewall.
