variable "zone" {
  description = "Exoscale zone. ch-gva-2 = Geneva: where every ninabot VM lives and the direct Tailscale path to rog1."
  type        = string
  default     = "ch-gva-2"
}

variable "name" {
  description = "Instance name (ninabot convention <project>-<role><n>)."
  type        = string
  default     = "aurane-app1"
}

variable "instance_type" {
  description = "Season 0 game server: one world process + Postgres + Valkey in Compose. standard.medium = 2 vCPU / 4 GiB (~40 CHF/month)."
  type        = string
  default     = "standard.medium"
}

variable "disk_size" {
  description = "Root disk in GiB (Postgres + event log + rendered maps live here in Season 0)."
  type        = number
  default     = 50
}

variable "template_name" {
  type    = string
  default = "Linux Ubuntu 24.04 LTS 64-bit"
}

variable "ssh_public_key" {
  description = "Break-glass SSH key registered on the instance. Day-to-day access is Tailscale SSH."
  type        = string
}

variable "tailscale_authkey" {
  description = "Ephemeral, single-use, pre-authorized auth key minted with tags [tag:aurane] (see README). Sensitive."
  type        = string
  sensitive   = true
}

variable "cloudflared_token" {
  description = "Token of the dedicated Cloudflare tunnel for playaurane.com (empty = no tunnel yet)."
  type        = string
  sensitive   = true
  default     = ""
}

variable "labels" {
  type = map(string)
  default = {
    project = "aurane"
    role    = "app"
    season  = "0"
  }
}
