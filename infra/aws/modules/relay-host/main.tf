data "aws_region" "current" {}
data "aws_caller_identity" "current" {}

moved {
  from = aws_iam_role_policy.node_key
  to   = aws_iam_role_policy.node_secrets
}

data "aws_ssm_parameter" "ubuntu_ami" {
  name = "/aws/service/canonical/ubuntu/server/24.04/stable/current/amd64/hvm/ebs-gp3/ami-id"
}

locals {
  parameter_names = compact([
    var.node_key_parameter_name,
    var.rain_attestor_key_parameter_name,
    var.base_rpc_url_parameter_name,
    var.graduation_keeper_enabled ? var.graduation_keeper_key_parameter_name : null,
  ])
  parameter_arns = [
    for name in local.parameter_names :
    "arn:aws:ssm:${data.aws_region.current.region}:${data.aws_caller_identity.current.account_id}:parameter${name}"
  ]
}

resource "aws_vpc" "this" {
  cidr_block           = var.vpc_cidr
  enable_dns_support   = true
  enable_dns_hostnames = true
  tags                 = { Name = var.name }
}

resource "aws_internet_gateway" "this" {
  vpc_id = aws_vpc.this.id
  tags   = { Name = var.name }
}

resource "aws_subnet" "public" {
  vpc_id                  = aws_vpc.this.id
  cidr_block              = var.subnet_cidr
  availability_zone       = var.availability_zone
  map_public_ip_on_launch = true
  tags                    = { Name = "${var.name}-public" }
}

resource "aws_route_table" "public" {
  vpc_id = aws_vpc.this.id
  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.this.id
  }
  tags = { Name = "${var.name}-public" }
}

resource "aws_route_table_association" "public" {
  subnet_id      = aws_subnet.public.id
  route_table_id = aws_route_table.public.id
}

resource "aws_security_group" "relay" {
  name_prefix = "${var.name}-"
  description = "Versus Waku public relay"
  vpc_id      = aws_vpc.this.id

  dynamic "ingress" {
    for_each = toset([80, 60000])
    content {
      description      = ingress.value == 80 ? "ACME HTTP challenge" : "Waku TCP"
      from_port        = ingress.value
      to_port          = ingress.value
      protocol         = "tcp"
      cidr_blocks      = ["0.0.0.0/0"]
      ipv6_cidr_blocks = ["::/0"]
    }
  }

  ingress {
    description      = "WSS HTTPS"
    from_port        = 443
    to_port          = 443
    protocol         = "tcp"
    cidr_blocks      = ["0.0.0.0/0"]
    ipv6_cidr_blocks = ["::/0"]
  }

  ingress {
    description      = "HTTP/3"
    from_port        = 443
    to_port          = 443
    protocol         = "udp"
    cidr_blocks      = ["0.0.0.0/0"]
    ipv6_cidr_blocks = ["::/0"]
  }

  dynamic "ingress" {
    for_each = toset(var.operator_cidr_blocks)
    content {
      description = "Optional operator SSH"
      from_port   = 22
      to_port     = 22
      protocol    = "tcp"
      cidr_blocks = [ingress.value]
    }
  }

  egress {
    from_port        = 0
    to_port          = 0
    protocol         = "-1"
    cidr_blocks      = ["0.0.0.0/0"]
    ipv6_cidr_blocks = ["::/0"]
  }

  lifecycle { create_before_destroy = true }
}

resource "aws_iam_role" "relay" {
  name_prefix = "${var.name}-"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "ec2.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy_attachment" "ssm_core" {
  role       = aws_iam_role.relay.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
}

resource "aws_iam_role_policy" "node_secrets" {
  # Keep the original IAM policy name so existing fleets update in place.
  name = "read-own-node-key"
  role = aws_iam_role.relay.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["ssm:GetParameter"]
        Resource = local.parameter_arns
      },
      {
        Effect   = "Allow"
        Action   = ["kms:Decrypt"]
        Resource = "*"
        Condition = {
          StringEquals = { "kms:ViaService" = "ssm.${data.aws_region.current.region}.amazonaws.com" }
        }
      }
    ]
  })
}

