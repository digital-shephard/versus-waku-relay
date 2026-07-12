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
