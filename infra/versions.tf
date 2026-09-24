terraform {
  required_version = ">= 1.6"

  required_providers {
    exoscale = {
      source  = "exoscale/exoscale"
      version = "~> 0.64"
    }
    cloudinit = {
      source  = "hashicorp/cloudinit"
      version = "~> 2.3"
    }
  }

  # State: local by default (gitignored). Move to Exoscale SOS (S3-compatible) when a second
  # operator host needs to drive this module — pattern in ninabot-pro/infra/exoscale/versions.tf.
  # backend "s3" {
  #   bucket                      = "aurane-tfstate"
  #   key                         = "aurane/season0.tfstate"
  #   region                      = "ch-gva-2"
  #   endpoints                   = { s3 = "https://sos-ch-gva-2.exo.io" }
  #   skip_credentials_validation = true
  #   skip_region_validation      = true
  #   skip_requesting_account_id  = true
  #   use_path_style              = true
  # }
}

# Credentials come from the environment: EXOSCALE_API_KEY / EXOSCALE_API_SECRET
# (scoped IAM role `terraform-aurane`: compute, dbaas, sos only). Never in tfvars.
provider "exoscale" {}
