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
    condition     = length(trimspace(var.repository_ref)) >= 5 && var.repository_ref != "main"
    error_message = "repository_ref must be an immutable tag or commit, not main."
  }
}

variable "relay_a" {
  description = "Region-specific configuration for relay A."
  type = object({
    region                               = string
    availability_zone                    = optional(string)
    domain                               = string
    vpc_cidr                             = string
    subnet_cidr                          = string
    instance_type                        = optional(string, "t3.small")
    root_volume_gib                      = optional(number, 30)
    node_key_parameter_name              = string
    rain_attestor_key_parameter_name     = string
    base_rpc_url_parameter_name          = string
    graduation_keeper_enabled            = optional(bool, false)
    graduation_keeper_key_parameter_name = optional(string)
    static_peer                          = string
  })
  validation {
    condition = !var.relay_a.graduation_keeper_enabled || try(
      length(trimspace(var.relay_a.graduation_keeper_key_parameter_name)) > 0,
      false,
    )
    error_message = "relay_a requires graduation_keeper_key_parameter_name when its keeper is enabled."
  }
}

variable "relay_b" {
  description = "Region-specific configuration for relay B."
  type = object({
    region                               = string
    availability_zone                    = optional(string)
    domain                               = string
    vpc_cidr                             = string
    subnet_cidr                          = string
    instance_type                        = optional(string, "t3.small")
    root_volume_gib                      = optional(number, 30)
    node_key_parameter_name              = string
    rain_attestor_key_parameter_name     = string
    base_rpc_url_parameter_name          = string
    graduation_keeper_enabled            = optional(bool, false)
    graduation_keeper_key_parameter_name = optional(string)
    static_peer                          = string
  })
  validation {
    condition = !var.relay_b.graduation_keeper_enabled || try(
      length(trimspace(var.relay_b.graduation_keeper_key_parameter_name)) > 0,
      false,
    )
    error_message = "relay_b requires graduation_keeper_key_parameter_name when its keeper is enabled."
  }
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

variable "rain" {
  description = "Canonical Arena indexing and provider-budget policy shared by full nodes."
  type = object({
    chain_id                = optional(number, 8453)
    arena_address           = string
    start_block             = number
    poll_ms                 = optional(number, 10000)
    confirmations           = optional(number, 2)
    distribution_ms         = optional(number, 5000)
    rpc_daily_credit_budget = optional(number, 3000000)
  })
  validation {
    condition = (
      can(regex("^0x[a-fA-F0-9]{40}$", var.rain.arena_address)) &&
      var.rain.poll_ms >= 10000 &&
      var.rain.distribution_ms >= 1000
    )
    error_message = "rain requires a valid Arena address, poll_ms of at least 10000, and distribution_ms of at least 1000."
  }
}

variable "graduation" {
  description = "Optional permissionless graduation-transaction safety policy shared by enabled keepers."
  type = object({
    submission_delay_ms   = optional(number, 0)
    rebroadcast_ms        = optional(number, 120000)
    max_gas_limit         = optional(number, 8000000)
    max_execution_fee_wei = optional(string, "5000000000000000")
  })
  default = {}
  validation {
    condition = (
      var.graduation.submission_delay_ms >= 0 &&
      var.graduation.submission_delay_ms <= 86400000 &&
      var.graduation.rebroadcast_ms >= 10000 &&
      var.graduation.rebroadcast_ms <= 86400000 &&
      var.graduation.max_gas_limit >= 100000 &&
      var.graduation.max_gas_limit <= 30000000 &&
      can(regex("^[1-9][0-9]*$", var.graduation.max_execution_fee_wei))
    )
    error_message = "graduation keeper timing, gas limit, or execution-fee ceiling is invalid."
  }
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
