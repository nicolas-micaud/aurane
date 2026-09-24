# infra/ — Aurane Season 0 on Exoscale (Terraform)

One VM `aurane-app1` in **ch-gva-2**, joined to the ninabot tailnet as `tag:aurane`, public entry
through a Cloudflare tunnel. Everything else (world process, Postgres, Valkey, workers) runs in
Docker Compose on that VM for Season 0 — see `docs/GDD.md` §12 and `docs/ops/context.md` §1.

## Credentials (never in the repo)

| What | Where |
|---|---|
| Exoscale API key/secret | Vaultwarden collection `aurane`, items `exoscale-aurane-api-key` / `-secret` (IAM role `terraform-aurane`: compute, dbaas, sos) |
| Tailscale auth key | minted per apply from the tailnet API: `tags:["tag:aurane"]`, ephemeral, preauthorized, 1 use, 1 h |
| Cloudflare tunnel token | created via the Cloudflare API for the dedicated tunnel `aurane-app1` |

```bash
cd infra
# 1. Exoscale creds from Vaultwarden (owner session) or the local env file on gmk1
set -a; . /root/.config/ninabot/aurane-exoscale.env; set +a
# 2. Bootstrap tokens
export TF_VAR_ssh_public_key="$(cat ~/.ssh/id_ed25519.pub)"
export TF_VAR_tailscale_authkey="$(…mint via API, see ninabot-pro maic/infra/runner-vm/create-vm.sh…)"
export TF_VAR_cloudflared_token=""   # once the tunnel exists
# 3. Plan (read-only), then apply on Nick's go
terraform init && terraform validate && terraform plan
terraform apply
```

After apply: `tailscale status | grep aurane-app1` from gmk1, then `ssh root@aurane-app1` (Tailscale SSH).
Public SSH is closed by the security group; the break-glass key only matters if the tailnet is down.

## Conventions carried over from ninabot

- Security group deny-all; only UDP 41641 open (direct Tailscale path, DERP fallback otherwise).
- `user_data` in `lifecycle.ignore_changes`: a cloud-init edit never replaces a live server.
- VM born in UTC → cloud-init sets `Europe/Zurich` before any timer.
- Daily `docker-prune.timer` (front1 disk-full incident, 2026-09-18).
- State local for now; move to SOS when a second operator host appears.
