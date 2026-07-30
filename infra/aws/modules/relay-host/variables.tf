variable "name" {
  type = string
}

variable "availability_zone" {
  type    = string
  default = null
}

variable "domain" {
  type = string
}

variable "hosted_zone_id" {
  type = string
}

variable "vpc_cidr" {
  type = string
}

variable "subnet_cidr" {
  type = string
}

variable "instance_type" {
  type = string
}

variable "root_volume_gib" {
  type = number
}

variable "node_key_parameter_name" {
  type = string
}

variable "rain_attestor_key_parameter_name" {
  type = string
}

variable "base_rpc_url_parameter_name" {
  type = string
}

variable "fx_broker_enabled" {
  type    = bool
  default = false
}

variable "fx_broker_key_parameter_name" {
  type    = string
  default = null
}

variable "fx_base_sepolia_rpc_parameter_name" {
  type    = string
  default = null
}

variable "fx_arbitrum_sepolia_rpc_parameter_name" {
  type    = string
  default = null
}

variable "fx_deployment_id" {
  type = string
}

variable "fx_waku_peers" {
  type = string
}

variable "fx_observation_window_ms" {
  type = number
}

variable "fx_max_active_rfqs" {
  type = number
}

variable "fx_x402_requests_per_minute_per_ip" {
  type = number
}

variable "fx_max_concurrent_x402_requests" {
  type = number
}

variable "graduation_keeper_enabled" {
  type    = bool
  default = false
}

variable "graduation_keeper_key_parameter_name" {
  type    = string
  default = null
}

variable "chain_id" { type = number }
variable "arena_address" { type = string }
variable "rain_start_block" { type = number }
variable "rain_poll_ms" { type = number }
variable "rain_confirmations" { type = number }
variable "rain_distribution_ms" { type = number }
variable "rpc_daily_credit_budget" { type = number }
variable "rpc_credits_per_second" { type = number }
variable "graduation_submission_delay_ms" { type = number }
variable "graduation_rebroadcast_ms" { type = number }
variable "graduation_max_gas_limit" { type = number }
variable "graduation_max_execution_fee_wei" { type = string }

variable "static_peer" {
  type = string
}

variable "repository_url" {
  type = string
}

variable "repository_ref" {
  type = string
}

variable "store_seconds" {
  type = number
}

variable "store_capacity" {
  type = number
}

variable "store_size" {
  type = string
}

variable "operator_cidr_blocks" {
  type = list(string)
}

variable "alarm_email" {
  type = string
}