resource "aws_iam_instance_profile" "relay" {
  name_prefix = "${var.name}-"
  role        = aws_iam_role.relay.name
}

resource "aws_eip" "relay" {
  domain = "vpc"
  tags   = { Name = var.name }
}

resource "aws_instance" "relay" {
  ami                         = data.aws_ssm_parameter.ubuntu_ami.value
  instance_type               = var.instance_type
  subnet_id                   = aws_subnet.public.id
  vpc_security_group_ids      = [aws_security_group.relay.id]
  iam_instance_profile        = aws_iam_instance_profile.relay.name
  associate_public_ip_address = true
  user_data_replace_on_change = false

  metadata_options {
    http_endpoint = "enabled"
    http_tokens   = "required"
  }

  root_block_device {
    encrypted             = true
    volume_type           = "gp3"
    volume_size           = var.root_volume_gib
    delete_on_termination = true
  }

  user_data = templatefile("${path.module}/user-data.sh.tftpl", {
    region                               = data.aws_region.current.region
    public_ip                            = aws_eip.relay.public_ip
    domain                               = var.domain
    node_key_parameter_name              = var.node_key_parameter_name
    rain_attestor_key_parameter_name     = var.rain_attestor_key_parameter_name
    base_rpc_url_parameter_name          = var.base_rpc_url_parameter_name
    graduation_keeper_enabled            = var.graduation_keeper_enabled
    graduation_keeper_key_parameter_name = var.graduation_keeper_key_parameter_name != null ? var.graduation_keeper_key_parameter_name : ""
    chain_id                             = var.chain_id
    arena_address                        = var.arena_address
    rain_start_block                     = var.rain_start_block
    rain_poll_ms                         = var.rain_poll_ms
    rain_confirmations                   = var.rain_confirmations
    rain_distribution_ms                 = var.rain_distribution_ms
    rpc_daily_credit_budget              = var.rpc_daily_credit_budget
    rpc_credits_per_second               = var.rpc_credits_per_second
    graduation_submission_delay_ms       = var.graduation_submission_delay_ms
    graduation_rebroadcast_ms            = var.graduation_rebroadcast_ms
    graduation_max_gas_limit             = var.graduation_max_gas_limit
    graduation_max_execution_fee_wei     = var.graduation_max_execution_fee_wei
    static_peer                          = var.static_peer
    repository_url                       = var.repository_url
    repository_ref                       = var.repository_ref
    store_seconds                        = var.store_seconds
    store_capacity                       = var.store_capacity
    store_size                           = var.store_size
  })

  depends_on = [aws_route_table_association.public]
  tags       = { Name = var.name }

  lifecycle {
    ignore_changes = [user_data]
  }
}

resource "aws_eip_association" "relay" {
  allocation_id = aws_eip.relay.id
  instance_id   = aws_instance.relay.id
}

resource "aws_route53_record" "relay" {
  zone_id = var.hosted_zone_id
  name    = var.domain
  type    = "A"
  ttl     = 60
  records = [aws_eip.relay.public_ip]
}

resource "aws_sns_topic" "alarms" {
  name = "${var.name}-alarms"
}

resource "aws_sns_topic_subscription" "email" {
  count     = var.alarm_email == "" ? 0 : 1
  topic_arn = aws_sns_topic.alarms.arn
  protocol  = "email"
  endpoint  = var.alarm_email
}

resource "aws_cloudwatch_metric_alarm" "status" {
  alarm_name          = "${var.name}-instance-status"
  alarm_description   = "EC2 instance or system status check failed"
  namespace           = "AWS/EC2"
  metric_name         = "StatusCheckFailed"
  dimensions          = { InstanceId = aws_instance.relay.id }
  statistic           = "Maximum"
  period              = 60
  evaluation_periods  = 2
  threshold           = 0
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "breaching"
  alarm_actions       = [aws_sns_topic.alarms.arn]
  ok_actions          = [aws_sns_topic.alarms.arn]
}
