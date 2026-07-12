variable "project" {
  description = "Stable project identifier used in AWS resource names."
  type        = string
  default     = "versus-waku"

  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{2,30}$", var.project))
    error_message = "project must be a lowercase DNS-safe identifier."
  }
}

variable "environment" {
  description = "Deployment environment label."
  type        = string
  default     = "production"
}

variable "hosted_zone_id" {
  description = "Existing Route 53 public hosted-zone ID for both relay records."
  type        = string
}

variable "repository_url" {
  description = "Public HTTPS Git URL for this relay repository."
  type        = string
  default     = "https://github.com/digital-shephard/versus-waku-relay.git"
}

variable "repository_ref" {
  description = "Immutable release tag or commit to deploy. Do not use main in production."
  type        = string

  validation {
    condition     = length(trimspace(var.repository_ref)) >= 7 && var.repository_ref != "main"
    error_message = "repository_ref must be an immutable tag or commit, not main."
  }
}

variable "relay_a" {
  description = "Region-specific configuration for relay A."
  type = object({
    region                  = string
    availability_zone       = optional(string)
    domain                  = string
    vpc_cidr                = string
    subnet_cidr             = string
    instance_type           = optional(string, "t3.small")
    root_volume_gib         = optional(number, 30)
    node_key_parameter_name = string
    static_peer             = string
  })
}

variable "relay_b" {
  description = "Region-specific configuration for relay B."
  type = object({
    region                  = string
    availability_zone       = optional(string)
    domain                  = string
    vpc_cidr                = string
    subnet_cidr             = string
    instance_type           = optional(string, "t3.small")
    root_volume_gib         = optional(number, 30)
    node_key_parameter_name = string
    static_peer             = string
  })
}

variable "store" {
  description = "Bounded temporary Store policy shared by both nodes."
  type = object({
    seconds  = optional(number, 21600)
    capacity = optional(number, 25000)
    size     = optional(string, "512MB")
  })
  default = {}
}

variable "operator_cidr_blocks" {
  description = "Optional operator networks allowed to reach SSH. Leave empty and use SSM Session Manager."
  type        = list(string)
  default     = []
}

variable "alarm_email" {
  description = "Optional email endpoint for basic instance alarms. Empty disables email subscription."
  type        = string
  default     = ""
}
