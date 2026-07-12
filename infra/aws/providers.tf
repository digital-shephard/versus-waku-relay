provider "aws" {
  alias  = "relay_a"
  region = var.relay_a.region

  default_tags {
    tags = local.common_tags
  }
}

provider "aws" {
  alias  = "relay_b"
  region = var.relay_b.region

  default_tags {
    tags = local.common_tags
  }
}
