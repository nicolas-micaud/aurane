output "instance_id" {
  value = exoscale_compute_instance.app.id
}

output "public_ip" {
  description = "Public IPv4 — SSH is closed there; use Tailscale (`tailscale status | grep aurane`)."
  value       = exoscale_compute_instance.app.public_ip_address
}

output "tailscale_hostname" {
  value = var.name
}
