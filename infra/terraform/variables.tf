variable "project_name" {
  description = "Name used to tag and identify PulseOps resources."
  type        = string
  default     = "pulseops"
}

variable "aws_region" {
  description = "AWS region in which the laboratory is created."
  type        = string
  default     = "eu-south-2"
}

variable "admin_cidr" {
  description = "Single trusted public IPv4 CIDR allowed to use SSH and the API."
  type        = string

  validation {
    condition     = can(cidrnetmask(var.admin_cidr)) && endswith(var.admin_cidr, "/32")
    error_message = "admin_cidr must be a valid single-host IPv4 CIDR ending in /32."
  }
}

variable "public_key_path" {
  description = "Path to the local SSH public key uploaded to EC2."
  type        = string
  default     = "~/.ssh/pulseops_ed25519.pub"
}

variable "instance_type" {
  description = "EC2 instance type for the single-node k3s laboratory."
  type        = string
  default     = "t3.medium"
}

variable "root_volume_size" {
  description = "Size in GiB of the encrypted gp3 root volume."
  type        = number
  default     = 20

  validation {
    condition     = var.root_volume_size >= 20
    error_message = "root_volume_size must be at least 20 GiB."
  }
}

variable "k3s_version" {
  description = "Pinned k3s version installed by cloud-init."
  type        = string
  default     = "v1.36.4+k3s1"
}
