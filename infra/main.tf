# Aurane — Season 0 compute on Exoscale.
#
# One VM in ch-gva-2, deny-all security group (only UDP 41641 for the direct Tailscale path),
# joins the ninabot tailnet with tag:aurane (ACL: rog1:8007 only — the LLM behind the Général),
# public entry through a Cloudflare tunnel running on the VM. Mirrors the two ninabot modules
# (ninabot-pro/infra/exoscale, sokkan-cloud/sokkan-env); see docs/ops/context.md §1.

data "exoscale_template" "ubuntu" {
  zone = var.zone
  name = var.template_name
}

resource "exoscale_ssh_key" "breakglass" {
  name       = "${var.name}-breakglass"
  public_key = var.ssh_public_key
}

resource "exoscale_security_group" "app" {
  name        = "${var.name}-sg"
  description = "Aurane ${var.name}: deny-all ingress, Tailscale direct path only"
}

# Inbound: only the Tailscale UDP port (direct path instead of DERP). HTTP(S) never listens
# publicly: cloudflared dials out to Cloudflare.
resource "exoscale_security_group_rule" "tailscale_udp" {
  security_group_id = exoscale_security_group.app.id
  type              = "INGRESS"
  protocol          = "udp"
  cidr              = "0.0.0.0/0"
  start_port        = 41641
  end_port          = 41641
}

resource "exoscale_security_group_rule" "tailscale_udp_v6" {
  security_group_id = exoscale_security_group.app.id
  type              = "INGRESS"
  protocol          = "udp"
  cidr              = "::/0"
  start_port        = 41641
  end_port          = 41641
}

data "cloudinit_config" "app" {
  gzip          = false
  base64_encode = false

  part {
    content_type = "text/cloud-config"
    content = templatefile("${path.module}/cloud-init.yaml.tftpl", {
      hostname          = var.name
      tailscale_authkey = var.tailscale_authkey
      cloudflared_token = var.cloudflared_token
    })
  }
}

resource "exoscale_compute_instance" "app" {
  zone               = var.zone
  name               = var.name
  type               = var.instance_type
  template_id        = data.exoscale_template.ubuntu.id
  disk_size          = var.disk_size
  ssh_key            = exoscale_ssh_key.breakglass.name
  security_group_ids = [exoscale_security_group.app.id]
  user_data          = data.cloudinit_config.app.rendered
  labels             = var.labels

  lifecycle {
    # A cloud-init change must never replace a live game server; re-run the bootstrap by hand.
    ignore_changes = [user_data]
  }
}
