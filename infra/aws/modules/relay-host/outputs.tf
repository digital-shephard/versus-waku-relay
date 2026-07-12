output "instance_id" { value = aws_instance.relay.id }

output "summary" {
  value = {
    domain         = var.domain
    public_ip      = aws_eip.relay.public_ip
    instance_id    = aws_instance.relay.id
    region         = data.aws_region.current.region
    node_key_path  = var.node_key_parameter_name
    ssm_session    = "aws ssm start-session --region ${data.aws_region.current.region} --target ${aws_instance.relay.id}"
    service_status = "sudo systemctl status versus-waku-relay"
  }
}
