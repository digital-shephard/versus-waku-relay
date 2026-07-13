locals {
  common_tags = {
    Project     = var.project
    Environment = var.environment
    ManagedBy   = "terraform"
    Repository  = var.repository_url
  }
}

module "relay_a" {
  source = "./modules/relay-host"

  providers = { aws = aws.relay_a }

  name                                 = "${var.project}-a"
  availability_zone                    = var.relay_a.availability_zone
  domain                               = var.relay_a.domain
  hosted_zone_id                       = var.hosted_zone_id
  vpc_cidr                             = var.relay_a.vpc_cidr
  subnet_cidr                          = var.relay_a.subnet_cidr
  instance_type                        = var.relay_a.instance_type
  root_volume_gib                      = var.relay_a.root_volume_gib
  node_key_parameter_name              = var.relay_a.node_key_parameter_name
  rain_attestor_key_parameter_name     = var.relay_a.rain_attestor_key_parameter_name
  base_rpc_url_parameter_name          = var.relay_a.base_rpc_url_parameter_name
  graduation_keeper_enabled            = var.relay_a.graduation_keeper_enabled
  graduation_keeper_key_parameter_name = try(var.relay_a.graduation_keeper_key_parameter_name, null)
  chain_id                             = var.rain.chain_id
  arena_address                        = var.rain.arena_address
  rain_start_block                     = var.rain.start_block
  rain_poll_ms                         = var.rain.poll_ms
  rain_confirmations                   = var.rain.confirmations
  rain_distribution_ms                 = var.rain.distribution_ms
  rpc_daily_credit_budget              = var.rain.rpc_daily_credit_budget
  graduation_submission_delay_ms       = var.graduation.submission_delay_ms
  graduation_rebroadcast_ms            = var.graduation.rebroadcast_ms
  graduation_max_gas_limit             = var.graduation.max_gas_limit
  graduation_max_execution_fee_wei     = var.graduation.max_execution_fee_wei
  static_peer                          = var.relay_a.static_peer
  repository_url                       = var.repository_url
  repository_ref                       = var.repository_ref
  store_seconds                        = var.store.seconds
  store_capacity                       = var.store.capacity
  store_size                           = var.store.size
  operator_cidr_blocks                 = var.operator_cidr_blocks
  alarm_email                          = var.alarm_email
}

module "relay_b" {
  source = "./modules/relay-host"

  providers = { aws = aws.relay_b }

  name                                 = "${var.project}-b"
  availability_zone                    = var.relay_b.availability_zone
  domain                               = var.relay_b.domain
  hosted_zone_id                       = var.hosted_zone_id
  vpc_cidr                             = var.relay_b.vpc_cidr
  subnet_cidr                          = var.relay_b.subnet_cidr
  instance_type                        = var.relay_b.instance_type
  root_volume_gib                      = var.relay_b.root_volume_gib
  node_key_parameter_name              = var.relay_b.node_key_parameter_name
  rain_attestor_key_parameter_name     = var.relay_b.rain_attestor_key_parameter_name
  base_rpc_url_parameter_name          = var.relay_b.base_rpc_url_parameter_name
  graduation_keeper_enabled            = var.relay_b.graduation_keeper_enabled
  graduation_keeper_key_parameter_name = try(var.relay_b.graduation_keeper_key_parameter_name, null)
  chain_id                             = var.rain.chain_id
  arena_address                        = var.rain.arena_address
  rain_start_block                     = var.rain.start_block
  rain_poll_ms                         = var.rain.poll_ms
  rain_confirmations                   = var.rain.confirmations
  rain_distribution_ms                 = var.rain.distribution_ms
  rpc_daily_credit_budget              = var.rain.rpc_daily_credit_budget
  graduation_submission_delay_ms       = var.graduation.submission_delay_ms
  graduation_rebroadcast_ms            = var.graduation.rebroadcast_ms
  graduation_max_gas_limit             = var.graduation.max_gas_limit
  graduation_max_execution_fee_wei     = var.graduation.max_execution_fee_wei
  static_peer                          = var.relay_b.static_peer
  repository_url                       = var.repository_url
  repository_ref                       = var.repository_ref
  store_seconds                        = var.store.seconds
  store_capacity                       = var.store.capacity
  store_size                           = var.store.size
  operator_cidr_blocks                 = var.operator_cidr_blocks
  alarm_email                          = var.alarm_email
}
